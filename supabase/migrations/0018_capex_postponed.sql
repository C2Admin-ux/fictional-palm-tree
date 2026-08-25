-- CapEx "Postponed" status (Nick, 2026-08-25): projects parked out of the
-- active rotation until the annual capex budgeting review. They live in a
-- collapsed bucket under the capex table — off the board, off the table.
-- postponed_at records when the project was parked; updated_at can't carry
-- that because it moves on every edit. Safe to re-run.

alter table capex_projects drop constraint if exists capex_projects_status_check;
alter table capex_projects add constraint capex_projects_status_check
  check (status in ('planning', 'approved', 'in_progress', 'complete', 'on_hold', 'postponed'));

alter table capex_projects add column if not exists postponed_at timestamptz;
