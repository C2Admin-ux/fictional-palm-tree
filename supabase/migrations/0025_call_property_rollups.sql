-- Per-property running summaries for multi-property call series
-- (2026-10-18, Nick's ask): the PLACES call covers Pebble Creek, De Cortez
-- and Pikes Place, so each property page gets its own "where things
-- stand" instead of the series-wide one. Portfolio-wide / general items
-- and notes go to the series' default property (Pikes for PLACES).
-- Already applied to the live project.
alter table call_series add column if not exists default_property_id uuid references properties(id);

create table if not exists call_property_rollups (
  series_id uuid not null references call_series(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  summary text not null default '',
  open_items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (series_id, property_id)
);
alter table call_property_rollups enable row level security;
drop policy if exists "authenticated full access" on call_property_rollups;
create policy "authenticated full access" on call_property_rollups for all to authenticated using (true) with check (true);

update call_series set default_property_id = property_ids[1] where default_property_id is null and cardinality(property_ids) = 1;
update call_series set default_property_id = (select id from properties where name = 'Pikes Place on San Miguel') where key = 'places - c2 weekly call';
