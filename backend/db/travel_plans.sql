-- Travel plans table for Pre-Trip Planning Assistant
-- Run this in Supabase SQL editor.

create table if not exists public.travel_plans (
  id uuid primary key,
  employee_id uuid not null,
  company_id text not null default 'default',
  destination text not null,
  start_date date not null,
  end_date date not null,
  business_purpose text not null,
  activities jsonb not null default '[]'::jsonb,
  expensive_choices jsonb not null default '[]'::jsonb,
  ai_plan jsonb not null,
  compliance_score integer not null default 0,
  created_at timestamptz not null default now()
);

-- Same reason as 001_init.sql: columns inside CREATE TABLE IF NOT EXISTS
-- are skipped entirely when the table already exists, so each one is also
-- added explicitly.
alter table public.travel_plans add column if not exists employee_id       uuid;
alter table public.travel_plans add column if not exists company_id        text default 'default';
alter table public.travel_plans add column if not exists destination       text;
alter table public.travel_plans add column if not exists start_date        date;
alter table public.travel_plans add column if not exists end_date          date;
alter table public.travel_plans add column if not exists business_purpose  text;
alter table public.travel_plans add column if not exists activities        jsonb default '[]'::jsonb;
alter table public.travel_plans add column if not exists expensive_choices jsonb default '[]'::jsonb;
alter table public.travel_plans add column if not exists ai_plan           jsonb;
alter table public.travel_plans add column if not exists compliance_score  integer default 0;
alter table public.travel_plans add column if not exists created_at        timestamptz default now();

create index if not exists idx_travel_plans_employee_id on public.travel_plans(employee_id);
create index if not exists idx_travel_plans_created_at on public.travel_plans(created_at desc);
