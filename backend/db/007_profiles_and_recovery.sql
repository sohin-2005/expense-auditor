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
