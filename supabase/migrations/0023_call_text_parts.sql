-- Staging for long call text written in pieces (2026-10-18). The SQL
-- tool the ingestion task uses rejects many long UPDATEs, while INSERTs
-- go through; so transcript / notes_md are inserted here in chunks and
-- assembled into calls.* with one short UPDATE ... string_agg. Rows are
-- left in place afterwards. Already applied to the live project.
create table if not exists call_text_parts (
  id bigserial primary key,
  call_id uuid not null references calls(id) on delete cascade,
  col text not null check (col in ('transcript','notes_md','summary')),
  seq int not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique (call_id, col, seq)
);
alter table call_text_parts enable row level security;
drop policy if exists "authenticated full access" on call_text_parts;
create policy "authenticated full access" on call_text_parts for all to authenticated using (true) with check (true);
