-- CapEx vendor bids (Sprint 12): track competing quotes per capex project
-- from request through decision. One row per vendor bid; statuses:
--   requested → received → selected / rejected   (or declined by the vendor)
-- 'selected'/'rejected' only exist post-decision; 'declined' means the
-- vendor bowed out and the bid counts toward neither outstanding nor
-- received (see lib/capex/bids.ts — the single source for derivation).
-- Bid PDFs live in the existing private c2-documents bucket at
--   ${property_id}/capex/${project_id}/bids/${stamp}-${filename}
-- capex_projects.bids_target: how many bids the owner wants before
-- deciding (null = no target).
-- Shared workspace data — house authenticated-full-access RLS, NOT per-user.
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.

create table if not exists capex_bids (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references capex_projects(id) on delete cascade,
  vendor_name text not null,
  vendor_email text,
  vendor_phone text,
  status text not null default 'requested'
    check (status in ('requested', 'received', 'declined', 'selected', 'rejected')),
  amount numeric,
  requested_at date default current_date,
  received_at date,
  valid_until date,
  scope_notes text,
  file_path text,
  file_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists capex_bids_project_id_idx on capex_bids (project_id);

alter table capex_bids enable row level security;
do $$ begin
  create policy "authenticated full access" on capex_bids
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

alter table capex_projects add column if not exists bids_target int;

comment on column capex_projects.bids_target is
  'How many bids the owner wants in hand before deciding. NULL = no target.';
