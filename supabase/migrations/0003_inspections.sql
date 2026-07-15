-- Onsite property inspections (Sprint 6): capture + manage.
-- The `inspections` / `inspection_items` tables may already exist in the
-- live DB (dashboard-created, shape unverified), so everything here is
-- idempotent: create-if-missing, then add-column-if-missing for every
-- column the app relies on. Run in Supabase SQL Editor.

create table if not exists inspections (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  template_id uuid,
  inspected_by uuid,
  inspection_date date not null default current_date,
  unit_number text,
  area text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'report_sent')),
  overall_rating numeric,
  report_file_path text,
  report_sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  section_name text not null,
  item_label text not null,
  rating numeric,
  condition text,
  notes text,
  requires_action boolean not null default false,
  action_priority text,
  photo_paths text[] not null default '{}',
  task_id uuid references tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Columns the pre-existing (dashboard-created) tables might be missing.
alter table inspections
  add column if not exists template_id uuid,
  add column if not exists inspected_by uuid,
  add column if not exists inspection_date date not null default current_date,
  add column if not exists unit_number text,
  add column if not exists area text,
  add column if not exists status text not null default 'draft',
  add column if not exists overall_rating numeric,
  add column if not exists report_file_path text,
  add column if not exists report_sent_at timestamptz,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now();

alter table inspection_items
  add column if not exists rating numeric,
  add column if not exists condition text,
  add column if not exists notes text,
  add column if not exists requires_action boolean not null default false,
  add column if not exists action_priority text,
  add column if not exists photo_paths text[] not null default '{}',
  add column if not exists task_id uuid references tasks(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

-- Sprint 6 additions: inspection type (site_visit vs annual) and a
-- per-item unit number (a section instance = section_name + unit_number,
-- e.g. "Vacant Unit" + '204' renders as "Vacant Unit · 204").
alter table inspections
  add column if not exists inspection_type text not null default 'site_visit';

do $$ begin
  alter table inspections
    add constraint inspections_inspection_type_check
    check (inspection_type in ('site_visit', 'annual'));
exception when duplicate_object then null; end $$;

alter table inspection_items
  add column if not exists unit_number text;

create index if not exists inspections_property_id_idx
  on inspections (property_id);
create index if not exists inspection_items_inspection_id_idx
  on inspection_items (inspection_id);

alter table inspections enable row level security;
do $$ begin
  create policy "authenticated full access" on inspections
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

alter table inspection_items enable row level security;
do $$ begin
  create policy "authenticated full access" on inspection_items
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
