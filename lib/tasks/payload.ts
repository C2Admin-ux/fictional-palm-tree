// Single source of truth for which Task columns travel with a row when
// it is re-created. The undo path re-inserts a deleted task verbatim
// (taskInsertPayload) and the recurrence engine derives the next
// instance from that same payload (nextOccurrenceBasePayload). Both
// are derived by OMISSION rather than hand-typed pick lists, so any
// column added to the tasks table carries forward automatically.

import type { Database, Task } from '@/lib/supabase/types'

type TaskInsert = Database['public']['Tables']['tasks']['Insert']

function omit<T extends object>(obj: T, keys: readonly string[]): Partial<T> {
  const out = { ...obj } as Record<string, unknown>
  for (const key of keys) delete out[key]
  return out as Partial<T>
}

// Generated/managed columns, plus keys that joined selects may attach
// to a row (never real columns) — none of these belong in an insert.
const NON_INSERT_KEYS = [
  'created_at', 'updated_at',
  'properties', 'capex_projects', 'contacts', 'task_contacts',
] as const

// Everything on a Task row except generated/managed columns — used to
// re-insert a deleted row (same id) when the user hits Undo.
export function taskInsertPayload(task: Task): TaskInsert {
  return { ...omit(task, NON_INSERT_KEYS), title: task.title }
}

// Identity/state that belongs to the completed instance only — the
// next occurrence gets fresh values for all of these.
// parent_task_id is deliberately NOT here: a recurring subtask's next
// occurrence stays under the same parent. (A recurring parent's next
// occurrence still starts with no children — recurrence inserts one
// row and never copies subtasks.)
const PER_INSTANCE_KEYS = [
  'id', 'status', 'due_date', 'completed_at', 'snoozed_until',
  'recur_parent_id', 'recur_count', 'auto_source', 'source_record_id',
] as const

// What carries forward into the next occurrence of a recurring task
// (title, description, property/capex/deal links, priority, tags,
// people, recur_* config…). The caller sets the per-instance overrides.
export function nextOccurrenceBasePayload(task: Task): TaskInsert {
  return { ...omit(taskInsertPayload(task), PER_INSTANCE_KEYS), title: task.title }
}
