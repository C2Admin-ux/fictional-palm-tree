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
import { invalidateInspectionReports } from '@/lib/inspections/invalidate'
import { formatDateShort } from '@/lib/utils'

type Client = SupabaseClient<Database>

// The auto-resolve stamp a task completion leaves on its linked
// inspection findings — and the only signal a later manual un-complete
// has for walking that resolve back (see the wasDone path below).
const RESOLVE_NOTE = 'Linked task completed'

// Exact prior of a finding the completion auto-resolved — the Undo toast
// restores by id with these values.
type FindingPrior = {
  id: string
  inspection_id: string
  disposition: string
  disposition_note: string | null
  disposition_at: string | null
}

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

// Postpone — push the due date (the `p` key and the due menu's +1d/+1w).
// Distinct from snooze: this MOVES the deadline; snooze only hides the
// task. The date math lives in lib/tasks/dates postponeDate.
export function postponeTaskOptimistic(
  supabase: Client, store: TaskStore, task: Task, date: string
) {
  void patchTaskOptimistic(supabase, store, task, { due_date: date })
  toast(`Due ${formatDateShort(date)}`)
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
//
// opts.onRevert fires whenever a completion is walked back locally
// (failed write rollback, or the user hitting Undo) — the pages use it
// to cancel the row's presentation-only exit animation so the row
// reappears instantly (see useExitingRows in complete-collapse.tsx).
export async function toggleDoneOptimistic(
  supabase: Client, store: TaskStore, task: Task,
  opts?: { openSubtasks?: Task[]; onRevert?: () => void; quiet?: boolean }
): Promise<{ undo: () => void } | void> {
  const wasDone = task.status === 'done'
  const now = new Date().toISOString()
  const fields: Partial<Task> = wasDone
    ? { status: 'next_action', completed_at: null }
    : { status: 'done', completed_at: now }

  const children = wasDone ? [] : (opts?.openSubtasks ?? [])
  // Children can sit in different statuses — capture each one so Undo
  // puts every row back exactly where it was (title kept for the
  // partial-failure error toast).
  const childPrior = children.map(c => ({
    id: c.id, title: c.title, status: c.status, completed_at: c.completed_at,
  }))
  const revertChildren = () => {
    for (const p of childPrior) store.update(p.id, { status: p.status, completed_at: p.completed_at })
  }

  store.update(task.id, fields)
  for (const c of children) store.update(c.id, { status: 'done', completed_at: now })

  const { error } = await supabase.from('tasks').update(fields).eq('id', task.id)
  if (error) {
    store.update(task.id, { status: task.status, completed_at: task.completed_at })
    revertChildren()
    opts?.onRevert?.()
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
      opts?.onRevert?.()
      await supabase.from('tasks')
        .update({ status: task.status, completed_at: task.completed_at }).eq('id', task.id)
      toast('Could not update task', { tone: 'error' })
      return
    }
  }

  if (wasDone) {
    // Manual UN-complete, possibly long after the completion (the
    // day-later vendor no-show): best-effort restore the findings that
    // completion auto-resolved, back to 'task'. The completion's exact
    // priors are long gone at this distance, so the stamp note is the
    // only signal left — a finding whose note Nick edited since stays
    // resolved (acceptable: an edited note is a human decision the
    // machine shouldn't overwrite). Fire-and-forget like the stamp.
    void (async () => {
      const { data: restored, error: restoreError } = await supabase.from('inspection_items')
        .update({ disposition: 'task', disposition_note: null, disposition_at: now })
        .eq('task_id', task.id)
        .eq('disposition', 'resolved')
        .eq('disposition_note', RESOLVE_NOTE)
        .select('inspection_id')
      if (restoreError) {
        console.warn('Could not restore linked inspection findings:', restoreError.message)
        return
      }
      if (restored && restored.length > 0) {
        void invalidateInspectionReports(supabase, restored.map(r => r.inspection_id))
      }
    })()
    return
  }

  // Completing a task resolves the inspection findings it — or the
  // subtasks completed with it — was spawned from (disposition 'task'
  // only: a manually re-triaged finding is left alone). Best-effort and
  // fire-and-forget: a failure is logged, never surfaced, and never
  // blocks the completion. The finding stays fully reviewable —
  // 'resolved' is a state change, not a closure. Exact priors are
  // captured BEFORE the write so the Undo toast can restore by id (no
  // note-string matching), and the affected inspections' stored reports
  // are invalidated (the resolve changes their score/content).
  const findingTaskIds = [task.id, ...children.map(c => c.id)]
  const resolvedFindingsPromise: Promise<FindingPrior[]> = (async () => {
    const { data: rows, error: selectError } = await supabase.from('inspection_items')
      .select('id, inspection_id, disposition, disposition_note, disposition_at')
      .in('task_id', findingTaskIds)
      .eq('disposition', 'task')
    if (selectError || !rows || rows.length === 0) {
      if (selectError) console.warn('Could not load linked inspection findings:', selectError.message)
      return []
    }
    const priors = rows as FindingPrior[]
    const ids = priors.map(r => r.id)
    const { error: resolveError } = await supabase.from('inspection_items')
      .update({ disposition: 'resolved', disposition_at: now })
      .in('id', ids)
    if (resolveError) {
      console.warn('Could not resolve linked inspection findings:', resolveError.message)
      return []
    }
    // The stamp note must not clobber a note Nick wrote himself — only
    // rows with no note get the marker (rows that keep their own note
    // are invisible to the wasDone note-match restore above; documented
    // limitation).
    const noteless = priors.filter(r => r.disposition_note == null).map(r => r.id)
    if (noteless.length > 0) {
      const { error: noteError } = await supabase.from('inspection_items')
        .update({ disposition_note: RESOLVE_NOTE })
        .in('id', noteless)
      if (noteError) console.warn('Could not stamp the resolve note on linked findings:', noteError.message)
    }
    void invalidateInspectionReports(supabase, priors.map(r => r.inspection_id))
    return priors
  })()

  // Spawn failures NEVER walk back the completion (it already committed
  // and is what the user asked for) — but they must not be silent either,
  // or the series would quietly die. Collect and surface below.
  let spawnFailures = 0
  let spawned: Task | null = null
  if (task.recur_freq) {
    const res = await createNextOccurrence(supabase, task)
    spawned = res.task
    if (spawned) store.insert(spawned)
    if (res.error) spawnFailures++
  }
  // Recurring CHILDREN completed by the bulk write spawn their next
  // occurrences too. Their parent just went done in this same action,
  // so createNextOccurrence lifts each spawn to top level (see
  // nextParentTaskId in recurrence.ts).
  const spawnedChildren: Task[] = []
  for (const c of children) {
    if (!c.recur_freq) continue
    const res = await createNextOccurrence(supabase, c, { parentStatus: 'done' })
    if (res.task) {
      spawnedChildren.push(res.task)
      store.insert(res.task)
    }
    if (res.error) spawnFailures++
  }
  const spawnedAll = spawned ? [spawned, ...spawnedChildren] : spawnedChildren

  if (spawnFailures > 0) {
    toast('Completed, but creating the next occurrence failed — un-complete and re-complete to retry', { tone: 'error' })
  }

  const base = children.length > 0
    ? `Completed with ${children.length} subtask${children.length === 1 ? '' : 's'}`
    : 'Completed'
  const message = spawned
    ? `${base} — next occurrence ${formatDateShort(spawned.due_date)}`
    : base
  // The full walk-back as a closure: the single-task toast's Undo calls
  // it directly; batch completion collects one per task and runs them
  // all from a single summary toast (see batchCompleteOptimistic).
  const undo = () => {
        opts?.onRevert?.()
        const revert: Partial<Task> = { status: task.status, completed_at: task.completed_at }
        store.update(task.id, revert)
        revertChildren()
        for (const s of spawnedAll) store.remove(s.id)
        void (async () => {
          // Run EVERY DB revert (parent, each child, each spawned
          // occurrence) and collect failures. Any row that could not be
          // undone gets its local state reconciled back to the actual
          // DB outcome, and one error toast names what stuck — no
          // silent divergence between screen and database.
          const failed: string[] = []
          const { error: undoError } = await supabase.from('tasks').update(revert).eq('id', task.id)
          if (undoError) {
            store.update(task.id, fields)
            failed.push(`“${task.title}”`)
          }
          // Prior statuses differ per child, so restore row by row.
          for (const p of childPrior) {
            const { error: childError } = await supabase.from('tasks')
              .update({ status: p.status, completed_at: p.completed_at }).eq('id', p.id)
            if (childError) {
              store.update(p.id, { status: 'done', completed_at: now })
              failed.push(`“${p.title}”`)
            }
          }
          for (const s of spawnedAll) {
            const { error: deleteError } = await supabase.from('tasks').delete().eq('id', s.id)
            if (deleteError) {
              store.insert(s)
              failed.push(`next occurrence “${s.title}”`)
            }
          }
          // Walk back the finding auto-resolve too — restore each row by
          // id to the EXACT priors captured when the resolve ran (no
          // note-string matching), best-effort and silent-logged like
          // the stamp itself.
          const priors = await resolvedFindingsPromise.catch(() => [] as FindingPrior[])
          if (priors.length > 0) {
            const results = await Promise.all(priors.map(p =>
              supabase.from('inspection_items')
                .update({
                  disposition: p.disposition as Database['public']['Tables']['inspection_items']['Row']['disposition'],
                  disposition_note: p.disposition_note,
                  disposition_at: p.disposition_at,
                })
                .eq('id', p.id)))
            if (results.some(r => r.error)) console.warn('Could not fully restore linked inspection findings')
            void invalidateInspectionReports(supabase, priors.map(p => p.inspection_id))
          }
          if (failed.length > 0) {
            toast(`Could not undo: ${failed.join(', ')}`, { tone: 'error' })
          }
        })()
  }

  if (!opts?.quiet) {
    toast(message, { action: { label: 'Undo', onClick: undo } })
  }
  return { undo }
}

