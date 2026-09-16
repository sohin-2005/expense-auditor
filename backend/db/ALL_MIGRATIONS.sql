-- ═══════════════════════════════════════════════════════════════════
-- Audixa — all migrations, in order. Paste into the Supabase SQL editor
-- and Run. Every statement is idempotent, so re-running is safe.
--
-- Generated 2026-09-08T16:55:14Z. Source files live in backend/db/.
-- ═══════════════════════════════════════════════════════════════════


-- ═══ 001_init.sql ═══

-- Core schema: profiles, policies, expenses, claims.
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- Why this exists: until now the schema lived only inside a Supabase project
-- and nowhere in version control. That is what forced
-- insert_expense_with_schema_fallback() and its two siblings -- functions
-- that retry an insert up to twelve times, parsing the Postgres error to
-- strip whichever column is missing, and silently dropping that data. This
-- file makes the schema explicit so those functions can be deleted.
--
-- Everything is written to converge an existing database rather than assume
-- an empty one: CREATE TABLE IF NOT EXISTS for the tables, ADD COLUMN IF NOT
-- EXISTS for every column the API writes. Running it against your current
-- project adds whatever drifted away and changes nothing else.
--
-- Note the ALTERs repeat every column that also appears in the CREATE TABLE
-- above them, including the obvious ones. That is not redundancy: a column
-- declared inside CREATE TABLE IF NOT EXISTS is created ONLY when the table
-- does not already exist. Against a live database every one of those
-- declarations is skipped, so a table missing `created_at` stayed missing it
-- and the index below failed with "column created_at does not exist".

-- ── profiles ────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key,
  full_name   text,
  role        text not null default 'employee',
  company_id  text not null default 'default'
);

alter table public.profiles add column if not exists id         uuid;
alter table public.profiles add column if not exists full_name  text;
alter table public.profiles add column if not exists role       text default 'employee';
alter table public.profiles add column if not exists company_id text default 'default';

-- ── policies ────────────────────────────────────────────────────────────
create table if not exists public.policies (
  company_id  text primary key,
  policy_text text,
  file_name   text,
  uploaded_at timestamptz default now()
);

alter table public.policies add column if not exists company_id  text;
alter table public.policies add column if not exists policy_text text;
alter table public.policies add column if not exists file_name   text;
alter table public.policies add column if not exists uploaded_at timestamptz default now();

-- ── expenses ────────────────────────────────────────────────────────────
create table if not exists public.expenses (
  id          uuid primary key,
  employee_id uuid not null,
  company_id  text not null default 'default',
  amount      numeric,
  currency    text,
  status      text,
  created_at  timestamptz default now()
);

-- Every column the API writes -- the core ones included, for the reason in
-- the header comment. Adding a column with a DEFAULT backfills existing rows
-- on PostgreSQL 11+, so `created_at` lands populated rather than null.
alter table public.expenses add column if not exists id              uuid;
alter table public.expenses add column if not exists employee_id     uuid;
alter table public.expenses add column if not exists company_id      text default 'default';
alter table public.expenses add column if not exists amount          numeric;
alter table public.expenses add column if not exists currency        text;
alter table public.expenses add column if not exists status          text;
alter table public.expenses add column if not exists created_at      timestamptz default now();

-- The rest were the "optional columns" the schema-fallback retry loop used to
-- strip on the way in.
alter table public.expenses add column if not exists employee_name   text;
alter table public.expenses add column if not exists expense_type    text;
alter table public.expenses add column if not exists category        text;
alter table public.expenses add column if not exists business_purpose text;
alter table public.expenses add column if not exists risk_level      text;
alter table public.expenses add column if not exists reason          text;
alter table public.expenses add column if not exists policy_snippet  text;
alter table public.expenses add column if not exists claim_id        uuid;
alter table public.expenses add column if not exists vendor_name     text;
alter table public.expenses add column if not exists merchant_name   text;
alter table public.expenses add column if not exists city            text;
alter table public.expenses add column if not exists payment_type    text;
alter table public.expenses add column if not exists invoice_number  text;
alter table public.expenses add column if not exists gl_code         text;
alter table public.expenses add column if not exists image_url       text;
alter table public.expenses add column if not exists receipt_url     text;
alter table public.expenses add column if not exists duplicate_of    uuid;

