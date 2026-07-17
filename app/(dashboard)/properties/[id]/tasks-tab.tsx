'use client'

// Property profile → Tasks tab. The same fast affordances as the tasks
// page — NL quick-add (property preset), inline edits, complete /
// snooze / delete with undo toasts, swipe gestures — scoped to one
// property. Open tasks grouped by due date; recently completed
// collapsed at the bottom with un-complete toggles.

import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Task } from '@/lib/supabase/types'
import { cn, formatDateShort, todayISO } from '@/lib/utils'
import { InlineText } from '@/components/ui/inline-edit'
import { TaskQuickAdd } from '@/components/tasks/task-quick-add'
import { SnoozeMenu } from '@/components/tasks/snooze-menu'
import { SwipeRow } from '@/components/tasks/swipe-row'
import { PriorityPip, CompleteCircle, TaskBadges, DueDateCell } from '@/components/tasks/row-cells'
import { SubtaskChip, SubtaskList } from '@/components/tasks/subtask-list'
import { CollapseOnComplete, useExitingRows, type ExitPhase } from '@/components/tasks/complete-collapse'
import {
  type TaskStore, patchTaskOptimistic, toggleDoneOptimistic, deleteTaskOptimistic,
  snoozeTaskOptimistic, addSubtaskOptimistic,
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
    const [{ data: open }, { data: recentDone }, { data: doneSubs }] = await Promise.all([
      supabase.from('tasks').select('*, task_contacts(contact_id)')
        .eq('property_id', propertyId).neq('status', 'done')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('tasks').select('*, task_contacts(contact_id)')
        .eq('property_id', propertyId).eq('status', 'done')
        .gte('completed_at', completedCutoff)
        .order('completed_at', { ascending: false }),
      // Done SUBTASKS have no cutoff — a parent's "2/5" progress chip
      // must count every completed child, however old.
      supabase.from('tasks').select('*, task_contacts(contact_id)')
        .eq('property_id', propertyId).eq('status', 'done')
        .not('parent_task_id', 'is', null),
    ])
    const merged = [...(open ?? []), ...(recentDone ?? []), ...(doneSubs ?? [])] as unknown as TabTask[]
    // Recently-done subtasks appear in both done queries — dedupe by id.
    const seen = new Set<string>()
    const rows = merged.filter(t => !seen.has(t.id) && (seen.add(t.id), true))
    // Reachability: subtasks only render inside their parent's
    // drill-down, so an OPEN subtask whose done parent fell outside the
    // 14-day window above would be fetched but unrenderable. Fetch
    // those parents by id; once in state they render in the
    // Recently-completed section regardless of the cutoff — they carry
    // open children, which makes them the rows that matter most here.
    const haveIds = new Set(rows.map(t => t.id))
    const missingParentIds = Array.from(new Set(
      rows
        .filter(t => t.parent_task_id != null && t.status !== 'done' && !haveIds.has(t.parent_task_id))
        .map(t => t.parent_task_id as string)
    ))
    if (missingParentIds.length > 0) {
      const { data: parents } = await supabase.from('tasks')
        .select('*, task_contacts(contact_id)')
        .in('id', missingParentIds)
      rows.push(...((parents ?? []) as unknown as TabTask[]))
    }
    setTasks(rows)
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

  const tasksRef = useRef(tasks); tasksRef.current = tasks

  // Expanded subtask drill-downs — per-session, not persisted
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Presentation-only exit animation (same contract as the tasks page):
  // the mutation fires immediately, and useExitingRows keeps the
  // pre-completion snapshot rendered in place while the exit plays.
  const { begin: beginExit, cancel: cancelExit, overlay, phaseOf } = useExitingRows<TabTask>()
  const renderTasks = useMemo(() => overlay(tasks), [overlay, tasks])

  // Completing a parent completes its open subtasks too — one action,
  // one toast, one undo (same contract as the tasks page). onRevert
  // cancels the exit animation (failed write / Undo).
  const markDone = useCallback((task: Task) => {
    void toggleDoneOptimistic(supabase, store, task, {
      openSubtasks: tasksRef.current.filter(t => t.parent_task_id === task.id && t.status !== 'done'),
      onRevert: () => cancelExit(task.id),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, cancelExit])

  // Completion entry point for every surface (circle, swipe, subtask
  // rows): mutation immediately, exit animation presentation-only.
  // Un-completing (from Recently completed) skips the animation.
  const completeTask = useCallback((task: TabTask) => {
    if (task.status === 'done') { markDone(task); return }
    if (!beginExit(task)) return // already animating out
    markDone(task)
  }, [markDone, beginExit])

  // Subtasks render only inside their parent's drill-down — the
  // grouped lists, the completed section, and their counts all start
  // from top-level rows. (Render derivations feed from renderTasks so
  // completing rows stay in place while they animate out.)
  const topLevel = renderTasks.filter(t => !t.parent_task_id)
  const childrenByParent = useMemo(() => {
    const m = new Map<string, TabTask[]>()
    for (const t of renderTasks) {
      if (!t.parent_task_id) continue
      const arr = m.get(t.parent_task_id)
      if (arr) arr.push(t)
      else m.set(t.parent_task_id, [t])
    }
    return m
  }, [renderTasks])

  const openTasks = topLevel.filter(t => t.status !== 'done')
  const completed = topLevel
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
                <PropertyTaskRow key={t.id} task={t} supabase={supabase} store={store}
                  onDone={completeTask} userId={userId}
                  exitPhase={phaseOf(t.id)} exitPhaseOf={phaseOf}
                  subtasks={childrenByParent.get(t.id)}
                  expanded={expandedIds.has(t.id)} onToggleExpand={toggleExpand} />
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
              <PropertyTaskRow key={t.id} task={t} supabase={supabase} store={store}
                onDone={completeTask} userId={userId}
                exitPhase={phaseOf(t.id)} exitPhaseOf={phaseOf}
                subtasks={childrenByParent.get(t.id)}
                expanded={expandedIds.has(t.id)} onToggleExpand={toggleExpand} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────

const PropertyTaskRow = memo(function PropertyTaskRow({
  task, supabase, store, onDone, userId, subtasks, expanded = false, onToggleExpand,
  exitPhase = null, exitPhaseOf,
}: {
  task: TabTask
  supabase: ReturnType<typeof createClient>
  store: TaskStore
  onDone: (task: TabTask) => void
  userId: string | null
  subtasks?: TabTask[]
  expanded?: boolean
  onToggleExpand: (id: string) => void
  exitPhase?: ExitPhase | null              // this row's exit animation state
  exitPhaseOf?: (id: string) => ExitPhase | null  // for the subtask drill-down
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const isDone = task.status === 'done'
  const today = todayISO()
  const snoozed = !isDone && task.snoozed_until != null && task.snoozed_until > today
  // RTM completion feel — same wrapper as the tasks page rows, but
  // presentation-only: onDone fires the mutation immediately, and this
  // row is the pre-completion snapshot animating out (see
  // useExitingRows). Un-completing (from Recently completed) passes
  // straight through with no animation.
  const leaving = exitPhase != null

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
      <CompleteCircle isDone={isDone || leaving}
        onToggle={() => onDone(task)} />

      {/* Title */}
      <div className="flex-1 min-w-0 py-2.5">
        <div className={cn('text-sm text-slate-900', isDone && 'line-through text-slate-400')}>
          <InlineText
            value={task.title}
            onSave={v => patch({ title: v })}
            displayClassName="font-medium"
          />
          <TaskBadges task={task} />
          {subtasks != null && subtasks.length > 0 && (
            <SubtaskChip
              done={subtasks.filter(s => s.status === 'done').length}
              total={subtasks.length}
              expanded={expanded}
              onToggle={() => onToggleExpand(task.id)}
            />
          )}
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

  const body = isDone ? row : (
    <SwipeRow
      onSwipeRight={() => onDone(task)}
      onSwipeLeft={() => setSnoozeOpen(true)}>
      {row}
    </SwipeRow>
  )

  // The collapse wraps the row AND its expanded drill-down: completing
  // a parent takes the whole block out in one motion.
  return (
    <CollapseOnComplete phase={exitPhase}>
      {body}
      {subtasks != null && subtasks.length > 0 && expanded && (
        <SubtaskList
          subtasks={subtasks}
          exitPhaseOf={exitPhaseOf}
          onToggleDone={onDone}
          onPatch={(t, fields) => patchTaskOptimistic(supabase, store, t, fields)}
          onDelete={t => deleteTaskOptimistic(supabase, store, t, {
            contactIds: (t.task_contacts ?? []).map(tc => tc.contact_id),
          })}
          onAdd={title => addSubtaskOptimistic(supabase, store, task, title, userId)}
        />
      )}
    </CollapseOnComplete>
  )
})
