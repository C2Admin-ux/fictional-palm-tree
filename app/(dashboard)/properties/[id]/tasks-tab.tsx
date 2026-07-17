'use client'

// Property profile → Tasks tab. The same fast affordances as the tasks
// page — NL quick-add (property preset), inline edits, complete /
// snooze / delete with undo toasts, swipe gestures — scoped to one
// property. Open tasks grouped by due date; recently completed
// collapsed at the bottom with un-complete toggles.

import { useCallback, useEffect, useMemo, useState, memo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Task } from '@/lib/supabase/types'
import { cn, formatDateShort, todayISO } from '@/lib/utils'
import { InlineText } from '@/components/ui/inline-edit'
import { TaskQuickAdd } from '@/components/tasks/task-quick-add'
import { SnoozeMenu } from '@/components/tasks/snooze-menu'
import { SwipeRow } from '@/components/tasks/swipe-row'
import { PriorityPip, CompleteCircle, TaskBadges, DueDateCell } from '@/components/tasks/row-cells'
import {
  type TaskStore, patchTaskOptimistic, toggleDoneOptimistic, deleteTaskOptimistic,
  snoozeTaskOptimistic,
} from '@/lib/tasks/mutations'
import { groupByDue } from '@/lib/tasks/dates'
import { Moon, ChevronDown, X } from 'lucide-react'

// Row with the task_contacts junction ids joined in, so delete undo
// can restore the links (same undo contract as the tasks page).
type TabTask = Task & { task_contacts?: { contact_id: string }[] | null }