// ── Batch operations (the multi-select bar) ──────────────────

// One .in() write for a shared field change (due date, snooze,
// priority). Optimistic with full rollback; one toast, no undo —
// matching patchTaskOptimistic's semantics for the same edits.
export async function batchPatchOptimistic(
  supabase: Client, store: TaskStore, tasks: Task[], fields: Partial<Task>, label: string
) {
  if (tasks.length === 0) return
  const stamped: Partial<Task> = { ...fields, updated_at: new Date().toISOString() }
  for (const t of tasks) store.update(t.id, stamped)
  const { error } = await supabase.from('tasks').update(stamped).in('id', tasks.map(t => t.id))
  if (error) {
    for (const t of tasks) {
      const rollback: Partial<Task> = {}
      for (const key of Object.keys(stamped) as (keyof Task)[]) {
        ;(rollback as Record<string, unknown>)[key] = t[key]
      }
      store.update(t.id, rollback)
    }
    toast('Could not save — changes reverted', { tone: 'error' })
    return
  }
  toast(`${label} — ${tasks.length} task${tasks.length === 1 ? '' : 's'}`)
}

// Batch complete: each task runs the FULL single-task completion
// (subtask sweep, recurrence spawn, finding resolve — one code path,
// zero drift), quieted; one summary toast whose Undo replays every
// task's own captured walk-back.
export async function batchCompleteOptimistic(
  supabase: Client, store: TaskStore, tasks: Task[],
  opts: { openSubtasksOf: (id: string) => Task[]; onRevert?: (id: string) => void }
) {
  const open = tasks.filter(t => t.status !== 'done')
  if (open.length === 0) return
  const undos: (() => void)[] = []
  for (const task of open) {
    const result = await toggleDoneOptimistic(supabase, store, task, {
      openSubtasks: opts.openSubtasksOf(task.id),
      onRevert: () => opts.onRevert?.(task.id),
      quiet: true,
    })
    if (result) undos.push(result.undo)
  }
  toast(`Completed ${undos.length} task${undos.length === 1 ? '' : 's'}`, {
    action: { label: 'Undo', onClick: () => { for (const undo of undos) undo() } },
  })
}

