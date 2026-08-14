-- Photo sheets + CapEx photos (Sprint 14).
--
-- Two independent pieces, one migration because they serve one feature:
-- a 9-up captioned photo grid PDF that can be attached to a follow-up
-- email so recipients can see the photos without opening the app.
--
-- 1. inspections.photo_sheet_path / photo_sheet_paths
--    The photo sheet is a SECOND export, stored beside the existing report
--    (report_file_path) rather than replacing it, at
--      ${property_id}/inspections/${id}/photos-${inspection_date}.pdf
--    photo_sheet_paths records WHICH photos were included, so regenerating
--    re-opens the picker on the last selection instead of making the whole
--    walk get re-picked. NULL = never generated; '{}' would mean an
--    explicitly empty sheet, which the route rejects.
--
-- 2. capex_photos
--    CapEx had no photo storage of any kind — bid PDFs (capex_bids.file_path)
--    were the only attachment. Photos live in the same private
--    c2-documents bucket as everything else, at
--      ${property_id}/capex/${project_id}/photos/${stamp}-${i}-${rand}.${ext}
--    caption is optional and hand-written: unlike an inspection photo,
--    a capex photo has no finding description to caption itself with.
--
-- Shared workspace data — house authenticated-full-access RLS, NOT per-user.
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.

alter table inspections add column if not exists photo_sheet_path text;
alter table inspections add column if not exists photo_sheet_paths text[];

comment on column inspections.photo_sheet_path is
  'Storage path of the generated photo-sheet PDF. Cleared whenever findings change (see lib/inspections/invalidate.ts).';
comment on column inspections.photo_sheet_paths is
  'Photo storage paths included in the last generated sheet — prefills the picker on regeneration. NULL = never generated.';

create table if not exists capex_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references capex_projects(id) on delete cascade,
  file_path text not null,
  file_name text,
  caption text,
  sort_order int not null default 0,
  -- Plain uuid, NOT a foreign key to auth.users. Every other table here
  -- does the same (task_views.user_id, capex_projects.created_by): the
  -- SQL Editor role has no REFERENCES privilege on auth.users, so an FK
  -- here fails the whole migration with "permission denied for table
  -- users". Learned the hard way — this migration was the only one in the
  -- repo that reached into the auth schema, and it was the only one that
  -- would not apply.
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists capex_photos_project_id_idx on capex_photos (project_id);

-- Same storage path can only be attached once — makes a retried upload
-- that already committed idempotent rather than duplicating the tile.
create unique index if not exists capex_photos_file_path_idx on capex_photos (file_path);

alter table capex_photos enable row level security;
do $$ begin
  create policy "authenticated full access" on capex_photos
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
