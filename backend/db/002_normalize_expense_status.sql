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
