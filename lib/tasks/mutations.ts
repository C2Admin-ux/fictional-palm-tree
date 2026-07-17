// Optimistic task mutations shared by the tasks page and the property
// profile Tasks tab. Each helper applies the change to local state
// immediately via the caller-supplied store, fires the Supabase write
// async, and rolls the local state back (with an error toast) if the
// write fails. Destructive/undoable actions surface an Undo toast.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Task } from '@/lib/supabase/types'
import { toast } from '@/components/ui/toast'
import { createNextOccurrence } from '@/lib/tasks/recurrence'
import { taskInsertPayload } from '@/lib/tasks/payload'
import { formatDateShort } from '@/lib/utils'

type Client = SupabaseClient<Database>

// Local-state adapter: how the calling page mutates its task list.
// `insert` receives a bare Task row — pages holding enriched rows
// (joined property names etc.) enrich inside their implementation.
export type TaskStore = {
  update: (id: string, fields: Partial<Task>) => void
  insert: (task: Task) => void
  remove: (id: string) => void
}

// Generic optimistic field update (inline edits, snooze, priority…).
// Stamps updated_at in both the write and the local merge so staleness
// displays ("waiting Nd") move the moment the row is touched.
export async function patchTaskOptimistic(
  supabase: Client, store: TaskStore, task: Task, fields: Partial<Task>
) {
  const stamped: Partial<Task> = { ...fields, updated_at: new Date().toISOString() }
  store.update(task.id, stamped)
  const { error } = await supabase.from('tasks').update(stamped).eq('id', task.id)
  if (error) {
    const rollback: Partial<Task> = {}
    for (const key of Object.keys(stamped) as (keyof Task)[]) {
      ;(rollback as Record<string, unknown>)[key] = task[key]
    }
    store.update(task.id, rollback)
    toast('Could not save — change reverted', { tone: 'error' })
  }
}

// Snooze with a confirmation toast — one implementation for every
// surface (row menu, swipe gesture, keyboard shortcut).
export function snoozeTaskOptimistic(
  supabase: Client, store: TaskStore, task: Task, date: string
) {
  void patchTaskOptimistic(supabase, store, task, { snoozed_until: date })
  toast(`Snoozed until ${formatDateShort(date)}`)
}

// Complete / un-complete toggle with an Undo toast on completion.
// Completing a recurring task also spawns its next instance (guarded
// against double-creation inside createNextOccurrence) BEFORE the
// toast, so Undo can remove the spawned instance along with reverting
// the completion.
export async function toggleDoneOptimistic(
  supabase: Client, store: TaskStore, task: Task
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

  let spawned: Task | null = null
  if (task.recur_freq) {
    spawned = await createNextOccurrence(supabase, task)
    if (spawned) store.insert(spawned)
  }

  const message = spawned
    ? `Completed — next occurrence ${formatDateShort(spawned.due_date)}`
    : 'Completed'
  toast(message, {
    action: {
      label: 'Undo',
      onClick: () => {
        const revert: Partial<Task> = { status: task.status, completed_at: task.completed_at }
        store.update(task.id, revert)
        if (spawned) store.remove(spawned.id)
        void (async () => {
          const { error: undoError } = await supabase.from('tasks').update(revert).eq('id', task.id)
          if (spawned) await supabase.from('tasks').delete().eq('id', spawned.id)
          if (undoError) {
            store.update(task.id, fields)
            toast('Could not undo', { tone: 'error' })
          }
        })()
      },
    },
  })
}

// Instant optimistic delete with an Undo toast that re-inserts the
// captured row (same id — the delete has already committed, so the id
// is free again). Undo also restores what died with the row:
// task_contacts junction rows (pass the ids) and dependents'
// blocked_by_task_id links (nulled by the FK's ON DELETE SET NULL).
export async function deleteTaskOptimistic(
  supabase: Client, store: TaskStore, task: Task,
  opts?: { contactIds?: string[] }
) {
  store.remove(task.id)

  // Capture dependents before the delete nulls their FK.
  const { data: deps } = await supabase
    .from('tasks').select('id').eq('blocked_by_task_id', task.id)
  const dependentIds = (deps ?? []).map(d => d.id)

  const { error } = await supabase.from('tasks').delete().eq('id', task.id)
  if (error) {
    store.insert(task)
    toast('Could not delete task', { tone: 'error' })
    return
  }

  // Mirror the DB's SET NULL locally so no row keeps pointing at a
  // blocker that no longer exists.
  for (const id of dependentIds) store.update(id, { blocked_by_task_id: null })

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
        const contactIds = opts?.contactIds ?? []
        if (contactIds.length > 0) {
          await supabase.from('task_contacts').insert(
            contactIds.map(cid => ({ task_id: task.id, contact_id: cid }))
          )
        }
        if (dependentIds.length > 0) {
          await supabase.from('tasks')
            .update({ blocked_by_task_id: task.id }).in('id', dependentIds)
          for (const id of dependentIds) store.update(id, { blocked_by_task_id: task.id })
        }
      },
    },
  })
}