-- transaction_date and "date" are created as text when absent, because both
-- are filled from a vision model's free-text output ("15/01/2026", "Jan 15",
-- null, occasionally nonsense) and a `date` column rejects those outright --
-- turning an unreadable receipt into a failed upload.
--
-- On a database where these already exist as a real `date` type, that type is
-- KEPT: ADD COLUMN IF NOT EXISTS never retypes an existing column, and
-- rewriting one under live data is not something a migration should do
-- silently. Everything downstream (003's backfill, 004's month bucket) casts
-- to text before reading them, so both shapes work. If yours are `date`, be
-- aware the API can still send an unparseable string and get a 500 -- see
-- "Known limitations".
alter table public.expenses add column if not exists transaction_date text;
alter table public.expenses add column if not exists "date"           text;

-- ── claims ──────────────────────────────────────────────────────────────
create table if not exists public.claims (
  id           uuid primary key,
  employee_id  uuid not null,
  company_id   text not null default 'default',
  total_amount numeric default 0,
  status       text default 'Draft',
  created_at   timestamptz default now()
);

alter table public.claims add column if not exists id               uuid;
alter table public.claims add column if not exists employee_id      uuid;
alter table public.claims add column if not exists company_id       text default 'default';
alter table public.claims add column if not exists total_amount     numeric default 0;
alter table public.claims add column if not exists status           text default 'Draft';
alter table public.claims add column if not exists created_at       timestamptz default now();
alter table public.claims add column if not exists report_name      text;
alter table public.claims add column if not exists entity           text;
alter table public.claims add column if not exists employee_name    text;
alter table public.claims add column if not exists submitted_at     timestamptz;
alter table public.claims add column if not exists overridden_at    timestamptz;
alter table public.claims add column if not exists override_comment text;

-- ── indexes ─────────────────────────────────────────────────────────────
-- expenses is filtered by employee_id, claim_id and company_id on nearly
-- every read, and had no committed index on any of them. The composite
-- pairs match the actual query shapes: "my expenses, newest first" and
-- "this company's expenses, newest first".
create index if not exists idx_expenses_employee_id  on public.expenses(employee_id);
create index if not exists idx_expenses_claim_id     on public.expenses(claim_id);
create index if not exists idx_expenses_company_id   on public.expenses(company_id);
create index if not exists idx_expenses_employee_created
  on public.expenses(employee_id, created_at desc);
create index if not exists idx_expenses_company_created
  on public.expenses(company_id, created_at desc);

-- find_potential_duplicate() looks up vendor + amount + date per employee.
create index if not exists idx_expenses_dupe_lookup
  on public.expenses(employee_id, vendor_name, amount);

create index if not exists idx_claims_employee_id on public.claims(employee_id);
create index if not exists idx_claims_company_id  on public.claims(company_id);
create index if not exists idx_claims_status      on public.claims(status);
create index if not exists idx_claims_employee_created
  on public.claims(employee_id, created_at desc);

-- ═══ 002_normalize_expense_status.sql ═══

-- Normalize expenses.status so reads can trust the stored column.
-- Run after 001_init.sql. Safe to re-run (it is idempotent by construction).
--
-- Why: every read path -- analytics, derive_claim_status,
-- enrich_claims_with_ai_summary -- passed each row back through
-- resolve_expense_status() before using it, re-deriving the verdict in Python
-- on every request. That is what forced analytics to stream the whole table
-- into a Python loop, which is where the silent 1000-row truncation came
-- from (PostgREST caps responses at db-max-rows and returns HTTP 200 with no
-- warning). Aggregation cannot move into Postgres while the status in the
-- database is not the status the app believes.
--
-- This is an exact translation of the read-time correction, not a new rule.
-- At read time resolve_expense_status() is called with no allowed_limit,
-- detected_amount or over_limit_by -- those exist only at write time -- so
-- its numeric branch can never fire there and the whole correction reduces
-- to canonical_status() plus the reason-text checks reproduced below.
--
-- Writes already stored the corrected value; this repairs rows written
-- before that logic existed, or by an older deploy.

