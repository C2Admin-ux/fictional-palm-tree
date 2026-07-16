// Task recurrence engine. The task modal has always written the
// recur_* fields; this module is what actually makes them real:
// when a recurring task is completed, createNextOccurrence() spawns
// the next instance (due date stepped from the ORIGINAL due date, not
// the completion date) and honors the configured end conditions.

import { addDays, addMonths, format, parseISO } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Task } from '@/lib/supabase/types'
import { todayISO } from '@/lib/utils'

type Client = SupabaseClient<Database>

export type RecurrenceFields = Pick<
  Task,
  'due_date' | 'recur_freq' | 'recur_interval' | 'recur_unit' |
  'recur_end_type' | 'recur_end_date' | 'recur_end_count' | 'recur_count'
>

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
  // drift the whole series. Dateless recurring tasks step from today.
  const base = parseISO(task.due_date ?? todayISO())

  let next: Date
  switch (task.recur_freq) {
    case 'daily':     next = addDays(base, 1);    break
    case 'weekly':    next = addDays(base, 7);    break
    case 'biweekly':  next = addDays(base, 14);   break
    case 'monthly':   next = addMonths(base, 1);  break
    case 'quarterly': next = addMonths(base, 3);  break
    case 'annually':  next = addMonths(base, 12); break
    case 'custom': {
      const interval = task.recur_interval ?? 1
      switch (task.recur_unit) {
        case 'months': next = addMonths(base, interval);   break
        case 'weeks':  next = addDays(base, interval * 7); break
        default:       next = addDays(base, interval);     break
      }
      break
    }
    default: return null
  }

  const due_date = format(next, 'yyyy-MM-dd')

  // "On date": stop once the series would step past the end date.
  if (task.recur_end_type === 'on' && task.recur_end_date && due_date > task.recur_end_date) {
    return null
  }

  return { due_date }
}

// Create the next instance of a completed recurring task. Returns the
// inserted row, or null when the series ended, an instance for that
// due date already exists (un-complete → re-complete guard), or the
// insert failed.
export async function createNextOccurrence(supabase: Client, task: Task): Promise<Task | null> {
  const next = nextOccurrence(task)
  if (!next) return null

  const parentId = task.recur_parent_id ?? task.id

  // Double-creation guard: one indexed lookup by series + due date.
  const { data: existing, error: lookupError } = await supabase
    .from('tasks')
    .select('id')
    .eq('recur_parent_id', parentId)
    .eq('due_date', next.due_date)
    .limit(1)
  if (lookupError || (existing && existing.length > 0)) return null

  const { data: created, error } = await supabase
    .from('tasks')
    .insert({
      title:            task.title,
      description:      task.description,
      property_id:      task.property_id,
      capex_project_id: task.capex_project_id,
      priority:         task.priority,
      tags:             task.tags ?? [],
      assigned_to:      task.assigned_to,
      created_by:       task.created_by,
      status:           'next_action',
      due_date:         next.due_date,
      recur_freq:       task.recur_freq,
      recur_interval:   task.recur_interval,
      recur_unit:       task.recur_unit,
      recur_end_type:   task.recur_end_type,
      recur_end_date:   task.recur_end_date,
      recur_end_count:  task.recur_end_count,
      recur_parent_id:  parentId,
      recur_count:      (task.recur_count ?? 0) + 1,
    })
    .select('*')
    .single()

  if (error || !created) return null
  return created as Task
}
