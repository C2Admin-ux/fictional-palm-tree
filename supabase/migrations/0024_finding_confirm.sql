-- "Confirm on site" disposition (2026-10-18, Nick's ask): the PM reports a
-- finding fixed. We take their word for it — the finding leaves the open
-- list and its linked task is completed — but it lands in a "Verify in
-- person" section of the site-visit sheet until Nick sees it himself.
-- Onsite: Verified -> resolved; Not fixed -> flagged (task reopened).
-- Already applied to the live project.
alter table inspection_items drop constraint if exists inspection_items_disposition_check;
alter table inspection_items
  add constraint inspection_items_disposition_check
  check (disposition in ('open', 'watch', 'flagged', 'task', 'capex', 'accepted', 'resolved', 'confirm'));
