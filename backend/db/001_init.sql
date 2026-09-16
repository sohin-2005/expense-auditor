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
