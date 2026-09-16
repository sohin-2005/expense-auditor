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
