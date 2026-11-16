-- Recap emails as Gmail drafts (2026-11-15).
--   • call_items.owner_name — first name of the person responsible
--     ("Victoria", "Cory"); the recap groups bullets under it. Extraction
--     fills it; null falls back to the PMC / "Nick".
--   • call_series.recap_auto — create a Gmail recap draft automatically
--     when a call in this series is ingested. On for the active PM
--     series (those with a PMC); one-off / deal calls stay off.
--   • call_series.recap_carryover — append a "Still open from previous
--     calls" section of open carried-over tasks. Off by default; piloted
--     on Cottages on Vance.
-- Idempotent.

alter table call_items add column if not exists owner_name text;

alter table call_series
  add column if not exists recap_auto boolean not null default false,
  add column if not exists recap_carryover boolean not null default false;

update call_series set recap_auto = true
  where active and pmc_id is not null and recap_auto = false;

update call_series set recap_carryover = true
  where key = 'cottages on vance - weekly pm call';
