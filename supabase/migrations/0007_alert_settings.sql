-- Alert settings (seasonal-bids extension): per-portfolio and per-property
-- overrides for the obligations engine (app/api/tasks/expiration).
-- Motivation: thin vendor markets (Casper WY) need the snow bid cycle to
-- start earlier than the Sep 1 code default.
--
-- One row per (setting_key, property) — property_id NULL means the global
-- default for that key. Resolution order in the engine:
--   property-level row → global row → code constants (lib/tasks/seasonal.ts)
-- Keys in use:
--   'seasonal_snow' / 'seasonal_landscaping'
--       value: { "enabled": bool, "start": "MM-DD", "due": "MM-DD", "end": "MM-DD" }
--       enabled=false at property level skips that property's cycle
--       (e.g. in-house snow removal); at global level disables the cycle.
--   'obligation_lead_days'  (global only)
--       value: { "days": number } — how far ahead insurance/contract
--       deadline tasks appear (code default 120).
-- Values are validated defensively in the engine; a malformed row falls
-- back to defaults rather than failing the cron.
-- Shared workspace data — house authenticated-full-access RLS, NOT per-user.
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.
-- NOTE: numbered 0007 — 0006_coverage_multi_property.sql is taken by
-- another in-flight branch.

create table if not exists alert_settings (
  id uuid primary key default gen_random_uuid(),
  -- NULL = the global default row for this setting_key.
  property_id uuid references properties(id) on delete cascade,
  setting_key text not null,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- Uniqueness: at most one row per (setting_key, property) and at most one
-- global row per setting_key. Two partial indexes because NULLs never
-- collide in a plain unique index.
create unique index if not exists alert_settings_key_property_key
  on alert_settings (setting_key, property_id) where property_id is not null;
create unique index if not exists alert_settings_key_global_key
  on alert_settings (setting_key) where property_id is null;

alter table alert_settings enable row level security;
do $$ begin
  create policy "authenticated full access" on alert_settings
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
