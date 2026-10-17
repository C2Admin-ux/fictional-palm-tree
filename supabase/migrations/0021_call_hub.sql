-- Call hub (2026-10-17): recurring-call series, a running "where things
-- stand" summary per series, saved next-call agendas, and full-text
-- search across every call.
--
-- Builds on 0014-era calls / call_items rather than replacing them:
--   • call_series  — one row per recurring meeting (matched by title key,
--     e.g. 'places - c2 weekly call'). Carries the PMC, covered properties
--     and cadence, so an ingested email can be auto-assigned instead of
--     waiting for the PMC to be picked by hand.
--   • calls        — gains series_id, meeting_at, attendees, notes_url,
--     recap_* bookkeeping, and a generated tsvector for search. source now
--     also allows 'gemini'.
--   • call_rollups — the at-a-glance running summary, open items and
--     recent decisions for a series (one row per series, upserted after
--     each call is processed).
--   • call_agendas — the generated next-call agenda per series (editable).
--   • search_calls — ranked full-text search over title + summary + notes.
--
-- Shared workspace data — house authenticated-full-access RLS.
-- Idempotent: run in Supabase SQL Editor; re-runs are no-ops. (Already
-- applied to the live project on 2026-10-17 — this file keeps the repo in
-- step with it.)

create table if not exists call_series (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,                       -- lowercased meeting title used for matching (prefix match)
  display_name text not null,
  pmc_id uuid references pmcs(id),
  property_ids uuid[] not null default '{}',
  default_recipients text[] not null default '{}', -- unused for now: recap recipients are added by hand
  always_cc text[] not null default '{}',
  cadence_days int not null default 7,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table calls drop constraint if exists calls_source_check;
alter table calls add constraint calls_source_check check (source = any (array['paste','email','gemini']));

alter table calls
  add column if not exists series_id uuid references call_series(id),
  add column if not exists meeting_at timestamptz,
  add column if not exists attendees jsonb not null default '[]'::jsonb,
  add column if not exists notes_url text,
  add column if not exists recap_status text not null default 'none',
  add column if not exists recap_draft_id text,
  add column if not exists recap_draft_url text;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'calls' and column_name = 'search_tsv') then
    alter table calls add column search_tsv tsvector generated always as (
      to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(transcript,''))
    ) stored;
  end if;
end $$;

alter table calls drop constraint if exists calls_recap_status_check;
alter table calls add constraint calls_recap_status_check check (recap_status = any (array['none','drafted','sent','skipped']));

create index if not exists calls_series_date_idx on calls (series_id, call_date desc);
create index if not exists calls_search_idx on calls using gin (search_tsv);

create table if not exists call_rollups (
  series_id uuid primary key references call_series(id) on delete cascade,
  summary text not null default '',
  open_items jsonb not null default '[]'::jsonb,     -- [{text, owner, since, property}]
  recent_decisions jsonb not null default '[]'::jsonb, -- [{text, date}]
  call_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists call_agendas (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references call_series(id) on delete cascade,
  for_date date,
  body text not null,
  based_on_call_id uuid references calls(id),
  status text not null default 'draft' check (status in ('draft','final')),
  created_at timestamptz not null default now()
);
create index if not exists call_agendas_series_idx on call_agendas (series_id, created_at desc);

alter table call_series enable row level security;
alter table call_rollups enable row level security;
alter table call_agendas enable row level security;
drop policy if exists "authenticated full access" on call_series;
drop policy if exists "authenticated full access" on call_rollups;
drop policy if exists "authenticated full access" on call_agendas;
create policy "authenticated full access" on call_series for all to authenticated using (true) with check (true);
create policy "authenticated full access" on call_rollups for all to authenticated using (true) with check (true);
create policy "authenticated full access" on call_agendas for all to authenticated using (true) with check (true);

create or replace function search_calls(q text, p_series uuid default null, lim int default 25)
returns table (call_id uuid, series_id uuid, title text, call_date date, rank real, snippet text)
language sql stable security invoker set search_path = public as $$
  select c.id, c.series_id, c.title, c.call_date,
         ts_rank(c.search_tsv, websearch_to_tsquery('english', q)) as rank,
         ts_headline('english', coalesce(c.summary,'') || E'\n' || coalesce(c.transcript,''),
                     websearch_to_tsquery('english', q),
                     'MaxWords=40, MinWords=15, MaxFragments=2, FragmentDelimiter= … ') as snippet
  from calls c
  where c.search_tsv @@ websearch_to_tsquery('english', q)
    and (p_series is null or c.series_id = p_series)
  order by rank desc, c.call_date desc
  limit lim;
$$;

-- Seed the recurring series (ids of PMCs / properties resolved by name so
-- this runs on any copy of the data). Re-runs leave existing rows alone.
insert into call_series (key, display_name, pmc_id, property_ids, always_cc)
select 'places - c2 weekly call', 'PLACES – C2 Weekly Call', 'a1000000-0000-0000-0000-000000000002'::uuid,
  (select array_agg(id) from properties where name in ('Pebble Creek','Pikes Place on San Miguel','De Cortez')), array['cory@c2cpllc.com']
union all
select '3270 s grant - weekly call', '3270 S Grant – Weekly Call', 'a1000000-0000-0000-0000-000000000004'::uuid,
  (select array_agg(id) from properties where name = 'Debbie J II'), array['cory@c2cpllc.com']
union all
select 'main street littleton - weekly call', 'Main Street Littleton – Weekly Call', 'a1000000-0000-0000-0000-000000000004'::uuid,
  (select array_agg(id) from properties where name = 'Main Street Apartments'), array['cory@c2cpllc.com']
union all
select 'fhl - weekly management call', 'FHL – Weekly Management Call', 'a1000000-0000-0000-0000-000000000001'::uuid,
  (select array_agg(id) from properties where name = 'Fox Hill Apartments'), array['cory@c2cpllc.com']
union all
select 'cottages on vance - weekly pm call', 'Cottages on Vance – Weekly PM Call', 'a1000000-0000-0000-0000-000000000003'::uuid,
  (select array_agg(id) from properties where name = 'Cottages on Vance'), array['cory@c2cpllc.com']
on conflict (key) do nothing;

update calls c set series_id = s.id
from call_series s
where c.series_id is null and lower(c.title) like s.key || '%';
