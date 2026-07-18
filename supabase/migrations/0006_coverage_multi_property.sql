-- Affirmative multi-property coverage (owner correction, Sprint 11):
-- property_id null does NOT mean blanket/portfolio coverage — it means
-- unassigned, which is itself a data gap. A record that genuinely covers
-- several properties (or the whole portfolio) lists them explicitly in
-- covered_property_ids; property_id stays the primary single link.
-- No FK on the array elements — Postgres can't enforce one on array
-- columns; the app only ever writes known property ids.
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.

alter table insurance_policies
  add column if not exists covered_property_ids uuid[] null;

alter table contracts
  add column if not exists covered_property_ids uuid[] null;

comment on column insurance_policies.covered_property_ids is
  'Affirmative multi-property/portfolio coverage: additional property ids this policy covers beyond property_id. A row with null property_id and nothing here is unassigned — it covers no property.';

comment on column contracts.covered_property_ids is
  'Affirmative multi-property/portfolio coverage: additional property ids this contract covers beyond property_id. A row with null property_id and nothing here is unassigned — it covers no property.';
