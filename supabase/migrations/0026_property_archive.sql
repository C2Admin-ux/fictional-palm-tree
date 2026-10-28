-- Property archive (Nick, 2026-10-21/27): a property we are no longer
-- pursuing or no longer own (Brix on Belleview — acquisition dropped)
-- should leave the working app without being deleted. Its documents,
-- calls, inspections and tasks stay queryable from its property page,
-- but it disappears from the sidebar, every picker/filter, the
-- dashboard, and all auto-task engines.
--
-- The 2026-10-21 archive of Brix was applied straight to the database
-- (status + archived_at + archive_reason + auto_tasks_exempt) before the
-- app knew the state existed. This migration records that schema so the
-- repo matches production. Idempotent; safe to re-run.

alter table public.properties
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

alter table public.properties drop constraint if exists properties_status_check;
alter table public.properties add constraint properties_status_check
  check (status = any (array['active', 'disposition', 'watchlist', 'archived']));

-- status and archived_at move together: archiving stamps archived_at,
-- unarchiving clears it (and the reason). Enforced here so a direct SQL
-- edit can't leave a half-archived row.
alter table public.properties drop constraint if exists properties_archived_at_check;
alter table public.properties add constraint properties_archived_at_check
  check ((status = 'archived') = (archived_at is not null));

-- Archive / restore live in the DB so every caller (app, SQL, future
-- agents) gets the same side effects. These were applied to production
-- on 2026-10-22 (migration add_archive_property_function); repeated
-- here verbatim so the repo carries the definition.

create or replace function public.archive_property(p_property_id uuid, p_reason text default null)
returns public.properties
language plpgsql
set search_path to 'public'
as $$
declare
  v_row public.properties;
begin
  update public.properties
     set status = 'archived',
         archived_at = now(),
         archive_reason = p_reason,
         auto_tasks_exempt = true,
         notes = case when notes is null or notes = '' then 'ARCHIVED ' || to_char(now(), 'YYYY-MM-DD') || coalesce(': ' || p_reason, '')
                      else 'ARCHIVED ' || to_char(now(), 'YYYY-MM-DD') || coalesce(': ' || p_reason, '') || E'\n\n' || notes end
   where id = p_property_id
     and status <> 'archived'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Property % not found or already archived', p_property_id;
  end if;

  -- stop the renewal engine for this property
  update public.renewal_settings set enabled = false, updated_at = now() where property_id = p_property_id;

  return v_row;
end;
$$;

create or replace function public.unarchive_property(p_property_id uuid, p_status text default 'active')
returns public.properties
language plpgsql
set search_path to 'public'
as $$
declare
  v_row public.properties;
begin
  update public.properties
     set status = p_status, archived_at = null, archive_reason = null
   where id = p_property_id and status = 'archived'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Property % not found or not archived', p_property_id;
  end if;
  return v_row;
end;
$$;

comment on column public.properties.archived_at is
  'Set when status flips to archived (lib/properties.archiveProperty); null otherwise. Archived properties are hidden from the sidebar, pickers, dashboard and auto-task engines but remain reachable at /properties/{id}.';
comment on column public.properties.archive_reason is
  'Why the property was archived (deal dropped, sold, …). Shown in the property-page banner and Settings.';