-- ── 1. canonical_status(): map free-text verdicts onto the four values ──
-- Unknown and empty values become 'Flagged', matching the Python default:
-- an unrecognized verdict is not an approval.
update public.expenses set status = 'Approved'
 where lower(btrim(coalesce(status, ''))) in ('approved', 'approve', 'ok');

update public.expenses set status = 'Rejected'
 where lower(btrim(coalesce(status, ''))) in ('rejected', 'reject', 'denied');

update public.expenses set status = 'Draft'
 where lower(btrim(coalesce(status, ''))) = 'draft';

update public.expenses set status = 'Flagged'
 where status is null
    or lower(btrim(status)) not in ('approved', 'rejected', 'draft', 'flagged');

-- ── 2. resolve_expense_status(): an "approval" that says it broke a rule ──
-- The audit model sometimes returns Approved with a reason that contradicts
-- it. The app has always treated the reason as authoritative there.
update public.expenses set status = 'Rejected'
 where status = 'Approved'
   and (
        reason ilike '%over limit%'
     or reason ilike '%above limit%'
     or reason ilike '%exceeds limit%'
     or reason ilike '%exceeded limit%'
     or reason ilike '%violates%'
     or reason ilike '%violation%'
     or reason ilike '%not compliant%'
   );

-- ── 3. keep it true going forward ────────────────────────────────────────
-- The API applies the same correction on write. This constraint stops a
-- future code path -- or a hand-written UPDATE -- from reintroducing a value
-- the aggregation cannot interpret. It deliberately does NOT encode rule 2:
-- that one is a judgement about model output, and belongs in application
-- code where it can be revised.
alter table public.expenses drop constraint if exists expenses_status_known;
alter table public.expenses add constraint expenses_status_known
  check (status in ('Approved', 'Flagged', 'Rejected', 'Draft'));

-- ── 4. verify ────────────────────────────────────────────────────────────
-- Expect only the four values, and no Approved row whose reason contradicts
-- it. A non-empty second result means step 2 did not run.
--
--   select status, count(*) from public.expenses group by status order by 2 desc;
--
--   select count(*) from public.expenses
--    where status = 'Approved' and (reason ilike '%over limit%'
--       or reason ilike '%violates%' or reason ilike '%not compliant%');

-- ═══ 003_fx.sql ═══

-- Multi-currency normalization.
-- Run after 002_normalize_expense_status.sql. Safe to re-run.
--
-- The bug this fixes: infer_currency_code() carefully detects INR, USD, EUR,
-- GBP, JPY and nine others from receipt symbols and stores the result per
-- expense -- and then analytics added `amount` to one running total
-- regardless of denomination. A Rs.5,000 taxi and a $5,000 flight counted
-- equally. The same untyped number flows into claims.total_amount through
-- sync_claim_status_totals(), so claim totals inherit the error.
--
-- The design rule here is that nothing invents a rate. An expense whose
-- currency has no rate on file gets amount_base = NULL and is COUNTED AND
-- REPORTED as unconverted by the analytics function, rather than being
-- folded into a total at an implied 1:1. A visible gap beats a confident
-- wrong number, especially in a tool whose output is a reimbursement
-- decision.

-- ── rates ───────────────────────────────────────────────────────────────
-- rate_to_base: 1 unit of `currency` equals this many units of base_currency.
-- So with base USD, ('INR', 0.012) means Rs.1 = $0.012.
--
-- Rates are dated and looked up as "the most recent rate on or before the
-- transaction date", so a sparse table still works: seed one row per
-- currency and every expense converts at that rate until you add a newer one.
create table if not exists public.fx_rates (
  base_currency text    not null,
  currency      text    not null,
  rate_date     date    not null,
  rate_to_base  numeric not null check (rate_to_base > 0),
  source        text,
  created_at    timestamptz not null default now(),
  primary key (base_currency, currency, rate_date)
);

create index if not exists idx_fx_rates_lookup
  on public.fx_rates(base_currency, currency, rate_date desc);

