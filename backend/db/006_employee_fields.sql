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
