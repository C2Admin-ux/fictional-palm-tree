-- 0007: Drop the legacy DB-side recurrence trigger on tasks.
--
-- WHY: the live database carries a pre-repo trigger that, when a task
-- with recur_freq is marked done, inserts the "next occurrence" itself
-- (verified 2026-07-29 with a throwaway probe row: completing a monthly
-- task due 2026-05-05 spawned a sibling due 2026-06-04 — a flat +30-day
-- step — in the same statement, with auto_source='recurrence' and
-- recur_parent_id pointing at the completed row).
--
-- The app has since grown its own recurrence engine
-- (lib/tasks/recurrence.ts, invoked from lib/tasks/mutations.ts), so
-- every completion of a recurring task currently spawns TWO next
-- occurrences: the trigger's (+30d, so "monthly" drifts off the
-- day-of-month anchor) and the app's (+1 calendar month). The dates
-- differ, so the app's double-creation guard (series + due_date lookup)
-- can't see the trigger's row. Combined with stale past due dates on the
-- imported series, completing one overdue "Review P&L" instantly grew
-- two more overdue copies — the "completed tasks still show up" bug.
--
-- The trigger's function references the recur_* columns, which nothing
-- else DB-side does; the DO block below finds and drops any trigger on
-- public.tasks whose function mentions "recur", leaving unrelated
-- triggers (e.g. the updated_at stamper) alone.

do $$
declare
  t record;
begin
  for t in
    select tg.tgname, p.oid as fnoid, p.proname
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = tg.tgfoid
    where n.nspname = 'public'
      and c.relname = 'tasks'
      and not tg.tgisinternal
      and pg_get_functiondef(p.oid) ilike '%recur%'
  loop
    execute format('drop trigger %I on public.tasks', t.tgname);
    raise notice 'dropped trigger % (function %)', t.tgname, t.proname;
    -- Drop the now-orphaned function too (only if nothing else uses it).
    if not exists (
      select 1 from pg_trigger x where x.tgfoid = t.fnoid and x.tgname <> t.tgname
    ) then
      execute format('drop function if exists %s()', t.proname);
      raise notice 'dropped function %', t.proname;
    end if;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────
-- OPTIONAL CLEANUP (review before running — intentionally commented out).
--
-- Trigger-spawned duplicates are identifiable: the trigger stamped
-- auto_source = 'recurrence' on its inserts, a value no app code ever
-- writes (app spawns carry auto_source null). This lists the still-open
-- trigger-created occurrences so Nick can eyeball them before deleting:
--
--   select id, title, due_date, status, created_at
--   from tasks
--   where auto_source = 'recurrence' and status <> 'done'
--   order by title, due_date;
--
-- And deletes the open duplicates (completed ones carry history — keep):
--
--   delete from tasks
--   where auto_source = 'recurrence' and status <> 'done';