-- ── expense columns ─────────────────────────────────────────────────────
-- amount and currency stay exactly as they are: the employee must still
-- recognize their own receipt. amount_base is what aggregates.
alter table public.expenses add column if not exists amount_base   numeric;
alter table public.expenses add column if not exists base_currency text;
alter table public.expenses add column if not exists fx_rate       numeric;
alter table public.expenses add column if not exists fx_date       date;

create index if not exists idx_expenses_amount_base
  on public.expenses(company_id, amount_base);

-- ── conversion ──────────────────────────────────────────────────────────
-- Shared by the backfill below and by the analytics function in 004, so the
-- rule lives in exactly one place.
create or replace function public.fx_rate_for(
  p_base     text,
  p_currency text,
  p_on_date  date
) returns numeric
language sql
stable
as $$
  select case
    -- Same currency is an identity, and needs no row in fx_rates.
    when upper(btrim(coalesce(p_currency, ''))) = upper(btrim(coalesce(p_base, '')))
      then 1.0
    else (
      select r.rate_to_base
        from public.fx_rates r
       where upper(r.base_currency) = upper(btrim(coalesce(p_base, '')))
         and upper(r.currency)      = upper(btrim(coalesce(p_currency, '')))
         and r.rate_date <= coalesce(p_on_date, current_date)
       order by r.rate_date desc
       limit 1
    )
  end;
$$;

-- ── backfill ────────────────────────────────────────────────────────────
-- Locks in the rate that applied at the transaction date, so a later rate
-- correction cannot silently restate a past reimbursement. Rows with no
-- usable rate are left NULL on purpose -- see the design rule above.
--
-- Both date columns are cast to text before being combined. Depending on when
-- a deployment was created, transaction_date and "date" may be a real `date`
-- type or free text (001_init.sql only adds them when absent, and never
-- retypes an existing column), and COALESCE refuses to mix the two. Casting
-- makes this work either way and costs nothing.
-- Anything that is not YYYY-MM-DD falls back to created_at.
do $$
declare
  v_base text := upper(coalesce(current_setting('audixa.base_currency', true), 'USD'));
begin
  update public.expenses e
     set base_currency = v_base,
         fx_date = d.eff_date,
         fx_rate = public.fx_rate_for(v_base, e.currency, d.eff_date),
         amount_base = e.amount * public.fx_rate_for(v_base, e.currency, d.eff_date)
    from (
      select id,
             coalesce(
               nullif(substring(
                 coalesce(transaction_date::text, "date"::text, '')
                 from '^\d{4}-\d{2}-\d{2}'), '')::date,
               created_at::date,
               current_date
             ) as eff_date
        from public.expenses
    ) d
   where d.id = e.id
     and e.amount_base is null;
end $$;

-- ── seeding ─────────────────────────────────────────────────────────────
-- Set your base currency first if it is not USD:
--
--   alter database postgres set audixa.base_currency = 'INR';
--
-- (and set BASE_CURRENCY to match in the backend environment).
--
-- Then add one row per currency you actually see. A single dated row per
-- currency is enough to start:
--
--   insert into public.fx_rates (base_currency, currency, rate_date, rate_to_base, source)
--   values ('USD', 'INR', current_date, 0.0120, 'manual'),
--          ('USD', 'EUR', current_date, 1.0850, 'manual'),
--          ('USD', 'GBP', current_date, 1.2700, 'manual')
--   on conflict (base_currency, currency, rate_date) do update
--     set rate_to_base = excluded.rate_to_base;
--
-- After adding rates, re-run the backfill block above to convert the rows
-- that were left NULL.
--
-- What is still unconverted, and how much it is worth in its own currency:
--
--   select currency, count(*), sum(amount)
--     from public.expenses
--    where amount_base is null
--    group by currency
--    order by 2 desc;

-- ═══ 004_analytics.sql ═══

