'use client'

// Property profile → Tasks tab. Since Sprint 16 this renders the SAME
// TaskRow as the tasks page — status, people, rock, due menu, snooze,
// subtasks, keyboard layer, full edit modal — scoped to one property.
// The lesser local row copy is gone; affordances can't drift apart
// again because there is nothing left to drift.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Task, Contact, Property, CapexProject } from '@/lib/supabase/types'
import { cn, todayISO } from '@/lib/utils'
import { TaskQuickAdd } from '@/components/tasks/task-quick-add'
import {
  TaskRow, subtaskSelection,
  type RowHandlers, type SubtaskUi, type TaskWithRelations,
} from '@/components/tasks/task-row'
import { TaskFormModal } from '@/components/tasks/task-form-modal'
import { useTaskListShortcuts } from '@/components/tasks/use-task-list-shortcuts'
import { topLevel, childrenByParent, openSubtasksOf } from '@/lib/tasks/subtasks'
import { useExitingRows } from '@/components/tasks/complete-collapse'
import {
  type TaskStore, patchTaskOptimistic, toggleDoneOptimistic, deleteTaskOptimistic,
  snoozeTaskOptimistic, addSubtaskOptimistic, postponeTaskOptimistic,
} from '@/lib/tasks/mutations'
import { TASK_CREATED_EVENT } from '@/lib/tasks/create'
import { groupByDue, postponeDate, type DueGroupKey } from '@/lib/tasks/dates'
import { addDaysToDate } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

// Rows carry the same joins the tasks page loads, so the shared TaskRow
// renders its full feature set here (people chips need contacts, the
// capex chip needs the project title).
type RawRow = Task & {
  properties: { name: string } | null
  capex_projects: { title: string } | null
  task_contacts: { contact_id: string; contacts: Contact | null }[] | null
}

const ROW_SELECT = '*, properties(name), capex_projects(title), task_contacts(contact_id, contacts(*))'

function flatten(rows: RawRow[]): TaskWithRelations[] {
  return rows.map(({ task_contacts, ...t }) => ({
    ...t,
    contacts: (task_contacts ?? []).map(tc => tc.contacts).filter((c): c is Contact => Boolean(c)),
  }))
}

