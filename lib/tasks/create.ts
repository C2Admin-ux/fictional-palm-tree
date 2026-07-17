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

// Insert + return the full row (null on failure — the caller decides
// how to surface it; some surfaces restore the typed text, others
// keep the palette open).
export async function insertTask(supabase: Client, payload: TaskInsert): Promise<Task | null> {
  const { data, error } = await supabase.from('tasks')
    .insert(payload)
    .select('*')
    .single()
  if (error || !data) return null
  return data as Task
}
