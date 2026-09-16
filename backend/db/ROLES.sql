-- ═══════════════════════════════════════════════════════════════════════
-- Assign roles so you can see all three views. Run in the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════

-- ── STEP 1: see your accounts ──────────────────────────────────────────
-- Run this alone first. Note the emails you know the passwords for.
select u.email, p.full_name, p.role, p.company_id
  from public.profiles p
  join auth.users u on u.id = p.id
 order by p.company_id, u.email;


-- ── STEP 2: put three accounts in ONE company with three roles ─────────
-- Edit the three emails below, then run this block.
--
-- Roles are separate on purpose:
--   finance  -> uploads the policy, approves claims, sees company spend
--   admin    -> manages people and system config; CANNOT approve or upload policy
--   employee -> submits expenses; the view most of your users get
--
-- Sign in with whichever email you want to see the app as.

update public.profiles p
   set company_id = 'default',
       role = v.role
  from (values
          ('finance@example.com',  'finance'),   -- <<< EDIT: your main account
          ('admin@example.com',    'admin'),     -- <<< EDIT: a second account
          ('employee@example.com', 'employee')   -- <<< EDIT: a third (optional)
       ) as v(email, role)
  join auth.users u on u.email = v.email
 where p.id = u.id;


-- ── STEP 3: confirm ────────────────────────────────────────────────────
select u.email, p.role, p.company_id
  from public.profiles p
  join auth.users u on u.id = p.id
 where p.company_id = 'default'
 order by p.role;

-- Expect one finance, one admin, and any employees. If a row is missing, the
-- email in step 2 did not match an account -- check step 1's output.
