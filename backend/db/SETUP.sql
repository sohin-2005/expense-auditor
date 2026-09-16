-- ═══════════════════════════════════════════════════════════════════════
-- Audixa first-run setup. Run AFTER ALL_MIGRATIONS.sql.
--
-- Edit the two values in step 1, then run the whole file.
-- Every statement is idempotent.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Choose your account and company ─────────────────────────────────
-- Put the email you actually sign in with here, and the company you want to
-- work in. Everything below keys off these two values.
--
-- company_id scopes all data. Your test signups spread accounts across 13
-- companies; 'default' has the most data (11 expenses, 11 claims) and already
-- has a policy uploaded.
create temporary table _setup as
select 'you@example.com'::text as my_email,      -- <<< EDIT
       'default'::text        as my_company;     -- <<< EDIT (or keep)

-- ── 2. Point your account at that company, and make it an admin ────────
-- Admin manages people and configuration. It deliberately CANNOT approve
-- spend -- see step 3.
update public.profiles p
   set role = 'admin', company_id = s.my_company
  from _setup s, auth.users u
 where u.email = s.my_email
   and p.id = u.id;

-- ── 3. Give yourself a finance user too ────────────────────────────────
-- Admin cannot approve claims, on purpose: whoever grants approval rights
-- should not also hold them. For a solo test, promote a second account.
-- Kiran already holds finance, so this moves that account into your company
-- so you can see approvals working. Change or drop as you like.
update public.profiles
   set company_id = (select my_company from _setup)
 where role = 'finance';

-- ── 4. Exchange rate ───────────────────────────────────────────────────
-- You have 5 INR expenses (53,883.75) sitting outside every total because no
-- rate exists. Nothing is guessed: without this row they stay excluded and
-- are reported as unconverted.
insert into public.fx_rates (base_currency, currency, rate_date, rate_to_base, source)
values ('USD', 'INR', current_date, 0.0120, 'manual-setup')
on conflict (base_currency, currency, rate_date)
  do update set rate_to_base = excluded.rate_to_base;

-- Convert the rows that were left NULL by the 003 backfill.
update public.expenses e
   set base_currency = 'USD',
       fx_rate     = public.fx_rate_for('USD', e.currency, current_date),
       fx_date     = current_date,
       amount_base = e.amount * public.fx_rate_for('USD', e.currency, current_date)
 where e.amount_base is null
   and public.fx_rate_for('USD', e.currency, current_date) is not null;

-- ── 5. Mileage rate ────────────────────────────────────────────────────
-- Without this the mileage form refuses to submit, rather than paying a
-- number nobody set.
insert into public.mileage_rates (company_id, unit, rate, currency)
values ((select my_company from _setup), 'km', 0.21, 'USD')
on conflict (company_id, unit, effective_from)
  do update set rate = excluded.rate;

-- ── 6. Check it worked ─────────────────────────────────────────────────
select 'your account' as check, p.full_name, p.role, p.company_id
  from public.profiles p, auth.users u, _setup s
 where p.id = u.id and u.email = s.my_email
union all
select 'still unconverted', currency, count(*)::text, ''
  from public.expenses where amount_base is null group by currency
union all
select 'mileage rate', unit, rate::text, currency
  from public.mileage_rates;