-- Server-side spend analytics.
-- Run after 003_fx.sql. Safe to re-run.
--
-- Replaces a Python loop over every matching expense row. That loop had two
-- problems. The visible one: PostgREST caps a response at db-max-rows
-- (Supabase default 1000) and returns HTTP 200 with no error, no warning and
-- no truncation flag -- so past a thousand expenses the compliance rate,
-- totals, category split and top vendors were all quietly wrong, in a way
-- nobody would notice because the numbers still looked plausible. The
-- invisible one: it streamed the whole table over the wire to compute eight
-- numbers.
--
-- Aggregating here fixes both. Postgres has no such cap on what a function
-- reads, and only the result crosses the wire.
--
-- Scope is decided by the caller: p_employee_id NULL means company-wide.
-- main.py never lets a non-approver reach that branch.

create or replace function public.analytics_summary(
  p_company_id  text,
  p_employee_id uuid default null
) returns jsonb
language sql
stable
as $$
with scoped as (
  select
    e.*,
    -- Match the API's status buckets: anything that is not a clear
    -- Approved/Rejected counts as needing review. 002 narrowed status to
    -- four values; this keeps Draft (and anything a future migration adds)
    -- from silently vanishing from the totals.
    case
      when e.status = 'Approved' then 'Approved'
      when e.status = 'Rejected' then 'Rejected'
      else 'Flagged'
    end as bucket,
    -- Cast before combining: these columns may be `date` or text depending
    -- on when the deployment was created, and COALESCE will not mix them.
    -- Take the ISO prefix when there is one, else fall back to created_at.
    coalesce(
      nullif(substring(
        coalesce(e.transaction_date::text, e."date"::text, '')
        from '^\d{4}-\d{2}'), ''),
      to_char(e.created_at, 'YYYY-MM')
    ) as month,
    initcap(nullif(btrim(coalesce(e.expense_type, e.category, '')), '')) as category_label,
    nullif(btrim(coalesce(e.vendor_name, e.merchant_name, '')), '')      as vendor_label
  from public.expenses e
  where e.company_id = p_company_id
    and (p_employee_id is null or e.employee_id = p_employee_id)
),
totals as (
  select
    count(*)                                          as n,
    coalesce(sum(amount_base), 0)                     as total_base,
    count(*) filter (where amount_base is null)       as unconverted_n,
    coalesce(sum(amount) filter (where amount_base is null), 0) as unconverted_original,
    count(*) filter (where bucket = 'Approved')       as approved_n
  from scoped
)
select jsonb_build_object(
  'total_expenses',   (select n from totals),
  'total_amount',     round((select total_base from totals), 2),

  -- Percentage of expenses that cleared policy. Zero rows is 0%, not a
  -- division by zero.
  'compliance_rate',  case when (select n from totals) = 0 then 0
                      else round(100.0 * (select approved_n from totals)
                                       / (select n from totals)) end,

  -- Rows whose currency has no rate on file. Surfaced rather than folded
  -- into total_amount at an implied 1:1 -- see 003_fx.sql.
  'unconverted', jsonb_build_object(
    'count',           (select unconverted_n from totals),
    'original_amount', round((select unconverted_original from totals), 2),
    'currencies',      coalesce((
      select jsonb_agg(distinct upper(btrim(coalesce(currency, 'UNKNOWN'))))
        from scoped where amount_base is null
    ), '[]'::jsonb)
  ),

  'by_status', (
    select coalesce(jsonb_object_agg(bucket, n), '{}'::jsonb)
      from (select bucket, count(*) as n from scoped group by bucket) s
  ),
  'status_amounts', (
    select coalesce(jsonb_object_agg(bucket, amt), '{}'::jsonb)
      from (select bucket, round(coalesce(sum(amount_base), 0), 2) as amt
              from scoped group by bucket) s
  ),

  'top_categories', coalesce((
    select jsonb_agg(jsonb_build_object('name', name, 'amount', amt))
      from (
        select coalesce(category_label, 'Uncategorized') as name,
               round(coalesce(sum(amount_base), 0), 2)   as amt
          from scoped
         group by 1
         order by amt desc
         limit 8
      ) c
  ), '[]'::jsonb),

  'top_vendors', coalesce((
    select jsonb_agg(jsonb_build_object('name', name, 'amount', amt))
      from (
        select coalesce(vendor_label, 'Unknown')       as name,
               round(coalesce(sum(amount_base), 0), 2) as amt
          from scoped
         group by 1
         order by amt desc
         limit 8
      ) v
  ), '[]'::jsonb),

  -- Last 12 months, oldest first, matching what the chart expects.
  'monthly', coalesce((
    select jsonb_agg(jsonb_build_object('month', month, 'amount', amt) order by month)
      from (
        select month, round(coalesce(sum(amount_base), 0), 2) as amt
          from scoped
         where month is not null
         group by month
         order by month desc
         limit 12
      ) m
  ), '[]'::jsonb)
);
$$;

