-- Finding dispositions (triage): every inspection finding carries a triage
-- verb, reviewed at a desk the day after a walk:
--   open (default / untriaged) | watch | flagged | task | capex | accepted | resolved
-- Dispositions never hide a finding — findings stay reviewable forever; the
-- disposition records how the risk is being managed (the score weights
-- deductions by it, see lib/inspections/score.ts).
--   disposition_note    — why (required in the UI for 'accepted')
--   disposition_at      — when the verb was last set (drives "flagged Nd")
--   communicated_at     — when a flagged item went out in a PM email
--                         (stamped by the report "Mark as sent" action)
--   capex_project_id    — the capital project a 'capex' finding rolled into
--   carried_from_item_id / watch_count — the watch loop: a 'watch' finding
--         re-confirmed onsite is CLONED into the new inspection
--         (carried_from_item_id points at the original, watch_count
--         increments; 3+ escalates priority to high in the app)
-- Shared workspace data — RLS already on inspection_items (0003).
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.

alter table inspection_items
  add column if not exists disposition text not null default 'open',
  add column if not exists disposition_note text,
  add column if not exists disposition_at timestamptz,
  add column if not exists communicated_at timestamptz,
  add column if not exists capex_project_id uuid references capex_projects(id) on delete set null,
  add column if not exists carried_from_item_id uuid references inspection_items(id) on delete set null,
  add column if not exists watch_count int not null default 0;

-- Backfill BEFORE constraining. Findings that already spawned a task
-- predate triage — they were effectively dispositioned 'task' the moment
-- the task was created. Guarded to never-touched rows only, so a re-run
-- after real triage activity is a no-op.
update inspection_items set disposition = 'task', disposition_at = created_at
  where task_id is not null and disposition = 'open' and disposition_at is null;

-- Defensive vocabulary backfill (mirrors 0003's status treatment), then
-- the guarded constraint.
update inspection_items set disposition = 'open'
  where disposition is null
     or disposition not in ('open', 'watch', 'flagged', 'task', 'capex', 'accepted', 'resolved');

do $$ begin
  alter table inspection_items
    add constraint inspection_items_disposition_check
    check (disposition in ('open', 'watch', 'flagged', 'task', 'capex', 'accepted', 'resolved'));
exception when duplicate_object then null; end $$;

-- The watch loop queries prior inspections' watch items per property, and
-- the property page rolls up unresolved findings — both filter on
-- disposition.
create index if not exists inspection_items_disposition_idx
  on inspection_items (disposition);
create index if not exists inspection_items_capex_project_id_idx
  on inspection_items (capex_project_id);
