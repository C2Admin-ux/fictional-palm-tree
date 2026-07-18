-- PM check-in calls (Sprint 11): notes → extracted items → tasks flywheel.
-- `calls` holds one row per weekly PM check-in (pasted Granola notes or an
-- inbound Gemini email); `call_items` are the extracted/curated line items
-- (actions, updates, issues, decisions) that become or link to tasks.
-- Shared workspace data — house authenticated-full-access RLS, NOT per-user.
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  pmc_id uuid references pmcs(id),
  title text not null default '',
  call_date date not null default current_date,
  source text not null default 'paste' check (source in ('paste', 'email')),
  -- Identity of the inbound email that created this call (the Resend
  -- email id) — the atomic dedupe key for webhook retries. Null for
  -- pasted calls and legacy rows.
  external_id text,
  transcript text,
  summary text,
  status text not null default 'draft' check (status in ('draft', 'processed')),
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- The list page and "previous call" lookups both read per-PMC, newest first.
create index if not exists calls_pmc_id_call_date_idx
  on calls (pmc_id, call_date desc);

-- One call per inbound email: the unique-violation on insert IS the
-- duplicate signal in the inbound route (no check-then-insert race).
create unique index if not exists calls_external_id_key
  on calls (external_id) where external_id is not null;

create table if not exists call_items (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  kind text not null check (kind in ('action', 'update', 'issue', 'decision')),
  property_id uuid references properties(id),
  description text not null,
  owner text,
  -- The CONFIRMED task link (set at Confirm & process; survives task delete).
  task_id uuid references tasks(id) on delete set null,
  -- Extraction PROPOSALS, persisted so the review survives a page reload:
  -- matched_task_id is the model's "this refers to tracked work" suggestion
  -- (promoted to task_id on confirm), due_hint feeds the created task's
  -- due_date. Both are advisory until Confirm & process.
  matched_task_id uuid references tasks(id) on delete set null,
  due_hint date,
  resolved boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create index if not exists call_items_call_id_idx on call_items (call_id);
create index if not exists call_items_task_id_idx on call_items (task_id);

alter table calls enable row level security;
do $$ begin
  create policy "authenticated full access" on calls
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

alter table call_items enable row level security;
do $$ begin
  create policy "authenticated full access" on call_items
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