// Instant optimistic delete with an Undo toast that re-inserts the
// captured row (same id — the delete has already committed, so the id
// is free again). Undo also restores what died with the row:
// task_contacts junction rows (pass the ids), subtasks (removed by
// parent_task_id's ON DELETE CASCADE, captured with their own contact
// links before the delete commits), the blocked_by_task_id links
// of every dependent — of the task itself AND of its cascading
// children (all nulled by the FK's ON DELETE SET NULL) — and the
// call_items that pointed at the task (task_id also SET NULL).
export async function deleteTaskOptimistic(
  supabase: Client, store: TaskStore, task: Task,
  opts?: { contactIds?: string[] }
) {
  store.remove(task.id)

  // Capture what the delete will destroy beyond the row itself:
  // children die with it (CASCADE), and dependents of the task AND of
  // its children lose their blocked_by FK (SET NULL) — so the children
  // come first, then one dependents query over all the dying ids. Each
  // dependent keeps its own blocker id for the per-row undo restore.
  const { data: childRows } = await supabase.from('tasks')
    .select('*, task_contacts(contact_id)').eq('parent_task_id', task.id)
  const children = (childRows ?? []) as unknown as (Task & { task_contacts: { contact_id: string }[] | null })[]
  const childIds = children.map(c => c.id)

  const { data: deps } = await supabase.from('tasks')
    .select('id, blocked_by_task_id')
    .in('blocked_by_task_id', [task.id, ...childIds])
  // Rows dying in this delete need no FK handling of their own: the
  // children are re-inserted verbatim on undo (their blocked_by rides
  // along in taskInsertPayload).
  const dependents = (deps ?? []).filter(d => d.id !== task.id && !childIds.includes(d.id))

  // Call items linked to this task lose their task_id (SET NULL per
  // 0005) — ids are enough to point them back on undo.
  const { data: callItemRows } = await supabase.from('call_items')
    .select('id').eq('task_id', task.id)
  const callItemIds = (callItemRows ?? []).map(r => r.id)

  const { error } = await supabase.from('tasks').delete().eq('id', task.id)
  if (error) {
    store.insert(task)
    toast('Could not delete task', { tone: 'error' })
    return
  }

  // Mirror the DB's SET NULL / CASCADE locally so no row keeps
  // pointing at a blocker or parent that no longer exists.
  for (const d of dependents) store.update(d.id, { blocked_by_task_id: null })
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
        // Re-point the call items that referenced the task (same id).
        if (callItemIds.length > 0) {
          await supabase.from('call_items')
            .update({ task_id: task.id }).in('id', callItemIds)
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
        // Dependents point back at their ORIGINAL blocker (the task or
        // one of its children) — restored per row after the rows above
        // exist again.
        for (const d of dependents) {
          await supabase.from('tasks')
            .update({ blocked_by_task_id: d.blocked_by_task_id }).eq('id', d.id)
          store.update(d.id, { blocked_by_task_id: d.blocked_by_task_id })
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
