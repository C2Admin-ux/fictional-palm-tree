-- Litigation tracker (2026-08-24, Nick's ask): one row per legal matter
-- — lawsuits, eviction/FED actions and their appeals, fair-housing
-- complaints, insurance claims being worked toward settlement, and
-- inbound demands. Fields per Nick: litigant, property, date of notice,
-- tracking notes, tie to insurance policy, claims adjuster contact —
-- plus the standard extras (case number, court, type, status, counsel
-- both sides, claim number, demand/settlement amounts, next deadline).
-- "Last update date" is DERIVED: latest litigation_updates row (the
-- dated tracking log), falling back to the case's updated_at.
-- created_by is a plain uuid (house pattern — no auth.users FK).
-- Shared workspace data — house authenticated-full-access RLS.
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.

create table if not exists litigation_cases (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete set null,
  title text not null,
  litigant text,
  case_type text not null default 'lawsuit'
    check (case_type in ('lawsuit', 'eviction', 'appeal', 'fair_housing', 'insurance_claim', 'demand', 'other')),
  status text not null default 'active'
    check (status in ('active', 'stayed', 'settlement', 'closed')),
  case_number text,
  court text,
  date_of_notice date,
  next_deadline date,
  next_deadline_label text,
  our_counsel text,
  opposing_counsel text,
  insurance_policy_id uuid references insurance_policies(id) on delete set null,
  claim_number text,
  adjuster_name text,
  adjuster_email text,
  adjuster_phone text,
  demand_amount numeric,
  settlement_amount numeric,
  resolved_at date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists litigation_cases_property_id_idx on litigation_cases (property_id);

-- Dated tracking log per case ("8/18 — settlement demand received,
-- deadline 9/1"). Cascades with its case.
create table if not exists litigation_updates (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references litigation_cases(id) on delete cascade,
  body text not null,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists litigation_updates_case_id_idx on litigation_updates (case_id);

alter table litigation_cases enable row level security;
alter table litigation_updates enable row level security;
do $$ begin
  create policy "authenticated full access" on litigation_cases
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated full access" on litigation_updates
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
