-- 0010: overall_rating holds the 0-100 inspection score, not the legacy 1-5 rating.
--
-- The inspections table predates this repo (dashboard-created); its original
-- design constrained overall_rating to a 1-5 scale. Since Sprint 7 the report
-- generator persists the issue-count score (0-100) into this column, which the
-- legacy check rejected ("Report stored but could not save its path").
-- Idempotent: safe to re-run.

alter table inspections drop constraint if exists inspections_overall_rating_check;

do $$ begin
  alter table inspections add constraint inspections_overall_rating_check
    check (overall_rating is null or (overall_rating >= 0 and overall_rating <= 100));
exception when duplicate_object then null;
end $$;
