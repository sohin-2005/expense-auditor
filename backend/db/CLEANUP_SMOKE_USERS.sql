-- Remove the throwaway accounts the endpoint sweep created.
--
-- tests/smoke_endpoints.py deletes its own profile rows, but the Supabase
-- service-role key cannot delete auth.users through the admin API on this
-- project ("User not allowed"), so the auth rows survive. They have no
-- profile, so they cannot sign in to anything -- load_profile() refuses a
-- caller with no profile row -- but there is no reason to keep them.

select id, email, created_at
  from auth.users
 where email like '%@audixa-smoke.invalid'
 order by created_at;

delete from auth.users
 where email like '%@audixa-smoke.invalid';
