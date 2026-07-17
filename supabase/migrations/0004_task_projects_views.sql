-- Task projects & saved views (Sprint 9).
-- 1) tasks.parent_task_id — single-level subtasks. Nesting depth is an
--    APP rule (a task with children can't itself become a subtask);
--    the DB only stores the edge and cascades deletes parent → children.
-- 2) task_views — per-user saved filter/group configurations for the
--    tasks page ("Saved views" chips). config is an opaque jsonb blob
--    owned by the client.
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.

alter table tasks
  add column if not exists parent_task_id uuid references tasks(id) on delete cascade;

create index if not exists tasks_parent_task_id_idx
  on tasks (parent_task_id);

create table if not exists task_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  config jsonb not null,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create index if not exists task_views_user_id_idx
  on task_views (user_id);

alter table task_views enable row level security;
do $$ begin
  create policy "authenticated full access" on task_views
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
