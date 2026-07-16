// Optimistic task mutations shared by the tasks page and the property
// profile Tasks tab. Each helper applies the change to local state
// immediately via the caller-supplied store, fires the Supabase write
// async, and rolls the local state back (with an error toast) if the
// write fails. Destructive/undoable actions surface an Undo toast.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Task } from '@/lib/supabase/types'
import { toast } from '@/components/ui/toast'

type Client = SupabaseClient<Database>

// Local-state adapter: how the calling page mutates its task list.
// `insert` receives a bare Task row — pages holding enriched rows
// (joined property names etc.) enrich inside their implementation.
export type TaskStore = {
  update: (id: string, fields: Partial<Task>) => void
  insert: (task: Task) => void
  remove: (id: string) => void
}

// Everything on a Task row except generated/managed columns — used to
// re-insert a deleted row (same id) when the user hits Undo.
export function taskInsertPayload(task: Task): Partial<Task> & { title: string } {
  return {
    id:                 task.id,
    title:              task.title,
    description:        task.description,
    property_id:        task.property_id,
    capex_project_id:   task.capex_project_id,
    deal_id:            task.deal_id,
    status:             task.status,
    priority:           task.priority,
    due_date:           task.due_date,
    snoozed_until:      task.snoozed_until,
    assigned_to:        task.assigned_to,
    created_by:         task.created_by,
    completed_at:       task.completed_at,
    tags:               task.tags ?? [],
    blocked_by_task_id: task.blocked_by_task_id,
    recur_freq:         task.recur_freq,
    recur_interval:     task.recur_interval,
    recur_unit:         task.recur_unit,
    recur_end_type:     task.recur_end_type,
    recur_end_date:     task.recur_end_date,
    recur_end_count:    task.recur_end_count,
    recur_count:        task.recur_count,
    recur_parent_id:    task.recur_parent_id,
    auto_source:        task.auto_source,
    source_record_id:   task.source_record_id,
  }
}

// Generic optimistic field update (inline edits, snooze, priority…).
export async function patchTaskOptimistic(
  supabase: Client, store: TaskStore, task: Task, fields: Partial<Task>
) {
  store.update(task.id, fields)
  const { error } = await supabase.from('tasks').update(fields).eq('id', task.id)
  if (error) {
    const rollback: Partial<Task> = {}
    for (const key of Object.keys(fields) as (keyof Task)[]) {
      ;(rollback as Record<string, unknown>)[key] = task[key]
    }
    store.update(task.id, rollback)
    toast('Could not save — change reverted', { tone: 'error' })
  }
}

// Complete / un-complete toggle with an Undo toast on completion.
export async function toggleDoneOptimistic(
  supabase: Client, store: TaskStore, task: Task,
  opts?: { onCompleted?: (task: Task) => void | Promise<void> }
) {
  const wasDone = task.status === 'done'
  const fields: Partial<Task> = wasDone
    ? { status: 'next_action', completed_at: null }
    : { status: 'done', completed_at: new Date().toISOString() }

  store.update(task.id, fields)
  const { error } = await supabase.from('tasks').update(fields).eq('id', task.id)
  if (error) {
    store.update(task.id, { status: task.status, completed_at: task.completed_at })
    toast('Could not update task', { tone: 'error' })
    return
  }

  if (wasDone) return

  toast('Completed', {
    action: {
      label: 'Undo',
      onClick: () => {
        const revert: Partial<Task> = { status: task.status, completed_at: task.completed_at }
        store.update(task.id, revert)
        supabase.from('tasks').update(revert).eq('id', task.id).then(({ error: undoError }) => {
          if (undoError) {
            store.update(task.id, fields)
            toast('Could not undo', { tone: 'error' })
          }
        })
      },
    },
  })

  await opts?.onCompleted?.({ ...task, ...fields })
}

// Instant optimistic delete with an Undo toast that re-inserts the
// captured row (same id — the delete has already committed, so the id
// is free again).
export async function deleteTaskOptimistic(
  supabase: Client, store: TaskStore, task: Task,
  opts?: { onRestored?: (task: Task) => void | Promise<void> }
) {
  store.remove(task.id)
  const { error } = await supabase.from('tasks').delete().eq('id', task.id)
  if (error) {
    store.insert(task)
    toast('Could not delete task', { tone: 'error' })
    return
  }

  toast('Task deleted', {
    action: {
      label: 'Undo',
      onClick: async () => {
        store.insert(task)
        const { error: restoreError } = await supabase.from('tasks').insert(taskInsertPayload(task))
        if (restoreError) {
          store.remove(task.id)
          toast('Could not restore task', { tone: 'error' })
          return
        }
        await opts?.onRestored?.(task)
      },
    },
  })
}
