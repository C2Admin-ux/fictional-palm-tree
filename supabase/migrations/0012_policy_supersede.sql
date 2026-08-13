-- Insurance renewals: fix the duplicate guard, then let a renewal retire the
-- policy it replaces (Sprint 12).
--
-- Two problems, found on 2026-08-12 while entering the Main Street and Pikes
-- Place renewals.
--
-- 1. uniq_policy_no_duplicates did not include policy_type. The index exists
--    in the live database but in NO migration file — it was applied straight
--    to Supabase and never captured here, so this file is also the drift
--    getting written down. Its key was:
--        (coalesce(property_id,'PORTFOLIO'), lower(carrier),
--         lower(policy_number), effective_date)
--    Carriers routinely issue the property and liability policies for one
--    asset under a SINGLE policy number — State Farm writes Main Street's
--    property and GL both as 96-E9-R086-4, effective 07/15/2026. The second
--    of the pair therefore collided with the first and was rejected as a
--    duplicate, leaving Main Street with no property policy on file and a
--    false coverage gap in lib/coverage.ts. Debbie J II has the same
--    single-number pair (CPX068422000) and only survived because the carrier
--    string happened to extract two different ways; normalizing those strings
--    would have re-broken it. Adding policy_type to the key is strictly more
--    permissive, so no existing row can violate the new index.
--
-- 2. Nothing retired the prior term. Renewals piled up next to the policies
--    they replaced -- Main Street carried two "active" GL rows and two
--    "active" umbrella rows -- and the only way to clear the old one was the
--    manual archive toggle. insurance_policies now gets the superseded_by /
--    superseded_at pair contracts has carried since Sprint 11.
--
-- Note on status: contracts use status 'superseded', but insurance_policies
-- constrains status to active/expired/cancelled/archived and the UI filter
-- is built on those four. A superseded policy is therefore marked 'archived'
-- -- the value already in use for this by hand -- and superseded_by records
-- WHY it was archived. No enum change, no UI change.
--
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.

-- 1. Duplicate guard, now type-aware.
-- Dropped both ways: an expression-based unique key can only be an index,
-- but drop the constraint form first in case it was ever added as one.
alter table insurance_policies
  drop constraint if exists uniq_policy_no_duplicates;

drop index if exists uniq_policy_no_duplicates;

create unique index if not exists uniq_policy_no_duplicates
  on insurance_policies (
    coalesce(property_id::text, 'PORTFOLIO'::text),
    lower(carrier),
    lower(policy_number),
    effective_date,
    policy_type
  );

comment on index uniq_policy_no_duplicates is
  'Hard duplicate guard for the same policy entered twice. policy_type is part of the key because one policy number often covers both the property and the liability policy for an asset. Rows with a null policy_number never collide (nulls are distinct), matching the app, which cannot dedupe what it cannot identify.';

-- 2. Renewal lineage, mirroring contracts.superseded_by / superseded_at.
alter table insurance_policies
  add column if not exists superseded_by uuid null references insurance_policies(id) on delete set null;

alter table insurance_policies
  add column if not exists superseded_at timestamptz null;

comment on column insurance_policies.superseded_by is
  'The renewal that replaced this policy. Set together with status=archived when a newer policy for the same property and policy_type is saved -- including when this policy had not yet expired, since a re-shopped renewal often starts mid-term.';

comment on column insurance_policies.superseded_at is
  'When this policy was superseded by superseded_by.';
