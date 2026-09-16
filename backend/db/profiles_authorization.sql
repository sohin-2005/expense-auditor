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
