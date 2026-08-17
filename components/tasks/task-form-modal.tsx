'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Task, Contact, Property, CapexProject } from '@/lib/supabase/types'
import { cn, formatDate } from '@/lib/utils'
import { RefreshCw } from 'lucide-react'
import { ContactActionMenu } from '@/components/tasks/contact-popover'
import { DueMenu } from '@/components/tasks/due-menu'
import { Modal } from '@/components/ui/modal'
import type { TaskWithRelations } from '@/components/tasks/task-row'

// ── Task Form Modal ──────────────────────────────────────────

export function TaskFormModal({ task, properties, contacts, capexProjects, allTasks, onComplete, onClose, onSave }: {
  task: TaskWithRelations | null
  properties: Property[]
  contacts: Contact[]
  capexProjects: CapexProject[]
  allTasks: TaskWithRelations[]
  // Shared completion path (recurrence + completed_at + undo toast) —
  // saving an existing task with status flipped to done routes here.
  onComplete: (task: TaskWithRelations) => void | Promise<void>
  onClose: () => void
  onSave: () => void
}) {
  const supabase = createClient()

  type FormState = {
    title: string; description: string; property_id: string
    capex_project_id: string; status: string; priority: string
    due_date: string; snoozed_until: string; blocked_by_task_id: string
    parent_task_id: string
    tags: string; recur_freq: string; recur_interval: string
    recur_unit: string; recur_end_type: string; recur_end_date: string
    recur_end_count: string
  }

  const [form, setForm] = useState<FormState>({
    title:              task?.title ?? '',
    description:        task?.description ?? '',
    property_id:        task?.property_id ?? '',
    capex_project_id:   task?.capex_project_id ?? '',
    status:             task?.status ?? 'inbox',
    priority:           task?.priority ?? 'medium',
    due_date:           task?.due_date ?? '',
    snoozed_until:      task?.snoozed_until ?? '',
    blocked_by_task_id: task?.blocked_by_task_id ?? '',
    parent_task_id:     task?.parent_task_id ?? '',
    tags:               task?.tags?.join(', ') ?? '',
    recur_freq:         task?.recur_freq ?? '',
    recur_interval:     task?.recur_interval?.toString() ?? '2',
    recur_unit:         task?.recur_unit ?? 'weeks',
    recur_end_type:     task?.recur_end_type ?? 'never',
    recur_end_date:     task?.recur_end_date ?? '',
    recur_end_count:    task?.recur_end_count?.toString() ?? '12',
  })

  const [selectedContacts, setSelectedContacts] = useState<string[]>(
    (task?.contacts ?? []).map((c: Contact) => c.id)
  )
  const [saving, setSaving] = useState(false)
  // Inline error under the Parent-task select (server-truth guard)
  const [parentError, setParentError] = useState<string | null>(null)

  function toggleContact(id: string) {
    setSelectedContacts(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setParentError(null)
    setSaving(true)

    const payload = {
      title:              form.title,
      description:        form.description || null,
      property_id:        form.property_id || null,
      capex_project_id:   form.capex_project_id || null,
      status:             form.status as Task['status'],
      priority:           form.priority as Task['priority'],
      due_date:           form.due_date || null,
      snoozed_until:      form.snoozed_until || null,
      blocked_by_task_id: form.blocked_by_task_id || null,
      // A task with children can never gain a parent (hasChildren hides
      // the control), and auto-generated deadline tasks stay top-level
      // (isAutoSource hides it too) — both preserve whatever the task
      // already had.
      parent_task_id:     hasChildren || isAutoSource
        ? (task?.parent_task_id ?? null)
        : (form.parent_task_id || null),
      tags:               form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      recur_freq:         (form.recur_freq || null) as Task['recur_freq'],
      recur_interval:     form.recur_freq === 'custom' ? parseInt(form.recur_interval) || null : null,
      recur_unit:         form.recur_freq === 'custom' ? (form.recur_unit as Task['recur_unit']) : null,
      recur_end_type:     form.recur_freq ? (form.recur_end_type as Task['recur_end_type']) : null,
      recur_end_date:     form.recur_end_type === 'on' ? form.recur_end_date || null : null,
      recur_end_count:    form.recur_end_type === 'after' ? parseInt(form.recur_end_count) || null : null,
    }

    // Server-truth guard when attaching a NEW parent: the local list
    // can be stale (another tab may have subtasked or deleted the
    // pick), and writing anyway would create a depth-2 chain or a
    // dangling edge. One select against the real row before saving.
    const newParentId = payload.parent_task_id
    if (newParentId != null && newParentId !== (task?.parent_task_id ?? null)) {
      const { data: parentRow } = await supabase.from('tasks')
        .select('id, parent_task_id').eq('id', newParentId).maybeSingle()
      if (!parentRow) {
        setParentError('That parent task no longer exists — pick another, or None.')
        setSaving(false)
        return
      }
      if (parentRow.parent_task_id != null) {
        setParentError('That task has become a subtask itself — only one level of nesting is allowed.')
        setSaving(false)
        return
      }
    }

    // Status transitions across done are not plain field writes:
    // completing routes through the shared completion path (recurrence,
    // completed_at, undo toast) and un-completing clears the stamp.
    const goingDone = task != null && task.status !== 'done' && payload.status === 'done'
    const leavingDone = task != null && task.status === 'done' && payload.status !== 'done'

    let taskId: string | undefined
    if (task) {
      const update = {
        ...payload,
        // Keep the previous status here — onComplete below performs
        // the actual completion so it behaves like every other path.
        ...(goingDone ? { status: task.status } : {}),
        ...(leavingDone ? { completed_at: null } : {}),
      }
      await supabase.from('tasks').update(update).eq('id', task.id)
      taskId = task.id
      if (goingDone) await onComplete({ ...task, ...update })
    } else {
      // Stamp ownership on create so the personal inbox / agenda can
      // tell whose task this is.
      const { data: auth } = await supabase.auth.getUser()
      const { data: inserted } = await supabase.from('tasks')
        .insert({
          ...payload,
          completed_at: payload.status === 'done' ? new Date().toISOString() : null,
          created_by: auth.user?.id ?? null,
        })
        .select('id')
        .single()
      taskId = inserted?.id
    }

    // Sync contacts
    if (taskId) {
      await supabase.from('task_contacts').delete().eq('task_id', taskId)
      if (selectedContacts.length > 0) {
        await supabase.from('task_contacts').insert(
          selectedContacts.map(cid => ({ task_id: taskId as string, contact_id: cid }))
        )
      }
    }

    setSaving(false)
    onSave()
  }

  const filteredCapex = form.property_id
    ? capexProjects.filter(c => c.property_id === form.property_id)
    : capexProjects

  const blockableTasks = allTasks.filter(t =>
    t.id !== task?.id && t.status !== 'done'
  )

  // Single-level nesting is an app rule: a task that already has
  // children can't itself become a subtask (that would make 2 levels),
  // and a subtask can't be picked as a parent. Tasks WITH children are
  // valid parents. Auto-generated deadline tasks (renewals,
  // expirations) must stay top-level so the Review obligations horizon
  // and the auto-task dedupe keep seeing them.
  const hasChildren = task != null && allTasks.some(t => t.parent_task_id === task.id)
  const isAutoSource = task?.auto_source != null
  // Done tasks aren't offered as new parents, but the CURRENT parent
  // always appears (labelled "(completed)" when done) so the select
  // shows the true state instead of silently blanking; "None" still
  // clears it.
  const parentOptions = allTasks.filter(t =>
    t.id !== task?.id && t.parent_task_id == null &&
    (t.status !== 'done' || t.id === task?.parent_task_id)
  )

  return (
    <Modal title={task ? 'Edit Task' : 'New Task'} onClose={onClose} maxWidth="xl">
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Title */}
          <div>
            <label className="label">Title *</label>
            <input required value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="input" placeholder="What needs to be done?" />
          </div>

          <div>
            <label className="label">Description</label>
            <textarea value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="input min-h-[60px] resize-none" placeholder="Optional details…" />
          </div>

          {/* Row: property + status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Property</label>
              <select value={form.property_id}
                onChange={e => setForm(f => ({ ...f, property_id: e.target.value, capex_project_id: '' }))}
                className="input">
                <option value="">Portfolio-wide</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="input">
                <option value="inbox">Inbox</option>
                <option value="next_action">Next action</option>
                <option value="waiting">Waiting</option>
                <option value="blocked">Blocked</option>
                <option value="done">Done</option>
              </select>
            </div>
          </div>

          {/* Row: priority + due date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Priority</label>
              <select value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="input">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="label">Due Date</label>
              {/* RTM-style quick menu (Today / Tomorrow / +1 week / pick a
                  date / clear) — same DueMenu as the rows and batch bar,
                  hung off a field-like trigger. */}
              <DueMenu
                value={form.due_date || null}
                onSelect={date => setForm(f => ({ ...f, due_date: date ?? '' }))}
                align="left"
                trigger={
                  <span className="input text-sm text-left w-full">
                    {formatDate(form.due_date || null)}
                  </span>
                }
              />
            </div>
          </div>

          {/* CapEx project */}
          <div>
            <label className="label">CapEx Project</label>
            <select value={form.capex_project_id}
              onChange={e => setForm(f => ({ ...f, capex_project_id: e.target.value }))}
              className="input">
              <option value="">None</option>
              {filteredCapex.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>

          {/* Parent task — makes this a subtask (single level) */}
          {hasChildren || isAutoSource ? (
            <div>
              <label className="label">Parent task</label>
              <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                {isAutoSource
                  ? 'Auto-generated deadline tasks stay top-level so they always surface in the obligations horizon.'
                  : 'This task has subtasks, so it can’t become a subtask itself (one level only).'}
              </p>
            </div>
          ) : (
            <div>
              <label className="label">Parent task</label>
              <select value={form.parent_task_id}
                onChange={e => setForm(f => ({ ...f, parent_task_id: e.target.value }))}
                className="input">
                <option value="">None — top-level task</option>
                {parentOptions.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.title.slice(0, 60)}{t.status === 'done' ? ' (completed)' : ''}
                  </option>
                ))}
              </select>
              {parentError && (
                <p className="text-xs text-red-600 mt-1">{parentError}</p>
              )}
              <p className="text-xs text-slate-400 mt-1">Subtasks live inside their parent’s drill-down, not in the main lists</p>
            </div>
          )}

          {/* Blocked by */}
          {form.status === 'blocked' && (
            <div>
              <label className="label">Blocked by task</label>
              <select value={form.blocked_by_task_id}
                onChange={e => setForm(f => ({ ...f, blocked_by_task_id: e.target.value }))}
                className="input">
                <option value="">Select blocking task…</option>
                {blockableTasks.map(t => (
                  <option key={t.id} value={t.id}>{t.title.slice(0, 60)}</option>
                ))}
              </select>
            </div>
          )}

          {/* People — tap a chip for its action menu: add/remove on this
              task plus one-tap call/text/email */}
          <div>
            <label className="label">People</label>
            <div className="flex flex-wrap gap-2">
              {contacts.map(c => {
                const isSelected = selectedContacts.includes(c.id)
                return (
                  <ContactActionMenu
                    key={c.id}
                    contact={c}
                    action={{
                      label: isSelected ? 'Remove from this task' : 'Add to this task',
                      onClick: () => toggleContact(c.id),
                    }}>
                    <span
                      className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-all',
                        isSelected
                          ? 'text-white border-transparent'
                          : 'text-slate-600 border-slate-200 hover:border-slate-300'
                      )}
                      style={isSelected
                        ? { background: c.color_hex ?? '#64748b' }
                        : {}}>
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-white flex-shrink-0"
                        style={{ background: c.color_hex ?? '#64748b', fontSize: 9 }}>
                        {(c.initials ?? c.full_name.slice(0, 2)).toUpperCase()}
                      </span>
                      {c.full_name.split(' ')[0]}
                    </span>
                  </ContactActionMenu>
                )
              })}
            </div>
          </div>

          {/* Snooze */}
          <div>
            <label className="label">Snooze until</label>
            <input type="date" value={form.snoozed_until}
              onChange={e => setForm(f => ({ ...f, snoozed_until: e.target.value }))}
              className="input" />
            <p className="text-xs text-slate-400 mt-1">Hides from the agenda until this date, then wakes up automatically</p>
          </div>

          {/* Tags */}
          <div>
            <label className="label">Tags</label>
            <input value={form.tags}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              className="input" placeholder="vendor, rock, follow-up (comma separated)" />
          </div>

          {/* Recurrence */}
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">Recurring task</label>
              <select value={form.recur_freq}
                onChange={e => setForm(f => ({ ...f, recur_freq: e.target.value }))}
                className="input-sm w-auto">
                <option value="">One-time</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
                <option value="custom">Custom…</option>
              </select>
            </div>

            {form.recur_freq === 'custom' && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span>Every</span>
                <input type="number" min="1" max="365" value={form.recur_interval}
                  onChange={e => setForm(f => ({ ...f, recur_interval: e.target.value }))}
                  className="input-sm w-16" />
                <select value={form.recur_unit}
                  onChange={e => setForm(f => ({ ...f, recur_unit: e.target.value }))}
                  className="input-sm w-auto">
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                  <option value="months">months</option>
                </select>
              </div>
            )}

            {form.recur_freq && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-500">Ends</label>
                <div className="flex flex-col gap-2">
                  {[
                    { val: 'never', label: 'Never' },
                    { val: 'on',    label: 'On date' },
                    { val: 'after', label: 'After N times' },
                  ].map(opt => (
                    <label key={opt.val} className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input type="radio" name="recur_end_type" value={opt.val}
                        checked={form.recur_end_type === opt.val}
                        onChange={() => setForm(f => ({ ...f, recur_end_type: opt.val }))} />
                      {opt.label}
                      {opt.val === 'on' && form.recur_end_type === 'on' && (
                        <input type="date" value={form.recur_end_date}
                          onChange={e => setForm(f => ({ ...f, recur_end_date: e.target.value }))}
                          className="input-sm ml-2" />
                      )}
                      {opt.val === 'after' && form.recur_end_type === 'after' && (
                        <input type="number" min="1" value={form.recur_end_count}
                          onChange={e => setForm(f => ({ ...f, recur_end_count: e.target.value }))}
                          className="input-sm w-16 ml-2" />
                      )}
                    </label>
                  ))}
                </div>
                {form.recur_freq && (
                  <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
                    <RefreshCw size={11} />
                    Next instance created automatically when this task is marked done
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : task ? 'Save changes' : 'Create task'}
            </button>
          </div>
        </form>
    </Modal>
  )
}
