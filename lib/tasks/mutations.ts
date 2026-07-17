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
//
// Completing a PARENT completes its open subtasks in the same action
// (pass them via opts.openSubtasks): one toast, one Undo that restores
// the parent AND every child to its prior status. Un-completing never
// touches children.
export async function toggleDoneOptimistic(
  supabase: Client, store: TaskStore, task: Task,
  opts?: { openSubtasks?: Task[] }
) {
  const wasDone = task.status === 'done'
  const now = new Date().toISOString()
  const fields: Partial<Task> = wasDone
    ? { status: 'next_action', completed_at: null }
    : { status: 'done', completed_at: now }

  const children = wasDone ? [] : (opts?.openSubtasks ?? [])
  // Children can sit in different statuses — capture each one so Undo
  // puts every row back exactly where it was.
  const childPrior = children.map(c => ({ id: c.id, status: c.status, completed_at: c.completed_at }))
  const revertChildren = () => {
    for (const p of childPrior) store.update(p.id, { status: p.status, completed_at: p.completed_at })
  }

  store.update(task.id, fields)
  for (const c of children) store.update(c.id, { status: 'done', completed_at: now })

  const { error } = await supabase.from('tasks').update(fields).eq('id', task.id)
  if (error) {
    store.update(task.id, { status: task.status, completed_at: task.completed_at })
    revertChildren()
    toast('Could not update task', { tone: 'error' })
    return
  }

  if (children.length > 0) {
    const { error: childError } = await supabase.from('tasks')
      .update({ status: 'done', completed_at: now })
      .in('id', children.map(c => c.id))
    if (childError) {
      // Parent landed but children didn't — roll everything back so the
      // user never sees a half-completed project.
      store.update(task.id, { status: task.status, completed_at: task.completed_at })
      revertChildren()
      await supabase.from('tasks')
        .update({ status: task.status, completed_at: task.completed_at }).eq('id', task.id)
      toast('Could not update task', { tone: 'error' })
      return
    }
  }

  if (wasDone) return

  let spawned: Task | null = null
  if (task.recur_freq) {
    spawned = await createNextOccurrence(supabase, task)
    if (spawned) store.insert(spawned)
  }

  const base = children.length > 0
    ? `Completed with ${children.length} subtask${children.length === 1 ? '' : 's'}`
    : 'Completed'
  const message = spawned
    ? `${base} — next occurrence ${formatDateShort(spawned.due_date)}`
    : base
  toast(message, {
    action: {
      label: 'Undo',
      onClick: () => {
        const revert: Partial<Task> = { status: task.status, completed_at: task.completed_at }
        store.update(task.id, revert)
        revertChildren()
        if (spawned) store.remove(spawned.id)
        void (async () => {
          const { error: undoError } = await supabase.from('tasks').update(revert).eq('id', task.id)
          // Prior statuses differ per child, so restore row by row.
          for (const p of childPrior) {
            await supabase.from('tasks')
              .update({ status: p.status, completed_at: p.completed_at }).eq('id', p.id)
          }
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
// task_contacts junction rows (pass the ids), dependents'
// blocked_by_task_id links (nulled by the FK's ON DELETE SET NULL),
// and subtasks (removed by parent_task_id's ON DELETE CASCADE) —
// captured with their own contact links before the delete commits.
export async function deleteTaskOptimistic(
  supabase: Client, store: TaskStore, task: Task,
  opts?: { contactIds?: string[] }
) {
  store.remove(task.id)

  // Capture what the delete will destroy beyond the row itself:
  // dependents lose their FK (SET NULL), children die with it (CASCADE).
  const [{ data: deps }, { data: childRows }] = await Promise.all([
    supabase.from('tasks').select('id').eq('blocked_by_task_id', task.id),
    supabase.from('tasks').select('*, task_contacts(contact_id)').eq('parent_task_id', task.id),
  ])
  const dependentIds = (deps ?? []).map(d => d.id).filter(id => id !== task.id)
  const children = (childRows ?? []) as unknown as (Task & { task_contacts: { contact_id: string }[] | null })[]

  const { error } = await supabase.from('tasks').delete().eq('id', task.id)
  if (error) {
    store.insert(task)
    toast('Could not delete task', { tone: 'error' })
    return
  }

  // Mirror the DB's SET NULL / CASCADE locally so no row keeps
  // pointing at a blocker or parent that no longer exists.
  for (const id of dependentIds) store.update(id, { blocked_by_task_id: null })
  for (const c of children) store.remove(c.id)

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
        // Children after the parent (their FK needs the parent row) —
        // same ids, so expanded state and blockers pointing at them heal.
        if (children.length > 0) {
          await supabase.from('tasks').insert(children.map(c => taskInsertPayload(c)))
          const childContacts = children.flatMap(c =>
            (c.task_contacts ?? []).map(tc => ({ task_id: c.id, contact_id: tc.contact_id }))
          )
          if (childContacts.length > 0) {
            await supabase.from('task_contacts').insert(childContacts)
          }
          for (const c of children) store.insert(c)
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

// Inline "+ subtask" capture from an expanded parent: plain title,
// inherits the parent's property, lands as an immediately-actionable
// next_action owned by the current user. (Quick-add never creates
// subtasks — this is the only creation path besides the modal's
// parent select.)
export async function addSubtaskOptimistic(
  supabase: Client, store: TaskStore, parent: Task, title: string, userId: string | null
): Promise<void> {
  const { data, error } = await supabase.from('tasks')
    .insert({
      title,
      parent_task_id: parent.id,
      property_id:    parent.property_id,
      status:         'next_action',
      priority:       'medium',
      created_by:     userId,
      assigned_to:    userId,
    })
    .select('*')
    .single()
  if (error || !data) {
    toast('Could not add subtask', { tone: 'error' })
    return
  }
  store.insert(data as Task)
}
