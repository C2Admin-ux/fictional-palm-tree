-- Projects + delegation (2026-09-26, Nick's ask): Asana-style projects
-- that group tasks across people, and a follow-up date for delegated
-- ("waiting on") work.
--
-- projects: a generic container — an acquisition's due diligence,
-- insurance renewal season, lender draws, a PM transition. Capex
-- projects stay their own module (bids, photos, budgets); a task can
-- belong to one of each.
--
-- tasks.project_id: optional link, set null if the project is deleted
-- (tasks outlive their container).
-- tasks.follow_up_on: when a WAITING task should come back to its
-- owner to chase. Distinct from due_date (the real deadline) — "Rosio
-- owes us the hydrant quote; chase Oct 9, need it by Oct 20".
--
-- owner_id / created_by are plain uuids (house pattern — no auth.users
-- FK). Shared workspace data — house authenticated-full-access RLS.
-- Idempotent: re-runs are no-ops.

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  property_id uuid references properties(id) on delete set null,
  owner_id uuid,
  status text not null default 'active'
    check (status in ('active', 'on_hold', 'done')),
  start_date date,
  due_date date,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists projects_property_id_idx on projects (property_id);

alter table tasks add column if not exists project_id uuid references projects(id) on delete set null;
alter table tasks add column if not exists follow_up_on date;

create index if not exists tasks_project_id_idx on tasks (project_id);

alter table projects enable row level security;
do $$ begin
  create policy "authenticated full access" on projects
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
