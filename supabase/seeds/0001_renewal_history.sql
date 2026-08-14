-- Renewal history backfill (Sprint 15) — DATA, not schema.
--
-- Run ONCE after migration 0014, in the Supabase SQL Editor. Safe to
-- re-run: every insert is `on conflict do nothing`, so it will never
-- overwrite a cycle you have since corrected by hand.
--
-- ── Provenance ──────────────────────────────────────────────
-- Every row below was read out of Gmail on 2026-08-14 and carries the
-- source thread in its `notes` column. A leg is filled in ONLY where an
-- email actually evidences it. Where the thread shows an offer arriving
-- but no explicit approval, approved_at is left NULL rather than guessed
-- — an accountability tracker seeded with invented dates is worse than
-- one seeded with gaps. Fill those in from the board if you remember them.
--
-- Cycles NOT seeded (no email evidence found): Fox Hill May/Aug 2026, the
-- Colorado Springs trio's July 2026, and everything for Cottages on Vance,
-- Main Street and Brix. Those months will show as untracked/overdue,
-- which is the honest answer.

-- ── 1. Per-property cadence ─────────────────────────────────
-- Everything runs on the 90-day standard the PMs themselves stated
-- ("we would like to have these reviewed and approved 90 days in
-- advance"). AMC has been running nearer 50 on Fox Hill; that is left as
-- a 90-day miss rather than codified as their allowance. Lower Fox Hill's
-- lead_days in Settings → Cadence if you'd rather hold them to 50.

insert into renewal_settings (property_id, enabled, lead_days, requires_partner_approval, partner_label, source, source_url)
select p.id, v.enabled, v.lead_days, v.partner, v.partner_label, v.source, v.source_url
from (values
  -- Fox Hill routes through Sunset Group after our approval — the only
  -- three-party loop in the portfolio.
  ('Fox Hill Apartments',       true,  90, true,  'Sunset Group (JL)', 'email', null),
  -- Debbie J II is 3270 S Grant, managed by Four Star. Renewals live in a
  -- shared Google Sheet, so nothing ever lands in the inbox and the chase
  -- task says "go review the sheet" with this link.
  ('Debbie J II',               true,  90, false, null, 'sheet',
   'https://docs.google.com/spreadsheets/d/1dXxFI9RgPiDNW7vf6QSFhQztGXkge28ChqVIQyQgx90/edit'),
  ('De Cortez',                 true,  90, false, null, 'email', null),
  ('Pebble Creek',              true,  90, false, null, 'email', null),
  ('Pikes Place on San Miguel', true,  90, false, null, 'email', null),
  ('Cottages on Vance',         true,  90, false, null, 'email', null),
  ('Main Street Apartments',    true,  90, false, null, 'email', null),
  -- Parked, not excluded: Brix is still in the purchase process, so there
  -- are no leases under management to renew. One checkbox at close.
  ('Brix on Belleview',         false, 90, false, null, 'email', null)
) as v(name, enabled, lead_days, partner, partner_label, source, source_url)
join properties p on p.name = v.name
on conflict (property_id) do nothing;

-- ── 2. Observed cycles ──────────────────────────────────────
-- due_date is computed the same way the generator computes it: the
-- property's lead_days before the expiration month begins.

insert into renewal_cycles (
  property_id, expiration_month, due_date,
  offer_received_at, approved_at, partner_approved_at, source, source_url, notes
)
select
  p.id,
  v.expiration_month::date,
  (v.expiration_month::date - (coalesce(rs.lead_days, 90) || ' days')::interval)::date,
  v.received::date,
  v.approved::date,
  v.partner::date,
  coalesce(rs.source, 'email'),
  rs.source_url,
  v.notes
from (values
  -- ── GB Select Properties (Jenny Roach) ────────────────────
  -- The Feb 2 catch-up batch, opening "the renewals have gotten behind."
  -- One email per property covering March, April and May at once.
  ('De Cortez',                 '2026-03-01', '2026-02-02', null,         null, 'GB "De Cortez - Renewal Suggestions March, April, and May" 2/2/26 — approval not evidenced in thread'),
  ('De Cortez',                 '2026-04-01', '2026-02-02', null,         null, 'GB catch-up batch 2/2/26 — approval not evidenced in thread'),
  ('De Cortez',                 '2026-05-01', '2026-02-02', null,         null, 'GB catch-up batch 2/2/26 — approval not evidenced in thread'),
  ('Pebble Creek',              '2026-03-01', '2026-02-02', '2026-02-03', null, 'GB catch-up batch 2/2/26; "Approved." 2/3'),
  ('Pebble Creek',              '2026-04-01', '2026-02-02', '2026-02-03', null, 'GB catch-up batch 2/2/26; "Approved." 2/3'),
  ('Pebble Creek',              '2026-05-01', '2026-02-02', '2026-02-03', null, 'GB catch-up batch 2/2/26; "Approved." 2/3'),
  ('Pikes Place on San Miguel', '2026-03-01', '2026-02-02', null,         null, 'GB catch-up batch 2/2/26; edits returned 2/3 for final approval — approval not evidenced'),
  ('Pikes Place on San Miguel', '2026-04-01', '2026-02-02', null,         null, 'GB catch-up batch 2/2/26 — approval not evidenced'),
  ('Pikes Place on San Miguel', '2026-05-01', '2026-02-02', null,         null, 'GB catch-up batch 2/2/26 — approval not evidenced'),

  -- June: the cycle that stalled. Jenny chased on 4/14; the February
  -- approval could not be found on either side ("I don't see an approved
  -- email for Pikes and Pebble"). Re-approved 4/15. De Cortez had no June
  -- expirations. This thread is why this tracker exists.
  ('Pebble Creek',              '2026-06-01', '2026-04-14', '2026-04-15', null, 'GB "Pikes and Pebble - June Renewals" — prior approval lost, re-approved 4/15'),
  ('Pikes Place on San Miguel', '2026-06-01', '2026-04-14', '2026-04-15', null, 'GB "Pikes and Pebble - June Renewals" — prior approval lost, re-approved 4/15'),

  -- August: healthy. Offers 5/26, adjustments 5/28, approved 5/29.
  ('De Cortez',                 '2026-08-01', '2026-05-26', '2026-05-29', null, 'GB "De Cortez - August Renewals"; "I will get these sent out today" 5/29'),
  ('Pebble Creek',              '2026-08-01', '2026-05-26', '2026-05-29', null, 'GB "Pebble Creek - August Renewals"; sent out 5/29'),
  ('Pikes Place on San Miguel', '2026-08-01', '2026-05-26', '2026-05-29', null, 'GB "Pikes Place - August Renewals"; sent out 5/29'),

  -- September: the best cycle on record — one-day turnaround.
  ('De Cortez',                 '2026-09-01', '2026-06-25', '2026-06-26', null, 'GB "Sept Renewal Suggestions"; "These are approved." 6/26'),
  ('Pebble Creek',              '2026-09-01', '2026-06-25', '2026-06-26', null, 'GB "Sept Renewal Suggestions"; "These are approved." 6/26'),
  ('Pikes Place on San Miguel', '2026-09-01', '2026-06-25', '2026-06-26', null, 'GB "Sept Renewal Suggestions"; "These are approved." 6/26'),

  -- ── AMC (Kelli Anderson) — Fox Hill, three-party loop ─────
  ('Fox Hill Apartments',       '2026-04-01', '2026-02-06', null,         null, 'AMC "FHL April Renewals 2026"; questions 2/9, chased 2/12, answers 2/16 — approval not evidenced'),
  ('Fox Hill Apartments',       '2026-06-01', '2026-04-17', null,         null, 'AMC "FHL Renewals 6.2026"; HAP questions 4/20-4/22 — approval not evidenced'),
  ('Fox Hill Apartments',       '2026-07-01', '2026-05-06', null,         '2026-05-11', 'AMC "FHL Renewals 7.2026"; to JL 5/8, Sunset feedback 5/11 — our approval to AMC not evidenced'),
  ('Fox Hill Apartments',       '2026-09-01', null,         '2026-07-17', '2026-07-16', 'Nick→JL "September Renewal Offers" 7/16, JL replied same day; "These look good" 7/17 — AMC send date not found'),
  ('Fox Hill Apartments',       '2026-10-01', '2026-08-11', '2026-08-14', '2026-08-14', 'AMC "861FHL.RenewalOffers 10.2026" 8/11; forwarded to JL 8/14, replied same day')
) as v(name, expiration_month, received, approved, partner, notes)
join properties p on p.name = v.name
left join renewal_settings rs on rs.property_id = p.id
on conflict (property_id, expiration_month) do nothing;