-- PostgREST exposes this at POST /rest/v1/rpc/analytics_summary. The backend
-- calls it with the service role, which is not subject to these grants, but
-- they keep the function callable if it is ever moved to a user-scoped
-- client -- at which point the p_company_id argument would need RLS behind
-- it rather than trusting the caller.
grant execute on function public.analytics_summary(text, uuid) to authenticated, service_role;

-- ── verify ──────────────────────────────────────────────────────────────
-- Compare against the old Python behaviour on a company with >1000 rows:
-- total_expenses should now exceed 1000, where the API previously reported
-- exactly 1000.
--
--   select public.analytics_summary('default', null);

-- ═══ 005_policy_chunks.sql ═══

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

-- ═══ 006_employee_fields.sql ═══

-- Fields employees actually need, and the app had no place to put.
-- Run after 005_policy_chunks.sql. Safe to re-run.
--
-- Each of these is a real gap someone hits in the first week of using an
-- expense tool, and works around today by writing it into business_purpose
-- as free text -- where no policy rule and no report can see it.

-- ── missing receipt ─────────────────────────────────────────────────────
-- Receipts get lost. Every real expense system has an affidavit path, because
-- the alternative is employees fabricating one or silently absorbing the cost.
-- Recording it as a first-class fact means finance can see how often it
-- happens and to whom, instead of it hiding in a free-text note.
alter table public.expenses add column if not exists receipt_missing boolean not null default false;
alter table public.expenses add column if not exists missing_receipt_reason text;

-- ── mileage ─────────────────────────────────────────────────────────────
-- Reimbursed per distance unit, not per receipt: there is nothing to
-- photograph. The amount is arithmetic, so it is computed in code and never
-- asked of the model -- cheaper, instant, and impossible to talk out of.
alter table public.expenses add column if not exists distance numeric;
alter table public.expenses add column if not exists distance_unit text;
alter table public.expenses add column if not exists mileage_rate numeric;

-- ── cost allocation ─────────────────────────────────────────────────────
-- "Which budget does this come out of" is the first question finance asks and
-- the last thing the app could answer.
alter table public.expenses add column if not exists cost_center text;
alter table public.expenses add column if not exists project_code text;

create index if not exists idx_expenses_cost_center
  on public.expenses(company_id, cost_center);

-- ── reimbursement ───────────────────────────────────────────────────────
-- Approved is not the same as paid, and "where is my money" is the single
-- most common question an expense tool gets asked. Tracking it separately
-- from the approval verdict is what lets the app answer.
alter table public.claims add column if not exists reimbursement_status text
  not null default 'Not started';
alter table public.claims add column if not exists reimbursed_at timestamptz;
alter table public.claims add column if not exists reimbursement_reference text;

alter table public.claims drop constraint if exists claims_reimbursement_status_known;
alter table public.claims add constraint claims_reimbursement_status_known
  check (reimbursement_status in ('Not started', 'Scheduled', 'Paid'));

-- ── company mileage rate ────────────────────────────────────────────────
-- Per company, per unit, dated -- same shape as fx_rates and for the same
-- reason: a rate change must not restate claims already reimbursed.
create table if not exists public.mileage_rates (
  company_id  text    not null,
  unit        text    not null default 'km',
  rate        numeric not null check (rate > 0),
  currency    text    not null,
  effective_from date not null default current_date,
  primary key (company_id, unit, effective_from)
);

