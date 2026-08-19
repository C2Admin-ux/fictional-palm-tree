-- Dated note log per capex bid (Sprint 17): running notes while scope is
-- refined and vendors are interviewed ("8/20 — called Mike, will quote
-- full coping replacement…"). The bid's scope_notes stays the scope
-- summary; these are the dated conversation/decision trail. Notes
-- cascade with their bid; bid rows themselves are kept for history
-- after a decision (only PDFs are purged — see bids-card.tsx).
-- created_by is a plain uuid (house pattern — NO FK to auth.users: the
-- SQL Editor role can't create one, see 0013's rollback incident).
-- Shared workspace data — house authenticated-full-access RLS.
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.

create table if not exists capex_bid_notes (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references capex_bids(id) on delete cascade,
  body text not null,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists capex_bid_notes_bid_id_idx on capex_bid_notes (bid_id);

alter table capex_bid_notes enable row level security;
do $$ begin
  create policy "authenticated full access" on capex_bid_notes
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
