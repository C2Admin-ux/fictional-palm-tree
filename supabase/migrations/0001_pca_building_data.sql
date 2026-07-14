-- PCA / building data schema.
-- APPLIED MANUALLY 2026-07-14 by Nick via Supabase SQL Editor — committed
-- retroactively so the schema lives in version control. Idempotent.

alter table properties
  add column if not exists year_built int,
  add column if not exists year_renovated int,
  add column if not exists gross_sf numeric,
  add column if not exists net_rentable_sf numeric,
  add column if not exists land_acres numeric,
  add column if not exists num_buildings int,
  add column if not exists num_stories int,
  add column if not exists parking_total int,
  add column if not exists parking_covered int,
  add column if not exists parking_uncovered int,
  add column if not exists construction_type text,
  add column if not exists roof_type text,
  add column if not exists unit_mix jsonb,
  add column if not exists pca_report_date date,
  add column if not exists pca_assessor text,
  add column if not exists pca_file_path text,
  add column if not exists pca_file_name text;

create table if not exists property_pca_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  category text not null,
  label text not null,
  value text,
  detail text,
  est_cost numeric,
  rul_years numeric,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table property_pca_items enable row level security;
do $$ begin
  create policy "authenticated full access" on property_pca_items
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
