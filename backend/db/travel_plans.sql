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

create index if not exists idx_travel_plans_employee_id on public.travel_plans(employee_id);
create index if not exists idx_travel_plans_created_at on public.travel_plans(created_at desc);
