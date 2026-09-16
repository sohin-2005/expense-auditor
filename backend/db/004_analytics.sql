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
