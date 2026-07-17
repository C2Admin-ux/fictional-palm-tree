// Shared task-creation path for every quick-capture surface (the tasks
// page bar, the property Tasks tab, the global capture sheet, and the
// command palette). One place owns the capture rules:
//   dated  → next_action (an inbox item with a date is contradictory)
//   undated → inbox
//   created_by / assigned_to = the capturing user
// A preset property (property page context) beats a parser match.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Task } from '@/lib/supabase/types'
import type { ParsedQuickAdd } from '@/lib/tasks/quick-add'

type Client = SupabaseClient<Database>
type TaskInsert = Database['public']['Tables']['tasks']['Insert']

export function quickAddInsertPayload(
  parsed: ParsedQuickAdd, userId: string, presetPropertyId?: string | null
): TaskInsert {
  return {
    title:       parsed.title,
    status:      parsed.due_date ? 'next_action' : 'inbox',
    priority:    parsed.priority ?? 'medium',
    due_date:    parsed.due_date ?? null,
    tags:        parsed.tags ?? [],
    property_id: presetPropertyId ?? parsed.property_id ?? null,
    created_by:  userId,
    assigned_to: userId,
  }
}

// One-tap task from an inspection finding: immediately actionable
// (next_action — the finding IS the processing), property from the
// inspection, priority straight from action_priority (same vocabulary
// as tasks.priority), description pointing back at the source finding.
// No due date by default.
export function findingTaskInsertPayload(opts: {
  title: string
  propertyId: string
  actionPriority: string | null
  sourceNote: string
  userId: string
}): TaskInsert {
  const p = opts.actionPriority
  return {
    title:       opts.title,
    status:      'next_action',
    priority:    p === 'low' || p === 'medium' || p === 'high' || p === 'urgent' ? p : 'medium',
    due_date:    null,
    description: opts.sourceNote,
    property_id: opts.propertyId,
    created_by:  opts.userId,
    assigned_to: opts.userId,
  }
}

// Broadcast: every successful insert through this path announces the
// new row on `window`, so any open list (tasks page, property Tasks
// tab) can pick it up without a refetch — a task captured from the
// global sheet or the palette appears on screen immediately.
// Subscribers dedupe by id, so surfaces that also insert directly
// (inline quick-add bars) stay correct.
export const TASK_CREATED_EVENT = 'c2:task-created'

// Insert + return the full row (null on failure — the caller decides
// how to surface it; some surfaces restore the typed text, others
// keep the palette open).
export async function insertTask(supabase: Client, payload: TaskInsert): Promise<Task | null> {
  const { data, error } = await supabase.from('tasks')
    .insert(payload)
    .select('*')
    .single()
  if (error || !data) return null
  const task = data as Task
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<Task>(TASK_CREATED_EVENT, { detail: task }))
  }
  return task
}
