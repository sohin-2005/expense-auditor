-- Policy retrieval: chunked, embedded, hybrid-searchable.
-- Run after 004_analytics.sql. Safe to re-run.
--
-- Replaces get_policy_context(), which split the policy on blank lines,
-- scored each paragraph by counting how many query words appeared as
-- substrings, and packed the top 12 KB into every prompt. Four problems with
-- that, all of them silent:
--
--   * a chunk matching one query word four times scored the same as one
--     matching it once;
--   * "cab" never matched a policy written around "taxi";
--   * "in" is a substring of "dining", so short words matched noise;
--   * the whole scan re-ran over the full policy text on every request.
--
-- What replaces it retrieves ~3 KB of genuinely relevant policy instead of
-- 12 KB of keyword-adjacent text, and -- the part that actually matters --
-- gives each verdict a chunk id that can be checked, so `policy_snippet`
-- stops being free text the model produced and becomes a reference into a
-- real document at a known version.
--
-- DIMENSIONS: vector(768) matches gemini-embedding-001 requested at 768.
-- Changing GEMINI_EMBED_MODEL or GEMINI_EMBED_DIMENSIONS means altering this
-- column and re-embedding every chunk; embeddings from different models are
-- not comparable.

create extension if not exists vector;

-- ── policy versioning ───────────────────────────────────────────────────
-- A verdict cites the policy that was in force when it was made. Without a
-- version, re-uploading a policy would silently rewrite the justification of
-- every past decision.
alter table public.policies add column if not exists version int not null default 1;

-- ── chunks ──────────────────────────────────────────────────────────────
create table if not exists public.policy_chunks (
  id             bigserial primary key,
  company_id     text    not null,
  policy_version int     not null,
  section_path   text,            -- "5.2 Lodging > Domestic", for provenance
  chunk_index    int     not null,
  content        text    not null,
  token_estimate int,
  embedding      vector(768),     -- null when embedding failed; keyword still works
  tsv            tsvector generated always as (to_tsvector('english', content)) stored,
  created_at     timestamptz not null default now(),
  unique (company_id, policy_version, chunk_index)
);

-- HNSW over cosine distance. Chosen over IVFFlat because recall matters more
-- than build time here: a policy is hundreds of chunks, not millions, so
-- HNSW's slower build and larger footprint cost nothing that shows up.
create index if not exists idx_policy_chunks_embedding
  on public.policy_chunks using hnsw (embedding vector_cosine_ops);

create index if not exists idx_policy_chunks_tsv
  on public.policy_chunks using gin (tsv);

create index if not exists idx_policy_chunks_scope
  on public.policy_chunks (company_id, policy_version);

-- ── citations on the verdict ────────────────────────────────────────────
-- What turns "explainable" from a claim in the README into a property the
-- system enforces. policy_snippet stays, but once a citation is verified it
-- holds text copied from the cited chunk rather than text the model wrote --
-- so it can no longer be fluent, confident and invented.
alter table public.expenses add column if not exists policy_chunk_id   bigint;
alter table public.expenses add column if not exists policy_section    text;
alter table public.expenses add column if not exists citation_verified boolean;

create index if not exists idx_expenses_policy_chunk
  on public.expenses(policy_chunk_id);

-- ── hybrid retrieval ────────────────────────────────────────────────────
-- Vector search alone fails on exactly the queries this domain is made of:
-- policies turn on literals -- "Section 4.2", "5,000", "business class" --
-- and embeddings blur precisely those. Keyword search alone is what the old
-- code did, and it fails on paraphrase. Run both and fuse the rankings with
-- Reciprocal Rank Fusion, which needs no score calibration between two
-- searches whose scores are not on the same scale.
create or replace function public.match_policy_chunks(
  p_company_id      text,
  p_version         int,
  p_query_embedding vector(768),
  p_query_text      text,
  p_match_count     int default 8,
  p_candidates      int default 24
) returns table (
  id           bigint,
  section_path text,
  chunk_index  int,
  content      text,
  score        double precision
)
language sql
stable
as $$
with vec as (
  select c.id,
         row_number() over (order by c.embedding <=> p_query_embedding) as rank
    from public.policy_chunks c
   where c.company_id = p_company_id
     and c.policy_version = p_version
     and c.embedding is not null
     and p_query_embedding is not null
   order by c.embedding <=> p_query_embedding
   limit p_candidates
),
kw as (
  select c.id,
         row_number() over (order by ts_rank_cd(c.tsv, q.query) desc) as rank
    from public.policy_chunks c,
         websearch_to_tsquery('english', coalesce(nullif(btrim(p_query_text), ''), 'expense')) as q(query)
   where c.company_id = p_company_id
     and c.policy_version = p_version
     and c.tsv @@ q.query
   order by ts_rank_cd(c.tsv, q.query) desc
   limit p_candidates
)
select c.id,
       c.section_path,
       c.chunk_index,
       c.content,
       -- RRF with k = 60, the standard constant: it damps the difference
       -- between ranks 1 and 2 enough that one search cannot dominate on its
       -- own, while still rewarding agreement between the two.
       coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + k.rank), 0) as score
  from public.policy_chunks c
  left join vec v on v.id = c.id
  left join kw  k on k.id = c.id
 where v.id is not null or k.id is not null
 order by score desc, c.chunk_index
 limit p_match_count;
$$;

grant execute on function public.match_policy_chunks(text, int, vector, text, int, int)
  to authenticated, service_role;

-- ── verify ──────────────────────────────────────────────────────────────
-- After uploading a policy through the app:
--
--   select company_id, policy_version, count(*), count(embedding) as embedded
--     from public.policy_chunks group by 1, 2;
--
-- `embedded` short of `count(*)` means some chunks failed to embed; those
-- rows still participate in keyword search but not vector search. The
-- upload response reports the same numbers.