export default function TasksTab({ propertyId }: { propertyId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [tasks, setTasks] = useState<TabTask[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [completedOpen, setCompletedOpen] = useState(false)

  const fetchTasks = useCallback(async () => {
    const completedCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const [{ data: open }, { data: recentDone }] = await Promise.all([
      supabase.from('tasks').select('*, task_contacts(contact_id)')
        .eq('property_id', propertyId).neq('status', 'done')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('tasks').select('*, task_contacts(contact_id)')
        .eq('property_id', propertyId).eq('status', 'done')
        .gte('completed_at', completedCutoff)
        .order('completed_at', { ascending: false }),
    ])
    setTasks([...(open ?? []), ...(recentDone ?? [])] as unknown as TabTask[])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  useEffect(() => { fetchTasks() }, [fetchTasks])
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Referentially stable so the memoized rows only re-render when
  // their own task changes.
  const store: TaskStore = useMemo(() => ({
    update: (id, fields) => setTasks(prev => prev.map(t => t.id === id ? { ...t, ...fields } : t)),
    insert: task => setTasks(prev => [...prev, task]),
    remove: id => setTasks(prev => prev.filter(t => t.id !== id)),
  }), [])

  const openTasks = tasks.filter(t => t.status !== 'done')
  const completed = tasks
    .filter(t => t.status === 'done')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  const groups = groupByDue(openTasks)

  if (loading) {
    return <p className="text-sm text-slate-400">Loading…</p>
  }

  return (
    <div className="max-w-3xl">
      <div className="card overflow-hidden">
        <TaskQuickAdd
          userId={userId}
          presetPropertyId={propertyId}
          onCreated={store.insert}
          placeholder='Quick add — try "replace filters friday !high"'
        />

        {openTasks.length === 0 && (
          <p className="text-sm text-slate-400 italic px-6 py-5">
            No open tasks for this property. Capture one above.
          </p>
        )}

        {groups.map(g => {
          if (!g.tasks.length) return null
          return (
            <div key={g.key}>
              <div className={cn('flex items-center gap-2 px-6 py-2 border-b',
                g.tone === 'red' ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-200')}>
                <span className={cn('text-xs font-semibold uppercase tracking-wide',
                  g.tone === 'red' ? 'text-red-700' : 'text-slate-600')}>
                  {g.label}
                </span>
                <span className={cn('text-xs px-1.5 py-0.5 rounded-full',
                  g.tone === 'red' ? 'text-red-600 bg-red-100' : 'text-slate-400 bg-slate-200')}>
                  {g.tasks.length}
                </span>
              </div>
              {g.tasks.map(t => (
                <PropertyTaskRow key={t.id} task={t} supabase={supabase} store={store} />
              ))}
            </div>
          )
        })}

        {/* Recently completed — collapsed, un-complete to bring back */}
        {completed.length > 0 && (
          <div>
            <button onClick={() => setCompletedOpen(o => !o)}
              className="w-full flex items-center gap-2 px-6 py-2 bg-slate-50 border-t border-slate-200 hover:bg-slate-100 transition-colors">
              <ChevronDown size={13} className={cn('text-slate-400 transition-transform', !completedOpen && '-rotate-90')} />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Recently completed ({completed.length})
              </span>
              <span className="text-xs text-slate-400">last 14 days</span>
            </button>
            {completedOpen && completed.map(t => (
              <PropertyTaskRow key={t.id} task={t} supabase={supabase} store={store} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────

const PropertyTaskRow = memo(function PropertyTaskRow({ task, supabase, store }: {
  task: TabTask
  supabase: ReturnType<typeof createClient>
  store: TaskStore
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const isDone = task.status === 'done'
  const today = todayISO()
  const snoozed = !isDone && task.snoozed_until != null && task.snoozed_until > today

  function patch(fields: Partial<Task>) {
    patchTaskOptimistic(supabase, store, task, fields)
  }

  function snooze(date: string) {
    snoozeTaskOptimistic(supabase, store, task, date)
  }

  const row = (
    <div className={cn(
      'flex items-center px-4 py-0 min-h-[38px] border-b border-slate-100 group hover:bg-slate-50 transition-colors',
      isDone && 'opacity-60'
    )}>
      {/* Priority pip */}
      <PriorityPip priority={task.priority} isDone={isDone}
        onSave={priority => patch({ priority })} />

      {/* Complete / un-complete circle */}
      <CompleteCircle isDone={isDone}
        onToggle={() => toggleDoneOptimistic(supabase, store, task)} />

      {/* Title */}
      <div className="flex-1 min-w-0 py-2.5">
        <div className={cn('text-sm text-slate-900', isDone && 'line-through text-slate-400')}>
          <InlineText
            value={task.title}
            onSave={v => patch({ title: v })}
            displayClassName="font-medium"
          />
          <TaskBadges task={task} />
        </div>
        {(snoozed || (isDone && task.completed_at)) && (
          <div className="flex items-center gap-2 mt-0.5">
            {snoozed && (
              <span className="text-xs text-indigo-500 flex items-center gap-1">
                <Moon size={9} />snoozed until {formatDateShort(task.snoozed_until)}
              </span>
            )}
            {isDone && task.completed_at && (
              <span className="text-xs text-emerald-600">done {formatDateShort(task.completed_at)}</span>
            )}
          </div>
        )}
      </div>

      {/* Due date */}
      <DueDateCell dueDate={task.due_date} isDone={isDone}
        onSave={v => patch({ due_date: v })} />

      {/* Snooze presets */}
      <div className="w-6 flex justify-center">
        <SnoozeMenu
          open={snoozeOpen}
          onOpenChange={setSnoozeOpen}
          onSnooze={snooze}
          buttonClassName="md:opacity-0 md:group-hover:opacity-100"
        />
      </div>

      {/* Delete — instant, with an Undo toast */}
      <div className="w-6 flex justify-center ml-1">
        <button onClick={() => deleteTaskOptimistic(supabase, store, task, {
          contactIds: (task.task_contacts ?? []).map(tc => tc.contact_id),
        })}
          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all">
          <X size={13} />
        </button>
      </div>
    </div>
  )

  if (isDone) return row
  return (
    <SwipeRow
      onSwipeRight={() => toggleDoneOptimistic(supabase, store, task)}
      onSwipeLeft={() => setSnoozeOpen(true)}>
      {row}
    </SwipeRow>
  )
})