// focusDue (site-visit sheet): the visit cares about what's DUE — the
// Later and No-date groups render collapsed behind a count so a 90-task
// backlog can't bury the walk list. A task quick-added into a collapsed
// group auto-expands it (a capture that seems to vanish reads as a bug).
export default function TasksTab({ propertyId, focusDue = false }: {
  propertyId: string
  focusDue?: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const [tasks, setTasks] = useState<TaskWithRelations[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [completedOpen, setCompletedOpen] = useState(false)
  // focusDue only: which of the collapsed-by-default groups are open
  const [expandedGroups, setExpandedGroups] = useState<Set<DueGroupKey>>(new Set())

  // The edit modal's option lists — loaded once, lazily, the first time
  // a modal opens (three small selects that most tab visits never need).
  const [modalData, setModalData] = useState<{
    properties: Property[]; contacts: Contact[]; capexProjects: CapexProject[]
  } | null>(null)
  const [editTask, setEditTask] = useState<TaskWithRelations | null>(null)
  const [showForm, setShowForm] = useState(false)

  const fetchTasks = useCallback(async () => {
    const completedCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const [{ data: open }, { data: recentDone }, { data: doneSubs }] = await Promise.all([
      supabase.from('tasks').select(ROW_SELECT)
        .eq('property_id', propertyId).neq('status', 'done')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('tasks').select(ROW_SELECT)
        .eq('property_id', propertyId).eq('status', 'done')
        .gte('completed_at', completedCutoff)
        .order('completed_at', { ascending: false }),
      // Done SUBTASKS have no cutoff — a parent's "2/5" progress chip
      // must count every completed child, however old.
      supabase.from('tasks').select(ROW_SELECT)
        .eq('property_id', propertyId).eq('status', 'done')
        .not('parent_task_id', 'is', null),
    ])
    const merged = [...(open ?? []), ...(recentDone ?? []), ...(doneSubs ?? [])] as unknown as RawRow[]
    // Recently-done subtasks appear in both done queries — dedupe by id.
    const seen = new Set<string>()
    const rows = merged.filter(t => !seen.has(t.id) && (seen.add(t.id), true))
    // Reachability: an OPEN subtask whose done parent fell outside the
    // 14-day window would be unrenderable (subtasks only render inside
    // their parent's drill-down) — fetch those parents by id.
    const haveIds = new Set(rows.map(t => t.id))
    const missingParentIds = Array.from(new Set(
      rows
        .filter(t => t.parent_task_id != null && t.status !== 'done' && !haveIds.has(t.parent_task_id))
        .map(t => t.parent_task_id as string)
    ))
    if (missingParentIds.length > 0) {
      const { data: parents } = await supabase.from('tasks')
        .select(ROW_SELECT)
        .in('id', missingParentIds)
      rows.push(...((parents ?? []) as unknown as RawRow[]))
    }
    setTasks(flatten(rows))
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  useEffect(() => { fetchTasks() }, [fetchTasks])
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openModal = useCallback((task: TaskWithRelations | null) => {
    setEditTask(task)
    setShowForm(true)
    if (!modalData) {
      void Promise.all([
        supabase.from('properties').select('*').eq('status', 'active').order('name'),
        supabase.from('contacts').select('*').order('full_name'),
        supabase.from('capex_projects').select('id, title, property_id')
          .in('status', ['planning', 'approved', 'in_progress']).order('title'),
      ]).then(([p, c, x]) => setModalData({
        properties: (p.data ?? []) as Property[],
        contacts: (c.data ?? []) as Contact[],
        capexProjects: (x.data ?? []) as CapexProject[],
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalData])

  // Referentially stable so the memoized rows only re-render when
  // their own task changes. Insert is idempotent by id: creations
  // arrive both from the inline quick-add's direct call and the
  // c2:task-created broadcast — whichever lands second is a no-op.
  const store: TaskStore = useMemo(() => ({
    update: (id, fields) => setTasks(prev => prev.map(t => t.id === id ? { ...t, ...fields } : t)),
    insert: task => setTasks(prev => prev.some(t => t.id === task.id) ? prev
      : [...prev, { ...task, properties: null, capex_projects: null, contacts: [] } as TaskWithRelations]),
    remove: id => setTasks(prev => prev.filter(t => t.id !== id)),
  }), [])

  // Tasks captured on other surfaces (global sheet, palette, record
  // buttons) broadcast themselves — insert the ones that belong to
  // this property so the tab never goes stale while open.
  useEffect(() => {
    function onTaskCreated(e: Event) {
      const task = (e as CustomEvent<Task>).detail
      if (task?.id && task.property_id === propertyId) store.insert(task)
    }
    window.addEventListener(TASK_CREATED_EVENT, onTaskCreated)
    return () => window.removeEventListener(TASK_CREATED_EVENT, onTaskCreated)
  }, [store, propertyId])

  const tasksRef = useRef(tasks); tasksRef.current = tasks

  // Keyboard-selected row (j/k)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Expanded subtask drill-downs — per-session, not persisted
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const toggleExpand = useCallback((id: string, mode: 'open' | 'close' | 'toggle' = 'toggle') => {
    if (!tasksRef.current.some(t => t.parent_task_id === id)) return
    setExpandedIds(prev => {
      const open = mode === 'toggle' ? !prev.has(id) : mode === 'open'
      if (open === prev.has(id)) return prev
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  // Presentation-only exit animation (same contract as the tasks page).
  const { begin: beginExit, cancel: cancelExit, overlay, phaseOf } = useExitingRows<TaskWithRelations>()
  const renderTasks = useMemo(() => overlay(tasks), [overlay, tasks])

  const markDone = useCallback((task: TaskWithRelations) => {
    void toggleDoneOptimistic(supabase, store, task, {
      openSubtasks: openSubtasksOf(tasksRef.current, task.id),
      onRevert: () => cancelExit(task.id),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, cancelExit])

  const completeTask = useCallback((task: TaskWithRelations) => {
    if (task.status === 'done') { markDone(task); return }
    if (!beginExit(task)) return // already animating out
    markDone(task)
  }, [markDone, beginExit])

  const taskById = useCallback((id: string) => tasksRef.current.find(t => t.id === id), [])

  const postponeTask = useCallback((task: TaskWithRelations, days: number) => {
    postponeTaskOptimistic(supabase, store, task,
      postponeDate(task.due_date, days, todayISO()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  const handlers: RowHandlers = useMemo(() => ({
    onEdit: openModal,
    onDone: completeTask,
    onDelete: task => deleteTaskOptimistic(supabase, store, task, {
      contactIds: (task.contacts ?? []).map(c => c.id),
    }),
    onPatch: (task, fields) => { patchTaskOptimistic(supabase, store, task, fields) },
    onSnooze: (task, date) => { snoozeTaskOptimistic(supabase, store, task, date) },
    onSelect: setSelectedId,
    getTask: taskById,
    exitPhaseOf: phaseOf,
    onToggleExpand: toggleExpand,
    onAddSubtask: (parent, title) => addSubtaskOptimistic(supabase, store, parent, title, userId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [store, completeTask, taskById, phaseOf, toggleExpand, userId, openModal])

  // The same keyboard layer as the tasks page — j/k, c, s, d, p, e,
  // 1-4, delete, l/h. Multi-select stays a tasks-page feature (no batch
  // bar here), so x is inert.
  useTaskListShortcuts({
    enabled: !showForm && !loading,
    selectedId,
    setSelectedId,
    onDelete: id => { const t = taskById(id); if (t) handlers.onDelete(t) },
    onEdit: id => { const t = taskById(id); if (t) openModal(t) },
    onSetPriority: (id, priority) => {
      const t = taskById(id)
      if (t) patchTaskOptimistic(supabase, store, t, { priority })
    },
    onPostpone: id => { const t = taskById(id); if (t) postponeTask(t, 1) },
    onExpand: toggleExpand,
  })

  const subtaskUi: SubtaskUi = useMemo(() => ({
    subtasksOf: (id: string) => childrenByParent(renderTasks).get(id),
    expandedIds,
  }), [renderTasks, expandedIds])

  const tops = topLevel(renderTasks)
  const childMap = useMemo(() => childrenByParent(renderTasks), [renderTasks])

  const openTasks = tops.filter(t => t.status !== 'done')
  const completed = tops
    .filter(t => t.status === 'done')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  const groups = groupByDue(openTasks)

  const isCollapsed = (key: DueGroupKey) =>
    focusDue && (key === 'later' || key === 'nodate') && !expandedGroups.has(key)

  // Quick-add insert, plus the focusDue vanish guard: a new task landing
  // in a collapsed group pops that group open so the capture stays visible.
  const insertCreated = useCallback((task: Task) => {
    store.insert(task)
    if (!focusDue) return
    const key: DueGroupKey = !task.due_date ? 'nodate'
      : task.due_date > addDaysToDate(todayISO(), 7) ? 'later' : 'overdue'
    if (key === 'later' || key === 'nodate') {
      setExpandedGroups(prev => prev.has(key) ? prev : new Set(prev).add(key))
    }
  }, [store, focusDue])

  const row = (t: TaskWithRelations) => (
    <TaskRow key={t.id} task={t} handlers={handlers}
      selected={selectedId === t.id} swipeable
      exitPhase={phaseOf(t.id)}
      subtasks={childMap.get(t.id)}
      expanded={expandedIds.has(t.id)}
      subtaskSelectedId={subtaskSelection(subtaskUi, selectedId, t.id)} />
  )

  if (loading) {
    return <p className="text-sm text-slate-400">Loading…</p>
  }

  return (
    <div className="max-w-4xl">
      {/* -mb-px on the last child clips the final row's border-b under
          the card's own bottom border (rows can't drop it via last:
          through the CollapseOnComplete wrapper). */}
      <div className="card overflow-hidden [&>div:last-child]:-mb-px">
        <TaskQuickAdd
          userId={userId}
          presetPropertyId={propertyId}
          onCreated={insertCreated}
          placeholder='Quick add — try "replace filters friday !high"'
        />

        {openTasks.length === 0 && (
          <p className="text-sm text-slate-400 italic px-6 py-5">
            No open tasks for this property. Capture one above.
          </p>
        )}

        {groups.map(g => {
          if (!g.tasks.length) return null
          const collapsible = focusDue && (g.key === 'later' || g.key === 'nodate')
          const collapsed = isCollapsed(g.key)
          const header = (
            <>
              {collapsible && (
                <ChevronDown size={13}
                  className={cn('text-slate-400 transition-transform', collapsed && '-rotate-90')} />
              )}
              <span className={cn('text-xs font-semibold uppercase tracking-wide',
                g.tone === 'red' ? 'text-red-700' : 'text-slate-600')}>
                {g.label}
              </span>
              <span className={cn('text-xs px-1.5 py-0.5 rounded-full',
                g.tone === 'red' ? 'text-red-600 bg-red-100' : 'text-slate-400 bg-slate-200')}>
                {g.tasks.length}
              </span>
            </>
          )
          return (
            <div key={g.key}>
              {collapsible ? (
                <button
                  onClick={() => setExpandedGroups(prev => {
                    const next = new Set(prev)
                    if (next.has(g.key)) next.delete(g.key)
                    else next.add(g.key)
                    return next
                  })}
                  className="w-full flex items-center gap-2 px-6 py-2 border-b bg-slate-50 border-slate-200 hover:bg-slate-100 transition-colors">
                  {header}
                </button>
              ) : (
                <div className={cn('flex items-center gap-2 px-6 py-2 border-b',
                  g.tone === 'red' ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-200')}>
                  {header}
                </div>
              )}
              {!collapsed && g.tasks.map(row)}
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
            {completedOpen && completed.map(row)}
          </div>
        )}
      </div>

      {showForm && modalData && (
        <TaskFormModal
          task={editTask}
          properties={modalData.properties}
          contacts={modalData.contacts}
          capexProjects={modalData.capexProjects}
          allTasks={tasks}
          onComplete={completeTask}
          onClose={() => { setShowForm(false); setEditTask(null) }}
          onSave={() => { setShowForm(false); setEditTask(null); fetchTasks() }}
        />
      )}
    </div>
  )
}