-- Seed one for your company before employees can claim mileage:
--
--   insert into public.mileage_rates (company_id, unit, rate, currency)
--   values ('default', 'km', 0.21, 'USD')
--   on conflict (company_id, unit, effective_from) do update set rate = excluded.rate;

-- ═══ 007_profiles_and_recovery.sql ═══

-- Profile details and password recovery.
-- Run after 006_employee_fields.sql. Safe to re-run.
--
-- Two things here. First, the fields a person expects to be able to edit
-- about themselves -- phone, company name, photo -- which had nowhere to live,
-- so the app could only ever show an email and a name.
--
-- Second, account recovery. Supabase's own reset sends a magic link, which
-- needs outbound email configured; a security question answered at
-- registration works without it and is verified entirely server-side.

-- ── profile fields ──────────────────────────────────────────────────────
alter table public.profiles add column if not exists phone         text;
alter table public.profiles add column if not exists job_title     text;
alter table public.profiles add column if not exists company_name  text;
alter table public.profiles add column if not exists avatar_path   text;
alter table public.profiles add column if not exists updated_at    timestamptz default now();

-- company_id is the tenant key and stays pinned by the trigger in
-- profiles_authorization.sql. company_name is the human label for the same
-- organisation and is freely editable -- they are deliberately separate,
-- because renaming a company must never move anyone's data.
comment on column public.profiles.company_id is
  'Tenant key. Pinned against client writes; changed only by an admin.';
comment on column public.profiles.company_name is
  'Display name for the organisation. Cosmetic; safe to edit.';

-- ── password recovery ───────────────────────────────────────────────────
-- The answer is never stored. What is stored is a PBKDF2-SHA256 hash with a
-- per-row salt, exactly as a password would be: a security answer IS a
-- credential, and treating it as anything less is how "what is your mother's
-- maiden name" becomes a plaintext column in a breach.
alter table public.profiles add column if not exists security_question text;
alter table public.profiles add column if not exists security_answer_hash text;
alter table public.profiles add column if not exists security_set_at timestamptz;

-- Reset attempts, so a wrong answer cannot be brute-forced. Counted per
-- account and per hour, in the database rather than in process memory, so it
-- survives a restart and holds across multiple workers.
create table if not exists public.password_reset_attempts (
  id          bigserial primary key,
  user_id     uuid not null,
  succeeded   boolean not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_reset_attempts_user
  on public.password_reset_attempts(user_id, attempted_at desc);

-- ── avatars ─────────────────────────────────────────────────────────────
-- Photos go to a Supabase Storage bucket, not to the container's disk, for
-- the same reason receipts do: Render's filesystem is wiped on every deploy.
-- Create it once, PRIVATE, alongside the receipts bucket:
--
--   Storage -> New bucket -> name: avatars -> Public bucket: OFF
--
-- profiles.avatar_path holds the object path; the API serves it as a
-- short-lived signed URL, so a photo is never world-readable by URL.

-- ── verify ──────────────────────────────────────────────────────────────
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='profiles' order by ordinal_position;
--
-- Expect: id, full_name, role, company_id, phone, job_title, company_name,
--         avatar_path, updated_at, security_question, security_answer_hash,
--         security_set_at

-- ═══ travel_plans.sql ═══

-- Travel plans table for Pre-Trip Planning Assistant
-- Run this in Supabase SQL editor.

create table if not exists public.travel_plans (
  id uuid primary key,
  employee_id uuid not null,
  company_id text not null default 'default',
  destination text not null,
  start_date date not null,
  end_date date not null,
  business_purpose text not null,
  activities jsonb not null default '[]'::jsonb,
  expensive_choices jsonb not null default '[]'::jsonb,
  ai_plan jsonb not null,
  compliance_score integer not null default 0,
  created_at timestamptz not null default now()
);

-- Same reason as 001_init.sql: columns inside CREATE TABLE IF NOT EXISTS
-- are skipped entirely when the table already exists, so each one is also
-- added explicitly.
alter table public.travel_plans add column if not exists employee_id       uuid;
alter table public.travel_plans add column if not exists company_id        text default 'default';
alter table public.travel_plans add column if not exists destination       text;
alter table public.travel_plans add column if not exists start_date        date;
alter table public.travel_plans add column if not exists end_date          date;
alter table public.travel_plans add column if not exists business_purpose  text;
alter table public.travel_plans add column if not exists activities        jsonb default '[]'::jsonb;
alter table public.travel_plans add column if not exists expensive_choices jsonb default '[]'::jsonb;
alter table public.travel_plans add column if not exists ai_plan           jsonb;
alter table public.travel_plans add column if not exists compliance_score  integer default 0;
alter table public.travel_plans add column if not exists created_at        timestamptz default now();

create index if not exists idx_travel_plans_employee_id on public.travel_plans(employee_id);
create index if not exists idx_travel_plans_created_at on public.travel_plans(created_at desc);

-- ═══ profiles_authorization.sql ═══

-- Profile authorization: stop users granting themselves a privileged role.
-- Run this in the Supabase SQL editor.
--
-- Context: the backend enforces roles server-side (Principal and the
-- require_* gates in deps.py), but that enforcement reads public.profiles --
-- and until this file is applied, the signup form wrote that row directly
-- from the browser with a role the user picked from a dropdown. Anyone could
-- select "Finance Team" and pass every server-side check legitimately.
--
-- After this migration the only ways to hold a privileged role are the
-- backend's own service-role connection (POST /admin/users/{id}/role, itself
-- gated to existing administrators) or a deliberate statement in the SQL editor.

