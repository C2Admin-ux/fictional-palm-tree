// Task recurrence engine. The task modal has always written the
// recur_* fields; this module is what actually makes them real:
// when a recurring task is completed, createNextOccurrence() spawns
// the next instance (due date stepped from the ORIGINAL due date, not
// the completion date) and honors the configured end conditions.

import { addDays, addMonths, format, parseISO } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Task } from '@/lib/supabase/types'
import { nextOccurrenceBasePayload } from '@/lib/tasks/payload'
import { todayISO } from '@/lib/utils'

type Client = SupabaseClient<Database>

export type RecurrenceFields = Pick<
  Task,
  'due_date' | 'recur_freq' | 'recur_interval' | 'recur_unit' |
  'recur_end_type' | 'recur_end_date' | 'recur_end_count' | 'recur_count'
>

// One recurrence step from `date`, or null for an unknown frequency.
function stepOnce(task: RecurrenceFields, date: Date): Date | null {
  switch (task.recur_freq) {
    case 'daily':     return addDays(date, 1)
    case 'weekly':    return addDays(date, 7)
    case 'biweekly':  return addDays(date, 14)
    case 'monthly':   return addMonths(date, 1)
    case 'quarterly': return addMonths(date, 3)
    case 'annually':  return addMonths(date, 12)
    case 'custom': {
      const interval = task.recur_interval ?? 1
      switch (task.recur_unit) {
        case 'months': return addMonths(date, interval)
        case 'weeks':  return addDays(date, interval * 7)
        default:       return addDays(date, interval)
      }
    }
    default: return null
  }
}

// Next due date for a recurring task, or null when the series has
// reached its end condition (or the task isn't recurring).
export function nextOccurrence(task: RecurrenceFields): { due_date: string } | null {
  if (!task.recur_freq) return null

  // "After N times": the current instance is occurrence recur_count
  // (0-based), so the series has run recur_count+1 times once it's done.
  if (
    task.recur_end_type === 'after' &&
    task.recur_end_count != null &&
    (task.recur_count ?? 0) + 1 >= task.recur_end_count
  ) return null

  // Step from the original due date — a task completed late shouldn't
  // drift the series anchor (day-of-month / weekday). Dateless recurring
  // tasks step from today.
  const base = parseISO(task.due_date ?? todayISO())

  let next = stepOnce(task, base)
  if (!next) return null
  // A zero/negative custom interval can't advance — bail rather than loop.
  if (next <= base) return null

  // CATCH UP past today. Completing a long-overdue instance used to spawn
  // the next occurrence one step from the stale due date — often still in
  // the past, so a near-identical overdue row reappeared instantly and
  // completions looked like they didn't stick. Keep stepping (anchor
  // preserved) until the next occurrence is actually in the future.
  const today = todayISO()
  for (let i = 0; format(next, 'yyyy-MM-dd') <= today && i < 1000; i++) {
    const stepped = stepOnce(task, next)
    if (!stepped || stepped <= next) break
    next = stepped
  }

  const due_date = format(next, 'yyyy-MM-dd')

  // "On date": stop once the series would step past the end date.
  if (task.recur_end_type === 'on' && task.recur_end_date && due_date > task.recur_end_date) {
    return null
  }

  return { due_date }
}

// Where a recurring task's next occurrence lives. A recurring SUBTASK
// usually stays under its parent — but if the parent project is
// already 'done', the spawned occurrence would be INVISIBLE: subtasks
// never render as top-level rows, and a done parent only surfaces in
// buried done sections (or falls outside fetch windows entirely). So
// the occurrence spawns TOP-LEVEL instead: the project is finished;
// the recurring obligation continues standalone.
export function nextParentTaskId(
  task: Pick<Task, 'parent_task_id'>,
  parentStatus: Task['status'] | null
): string | null {
  if (!task.parent_task_id) return null
  return parentStatus === 'done' ? null : task.parent_task_id
}

// Outcome of a spawn attempt. `task` is the inserted row; a null task
// with a null error means the series ended (or the occurrence already
// exists) — nothing to do. A non-null error means the spawn SHOULD have
// happened but a DB call failed; callers surface it (the completion
// itself already committed and must not be walked back for this).
export type NextOccurrenceResult = { task: Task | null; error: string | null }

// Create the next instance of a completed recurring task.
//
// Subtasks: spawning does NOT copy the completed task's subtasks — a
// recurring PARENT's next occurrence starts with an empty subtask list
// (only the single row below is inserted). A recurring SUBTASK's next
// occurrence keeps its parent_task_id UNLESS the parent is done, in
// which case it spawns top-level (see nextParentTaskId). Callers that
// already know the parent's status pass it via ctx (the bulk-complete
// path completes the parent in the same action); otherwise one indexed
// select resolves it.
export async function createNextOccurrence(
  supabase: Client, task: Task,
  ctx?: { parentStatus?: Task['status'] }
): Promise<NextOccurrenceResult> {
  const next = nextOccurrence(task)
  if (!next) return { task: null, error: null }

  const parentId = task.recur_parent_id ?? task.id

  // Double-creation guard: one indexed lookup by series + due date.
  const { data: existing, error: lookupError } = await supabase
    .from('tasks')
    .select('id')
    .eq('recur_parent_id', parentId)
    .eq('due_date', next.due_date)
    .limit(1)
  // A failed lookup skips the insert (double-creation risk beats a
  // missed spawn) but is surfaced rather than swallowed.
  if (lookupError) return { task: null, error: lookupError.message }
  if (existing && existing.length > 0) return { task: null, error: null }

  let parentStatus: Task['status'] | null = ctx?.parentStatus ?? null
  if (task.parent_task_id && parentStatus == null) {
    const { data: parentRow } = await supabase
      .from('tasks').select('status').eq('id', task.parent_task_id).maybeSingle()
    parentStatus = (parentRow?.status as Task['status'] | undefined) ?? null
  }

  // Everything that isn't per-instance state carries forward (derived
  // in lib/tasks/payload.ts — one source of truth, keeps future columns).
  const { data: created, error } = await supabase
    .from('tasks')
    .insert({
      ...nextOccurrenceBasePayload(task),
      status:          'next_action',
      due_date:        next.due_date,
      parent_task_id:  nextParentTaskId(task, parentStatus),
      recur_parent_id: parentId,
      recur_count:     (task.recur_count ?? 0) + 1,
    })
    .select('*')
    .single()

  if (error || !created) return { task: null, error: error?.message ?? 'insert returned no row' }
  return { task: created as Task, error: null }
}
