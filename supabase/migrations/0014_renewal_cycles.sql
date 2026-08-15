-- Renewal tracker (Sprint 15): when PMs send renewal offers for review,
-- and when we send approvals back.
--
-- The app TRACKS email traffic. It never composes or sends any part of a
-- renewal offer or approval — those happen in Gmail exactly as they do
-- today, and the legs below are marked on the board afterwards.
--
-- One row per property per EXPIRATION month (the month the leases being
-- renewed come up), which is how every PM actually batches them. Subjects
-- in the wild read "FHL Renewals 6.2026", "Pikes and Pebble - June
-- Renewals", "861FHL.RenewalOffers 10.2026" — the month named is always
-- the expiration month, never the send month.
--
-- Status is DERIVED from the date columns (see lib/renewals/cycles.ts),
-- never stored: a status column and three timestamps would be two sources
-- of truth for one fact.
--
-- Phase 2 (offer amounts, and outcomes resolved against move-outs) hangs
-- off this same row — that's why the grain is property × month rather
-- than something coarser.
--
-- Shared workspace data — house authenticated-full-access RLS.
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops.

create table if not exists renewal_cycles (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  -- Always the FIRST of the expiration month.
  expiration_month date not null,
  -- Snapshotted from renewal_settings.lead_days at generation, not
  -- recomputed on read: changing the cadence must not retroactively
  -- rewrite whether last quarter's offers were late.
  due_date date not null,
  -- The three legs. PM sent the offers for review; we approved; the
  -- equity partner approved (Fox Hill only — see requires_partner_approval).
  offer_received_at date,
  approved_at date,
  partner_approved_at date,
  -- 'email' for the normal flow; 'sheet' where the PM maintains a shared
  -- spreadsheet instead (Grant St), in which case nothing ever lands in
  -- the inbox and the chase task says "review the sheet" with the link.
  source text not null default 'email' check (source in ('email', 'sheet')),
  source_url text,
  notes text,
  chase_task_id uuid references tasks(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (property_id, expiration_month)
);

create index if not exists renewal_cycles_property_id_idx on renewal_cycles (property_id);
create index if not exists renewal_cycles_expiration_month_idx on renewal_cycles (expiration_month);

alter table renewal_cycles enable row level security;
do $$ begin
  create policy "authenticated full access" on renewal_cycles
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Per-property cadence. A property with no row uses the code defaults
-- (see lib/renewals/cycles.ts) — the generator never requires setup
-- before it will produce cycles.
create table if not exists renewal_settings (
  property_id uuid primary key references properties(id) on delete cascade,
  -- false parks a property without deleting its history (e.g. one where
  -- the PM handles renewals without our approval).
  enabled boolean not null default true,
  -- Days before the expiration month BEGINS that offers are due. 90 is
  -- the standard the PMs themselves stated; AMC runs nearer 50.
  lead_days int not null default 90,
  -- Fox Hill routes through the equity partner after our approval, so its
  -- cycle isn't closed until that leg lands.
  requires_partner_approval boolean not null default false,
  partner_label text,
  source text not null default 'email' check (source in ('email', 'sheet')),
  source_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table renewal_settings enable row level security;
do $$ begin
  create policy "authenticated full access" on renewal_settings
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

comment on column renewal_cycles.expiration_month is
  'First day of the month whose leases are being renewed — NOT the month the offer was sent.';
comment on column renewal_cycles.due_date is
  'Snapshotted at generation from renewal_settings.lead_days; never recomputed on read.';
comment on table renewal_settings is
  'Per-property renewal cadence. Absent row = code defaults (90 days, email, no partner leg).';
