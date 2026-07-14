-- Parcel number + municipal permit records per property.
-- Run in Supabase SQL Editor (idempotent). Permit rows are ingested from
-- city permit portals (e.g. Lakewood eTRAKiT) during property onboarding.

alter table properties
  add column if not exists parcel_number text;

create table if not exists property_permits (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  permit_no text not null,
  permit_type text,
  subtype text,
  description text,
  status text,
  issued_date date,
  expiration_date date,
  address text,
  source text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists property_permits_property_id_idx
  on property_permits (property_id, issued_date desc);

alter table property_permits enable row level security;
do $$ begin
  create policy "authenticated full access" on property_permits
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
