-- Renewal rates (Sprint 15 addendum): a manually-entered monthly renewal
-- rate per property, displayed as a month-by-month matrix on /renewals.
--
-- One numeric column on renewal_cycles — the row is already property ×
-- expiration month, which is exactly the grain a renewal rate lives at:
-- "of the leases expiring in July, what share renewed." Entered as a
-- percent for now, by hand, from the PM's report. The longer arc (Nick,
-- 2026-08-14) is rent-roll ingestion so accepted/vacated can be DERIVED
-- per unit and analyzed (years in unit, increase %, predictive offers) —
-- when that lands, this column becomes the headline number those tables
-- roll up to, not a competing source.
--
-- NULL = not entered. The nightly sync creates one entry task per
-- property when a month closes without a rate.
--
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.

alter table renewal_cycles add column if not exists renewal_rate numeric;

do $$ begin
  alter table renewal_cycles add constraint renewal_cycles_rate_check
    check (renewal_rate is null or (renewal_rate >= 0 and renewal_rate <= 100));
exception when duplicate_object then null; end $$;

comment on column renewal_cycles.renewal_rate is
  'Percent of leases expiring this month that renewed (0-100). Manually entered once the month closes; NULL = not yet entered.';
