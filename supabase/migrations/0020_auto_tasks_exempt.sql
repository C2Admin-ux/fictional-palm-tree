-- Ongoing-acquisition exemption (Nick, 2026-09-01): a property still in
-- the purchase process (Brix on Belleview) must stay visible in the app
-- but be exempt from every auto-generated task engine (obligations,
-- seasonal bids, renewals) and from coverage-gap flags — it has no
-- policies or contracts yet by definition, so the flags are pure noise.
-- Idempotent; safe to re-run.

alter table public.properties
  add column if not exists auto_tasks_exempt boolean not null default false;

comment on column public.properties.auto_tasks_exempt is
  'True while the property is an in-process acquisition: engines create no auto tasks and coverage-gap flags are suppressed. Set from Edit Property.';
