-- Site-visit scratch notes (2026-08-30, Nick's ask): the site-visit
-- sheet is a live working page — tasks and findings edit the real
-- records — but stray observations ("discuss fence line with Rosio")
-- need a home that isn't a task or a finding yet. One row per note box:
-- keyed by property + the LOCAL visit date + a scope string, so the
-- sheet upserts as Nick types and a later visit starts fresh while the
-- old notes remain readable as history.
--
-- scope vocabulary (client-defined, free text by design):
--   'general'          — the sheet-level note box
--   'section:<key>'    — per-section boxes (tasks/findings/capex/pm/litigation)
--   'finding:<uuid>'   — a note pinned to one inspection finding
--   'capex:<uuid>'     — a note pinned to one capex project
-- No FKs on the item refs on purpose: a note must outlive the finding or
-- project it was jotted against (the past-visit history stays readable).
-- created_by is a plain uuid (house pattern — no auth.users FK).
-- Shared workspace data — house authenticated-full-access RLS.
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.

create table if not exists site_visit_notes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  visit_date date not null,
  scope text not null,
  body text not null,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (property_id, visit_date, scope)
);

create index if not exists site_visit_notes_property_id_idx on site_visit_notes (property_id);

alter table site_visit_notes enable row level security;
do $$ begin
  create policy "authenticated full access" on site_visit_notes
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