alter table public.profiles enable row level security;

-- ── read ────────────────────────────────────────────────────────────────
-- Own profile only. The app reads this on login to decide what to render;
-- the server no longer trusts that answer for anything that matters.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- ── create ──────────────────────────────────────────────────────────────
-- Signup may create the caller's own row, always as an employee. A client
-- sending role => 'finance' now fails the check rather than being honoured.
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid() and role = 'employee');

-- ── update ──────────────────────────────────────────────────────────────
-- Own row only, for display fields. role and company_id are pinned by the
-- trigger below: a policy cannot compare the new row against the old one,
-- so WITH CHECK alone cannot express "you may edit this row but not that
-- column".
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Deliberately no DELETE policy: removing your profile row would strip your
-- role and, with it, the audit trail attached to it.

create or replace function public.pin_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Two callers are allowed to change role or company_id:
  --   * the backend, which connects with the service role
  --   * a human in the SQL editor, where auth.uid() is null
  -- Everything arriving through PostgREST as an end user keeps the values it
  -- already had, whatever the request body said.
  if auth.uid() is not null
     and coalesce(
           current_setting('request.jwt.claims', true)::jsonb ->> 'role',
           ''
         ) <> 'service_role'
  then
    new.role := old.role;
    new.company_id := old.company_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pin_profile_privileges on public.profiles;
create trigger trg_pin_profile_privileges
  before update on public.profiles
  for each row execute function public.pin_profile_privileges();

-- ── indexes ─────────────────────────────────────────────────────────────
-- load_profile() runs on every privileged request, so this lookup is now on
-- the hot path. (id is the primary key, so this covers the company scoping
-- added alongside it.)
create index if not exists idx_profiles_company_id
  on public.profiles(company_id);

-- ── bootstrap ───────────────────────────────────────────────────────────
-- Chicken-and-egg: granting a role requires an existing ADMIN, and after this
-- migration nobody can self-assign one. Promote your first two accounts here,
-- by hand, once.
--
-- Roles are split on purpose: admin manages people and configuration, finance
-- approves spend and owns the policy. One account may hold either, and for a
-- small team the same person can be given admin and a colleague finance --
-- but a single account should not be both, because then it can grant itself
-- whatever it is missing.
--
--   update public.profiles set role = 'admin'
--    where id = (select id from auth.users where email = 'you@company.com');
--
--   update public.profiles set role = 'finance'
--    where id = (select id from auth.users where email = 'finance@company.com');
--
-- Then verify no one else already granted themselves one:
--
--   select p.id, u.email, p.role, p.company_id
--     from public.profiles p join auth.users u on u.id = p.id
--    where p.role in ('finance', 'manager', 'admin');
