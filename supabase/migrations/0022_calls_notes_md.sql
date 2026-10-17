-- Transcript-first call notes (2026-10-17, Nick's ask): Gemini's own
-- notes are thin, so calls are now processed from the verbatim
-- Transcript tab of the "Notes by Gemini" Drive doc and Claude writes
-- the notes itself. notes_md holds that write-up (shown on the call
-- page above the raw transcript); transcript_kind says what the
-- transcript column actually holds. Already applied to the live project.

alter table calls
  add column if not exists notes_md text,
  add column if not exists source_doc_id text,
  add column if not exists transcript_kind text not null default 'gemini_notes';
alter table calls drop constraint if exists calls_transcript_kind_check;
alter table calls add constraint calls_transcript_kind_check check (transcript_kind in ('gemini_notes','transcript','paste'));
