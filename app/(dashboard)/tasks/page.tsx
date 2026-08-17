'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Json, Task, TaskView, Contact, Property, CapexProject } from '@/lib/supabase/types'
import {
  cn, formatDateShort, daysUntil,
  todayISO,
  STATUS_STYLES, STATUS_LABELS,
  propertyColor,
} from '@/lib/utils'
import { groupByDue, postponeDate } from '@/lib/tasks/dates'
import { isMine, isAwake, isUnblocked } from '@/lib/tasks/agenda'
import { topLevel, childrenByParent, openSubtasksOf } from '@/lib/tasks/subtasks'
import {
  Plus, X, ChevronDown, Mountain, Moon,
  Keyboard,
} from 'lucide-react'
import { TaskQuickAdd } from '@/components/tasks/task-quick-add'
import {
  TaskRow, subtaskSelection,
  type RowHandlers, type SubtaskUi, type TaskWithRelations,
} from '@/components/tasks/task-row'
import { TaskFormModal } from '@/components/tasks/task-form-modal'
import { useExitingRows } from '@/components/tasks/complete-collapse'
import { SavedViewsBar } from '@/components/tasks/saved-views'
import { useTaskListShortcuts } from '@/components/tasks/use-task-list-shortcuts'
import { FilterSelect } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import {
  type TaskStore, patchTaskOptimistic, toggleDoneOptimistic, deleteTaskOptimistic,
  snoozeTaskOptimistic, addSubtaskOptimistic, postponeTaskOptimistic,
  batchPatchOptimistic, batchCompleteOptimistic,
} from '@/lib/tasks/mutations'
import { BatchBar } from '@/components/tasks/batch-bar'
import { TASK_CREATED_EVENT } from '@/lib/tasks/create'
import { toast } from '@/components/ui/toast'

// Shape of a row as returned by the select with joins, before we
// flatten the task_contacts junction into a plain contacts array.
type RawTaskRow = Task & {
  properties: { name: string } | null
  capex_projects: { title: string } | null
  task_contacts: { contact_id: string; contacts: Contact | null }[] | null
}

type StatusFilter = 'inbox' | 'next_action' | 'waiting' | 'blocked' | 'done'
type ViewMode = 'agenda' | 'all' | 'review'
type GroupByMode = 'status' | 'property' | 'priority' | 'due'

const STATUS_ORDER: StatusFilter[] = ['inbox', 'next_action', 'waiting', 'blocked', 'done']
const SECTION_LABELS: Record<StatusFilter, string> = {
  inbox:       'Inbox — to process',
  next_action: 'Next actions',
  waiting:     'Waiting for',
  blocked:     'Blocked',
  done:        'Completed',
}

const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'] as const

const GROUP_BY_OPTIONS: { value: GroupByMode; label: string }[] = [
  { value: 'status',   label: 'Group: Status' },
  { value: 'property', label: 'Group: Property' },
  { value: 'priority', label: 'Group: Priority' },
  { value: 'due',      label: 'Group: Due' },
]

// ── Saved views (task_views.config) ──────────────────────────
// Everything a chip restores: tab, status pills, the four filters,
// search, and group-by. (The lists have no user-facing sort control —
// ordering is fixed — so there's nothing to capture there.)

type ViewConfig = {
  v: 1                    // config schema version (stored in the blob)
  view: ViewMode
  statuses: StatusFilter[]
  property: string
  capex: string
  contact: string
  priority: string
  search: string
  groupBy: GroupByMode
}

const DEFAULT_STATUSES: StatusFilter[] = ['inbox', 'next_action', 'waiting', 'blocked']

// Defensive parse — config is opaque jsonb, so missing/foreign keys
// fall back to the page defaults instead of crashing a chip.
// Versioned since Sprint 9 ({ v: 1 }); pre-version blobs share the v1
// shape. Add a case here when a future version changes the shape.
function parseViewConfig(raw: Json): ViewConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>
  switch (cfg.v) {
    case 1:
    default: {
      const str = (v: unknown) => (typeof v === 'string' ? v : '')
      const statuses = Array.isArray(cfg.statuses)
        ? STATUS_ORDER.filter(s => (cfg.statuses as unknown[]).includes(s))
        : []
      return {
        v: 1,
        view: cfg.view === 'agenda' || cfg.view === 'review' ? cfg.view : 'all',
        statuses: statuses.length > 0 ? statuses : DEFAULT_STATUSES,
        property: str(cfg.property),
        capex:    str(cfg.capex),
        contact:  str(cfg.contact),
        priority: str(cfg.priority),
        search:   str(cfg.search),
        groupBy:  cfg.groupBy === 'property' || cfg.groupBy === 'priority' || cfg.groupBy === 'due'
          ? cfg.groupBy : 'status',
      }
    }
  }
}

// Key-driven comparison over the actual ViewConfig keys — a field
// added to the type (and to parse/currentConfig) is compared
// automatically instead of being silently ignored.
function sameViewConfig(a: ViewConfig, b: ViewConfig): boolean {
  return (Object.keys(a) as (keyof ViewConfig)[]).every(k =>
    k === 'statuses'
      ? a.statuses.join(',') === b.statuses.join(',')
      : a[k] === b[k]
  )
}

const VIEW_TABS: { key: ViewMode; label: string }[] = [
  { key: 'agenda', label: 'Agenda' },
  { key: 'all',    label: 'All tasks' },
  { key: 'review', label: 'Review' },
]

// URL → landing state, used for the initial render AND re-applied when
// searchParams change (client-side navigations to /tasks?view=… after
// the page is already mounted — e.g. the dashboard's "Plan my week →"
// while sitting on /tasks). An explicit ?view= wins; otherwise a
// property/capex deep link lands on the All list where those filters
// live; plain /tasks restores the Agenda default.
// Filters are seeded ONLY when the landing view is 'all': under
// Agenda/Review the filter bar isn't visible, so seeding would
// invisibly narrow the All list the next time the user switches to it.
function paramsToNav(searchParams: URLSearchParams): {
  view: ViewMode; property: string; capex: string
} {
  const v = searchParams.get('view')
  const property = searchParams.get('property') ?? ''
  const capex = searchParams.get('capex') ?? ''
  const view: ViewMode = v === 'agenda' || v === 'all' || v === 'review' ? v
    : property || capex ? 'all' : 'agenda'
  const seed = view === 'all'
  return { view, property: seed ? property : '', capex: seed ? capex : '' }
}

// Property grouping for the All view: sections in property-name order,
// portfolio-wide ("No property") last.
function groupByPropertySections<T extends Task & { properties?: { name: string } | null }>(
  tasks: T[]
): { key: string; label: string; tasks: T[] }[] {
  const map = new Map<string, { label: string; tasks: T[] }>()
  for (const t of tasks) {
    const key = t.property_id ?? 'none'
    const entry = map.get(key)
    if (entry) entry.tasks.push(t)
    else map.set(key, { label: t.properties?.name ?? 'No property', tasks: [t] })
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, label: v.label, tasks: v.tasks }))
    .sort((a, b) =>
      a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label.localeCompare(b.label))
}

// Keep inserts in the same order the fetch would return them
// (due_date asc nulls-last, then created_at desc).
function sortTasks<T extends Task>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ad = a.due_date ?? '9999-12-31'
    const bd = b.due_date ?? '9999-12-31'
    if (ad !== bd) return ad.localeCompare(bd)
    return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  })
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading…</div>}>
      <TasksInner />
    </Suspense>
  )
}

function TasksInner() {
  const supabase = useMemo(() => createClient(), [])
  const searchParams = useSearchParams()

  const [tasks, setTasks] = useState<TaskWithRelations[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [capexProjects, setCapexProjects] = useState<CapexProject[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTask, setEditTask] = useState<TaskWithRelations | null>(null)

  // Filters (All tasks view)
  const [activeStatuses, setActiveStatuses] = useState<Set<StatusFilter>>(
    new Set<StatusFilter>(['inbox', 'next_action', 'waiting', 'blocked'])
  )
  const [filterProp, setFilterProp] = useState(() => paramsToNav(searchParams).property)
  const [filterCapex, setFilterCapex] = useState(() => paramsToNav(searchParams).capex)
  const [filterContact, setFilterContact] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [search, setSearch] = useState('')

  // How the All-tasks list is sectioned — per-session, captured by
  // saved views.
  const [groupBy, setGroupBy] = useState<GroupByMode>('status')

  // View mode + deep-link filters — see paramsToNav for the rules.
  const [view, setView] = useState<ViewMode>(() => paramsToNav(searchParams).view)

  // Later navigations must land the same way the initial one did: a
  // /tasks?view=… link clicked while this page is already mounted only
  // changes searchParams, so re-apply them here (plain /tasks restores
  // the Agenda default; filters seed only on an 'all' landing —
  // paramsToNav explains why).
  useEffect(() => {
    const nav = paramsToNav(searchParams)
    setView(nav.view)
    if (nav.view === 'all') {
      setFilterProp(nav.property)
      setFilterCapex(nav.capex)
    }
  }, [searchParams])

  // Deep link: /tasks?task=<id> opens that task's full editor over the
  // list — the palette, capex rows, and renewal chase links land ON the
  // task instead of at the top of the list. Consumed once per param
  // value (the ref), so closing the modal doesn't bounce it back open.
  const consumedTaskParam = useRef<string | null>(null)
  useEffect(() => {
    const id = searchParams.get('task')
    if (!id || loading || consumedTaskParam.current === id) return
    consumedTaskParam.current = id
    const t = tasks.find(x => x.id === id)
    if (t) {
      setEditTask(t)
      setShowForm(true)
      setSelectedId(id)
    } else {
      toast('That task no longer exists — it may have been deleted', { tone: 'error' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading, tasks])

  // Collapsed sections (All tasks view) — keyed per grouping so a
  // collapse in one group-by doesn't leak into another.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['status:done']))

  // Keyboard-selected row (j/k navigation)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Multi-select for the batch bar (checkbox / shift-click / `x`).
  // lastCheckedRef anchors shift-range extension in DOM visual order.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const lastCheckedRef = useRef<string | null>(null)

  // Expanded subtask drill-downs — per-session, not persisted
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Saved views (task_views, user-scoped)
  const [savedViews, setSavedViews] = useState<TaskView[]>([])

  const fetchTasks = useCallback(async () => {
    const { data } = await supabase
      .from('tasks')
      .select(`
        *,
        properties(name),
        capex_projects(title),
        task_contacts(contact_id, contacts(*))
      `)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })

    // Flatten contacts from the junction table
    const raw = (data ?? []) as unknown as RawTaskRow[]
    const withContacts: TaskWithRelations[] = raw.map(({ task_contacts, ...t }) => ({
      ...t,
      contacts: (task_contacts ?? []).map(tc => tc.contacts).filter((c): c is Contact => Boolean(c)),
    }))

    setTasks(withContacts)
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null
      setUserId(uid)
      // Saved views ride along with the page load — user-scoped,
      // ordered by sort_order then age.
      if (uid) {
        supabase.from('task_views').select('*').eq('user_id', uid)
          .order('sort_order').order('created_at')
          .then(({ data: viewRows }) => setSavedViews((viewRows as TaskView[]) ?? []))
      }
    })
    supabase.from('properties').select('*').eq('status', 'active').order('name')
      .then(({ data }) => setProperties(data ?? []))
    supabase.from('contacts').select('*').order('full_name')
      .then(({ data }) => setContacts(data ?? []))
    supabase.from('capex_projects').select('id, title, property_id')
      .in('status', ['planning', 'approved', 'in_progress'])
      .order('title')
      .then(({ data }) => setCapexProjects((data as CapexProject[]) ?? []))
  }, [supabase])

  // Presentation-only exit animation for completed rows: the mutation
  // fires immediately (store + DB + toast + recurrence); useExitingRows
  // keeps a pre-completion snapshot rendered in place while the check
  // pop + collapse plays. Every RENDER derivation below feeds from
  // renderTasks; mutation logic keeps reading the real tasks state.
  const { begin: beginExit, cancel: cancelExit, overlay, phaseOf } = useExitingRows<TaskWithRelations>()
  const renderTasks = useMemo(() => overlay(tasks), [overlay, tasks])

  // Subtasks NEVER render as top-level rows — every list and count in
  // the three views starts from topLevelTasks; children hang off their
  // parent via the child map (drill-down only). Shared helpers:
  // lib/tasks/subtasks.ts.
  const topLevelTasks = useMemo(() => topLevel(renderTasks), [renderTasks])
  const childMap = useMemo(() => childrenByParent(renderTasks), [renderTasks])
  const subtasksOf = useCallback(
    (id: string) => childMap.get(id), [childMap]
  )
  const subtaskUi: SubtaskUi = useMemo(
    () => ({ subtasksOf, expandedIds }), [subtasksOf, expandedIds]
  )

  // All-view filtering (client side — the shared fetch feeds all three views)
  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return topLevelTasks.filter(t => {
      if (!activeStatuses.has(t.status as StatusFilter)) return false
      if (filterPriority && t.priority !== filterPriority) return false
      if (filterProp && t.property_id !== filterProp) return false
      if (filterCapex && t.capex_project_id !== filterCapex) return false
      if (filterContact && !(t.contacts ?? []).some(c => c.id === filterContact)) return false
      if (q && !t.title.toLowerCase().includes(q) && !(t.description ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [topLevelTasks, activeStatuses, filterPriority, filterProp, filterCapex, filterContact, search])

  const counts = useMemo(() => STATUS_ORDER.reduce((acc, s) => {
    acc[s] = topLevelTasks.filter(t => t.status === s).length
    return acc
  }, {} as Record<StatusFilter, number>), [topLevelTasks])

  // One collapsible-section shape for every grouping. Status keeps the
  // current order/labels; Property sorts by name with "No property"
  // last; Priority runs urgent→low; Due reuses the shared groupByDue
  // bucketing (Overdue keeps its red tone).
  const sections: { key: string; label: string; tone?: 'red'; tasks: TaskWithRelations[] }[] = useMemo(() =>
    groupBy === 'property' ? groupByPropertySections(visibleTasks)
    : groupBy === 'priority' ? PRIORITY_ORDER.map(p => ({
        key: p, label: p, tasks: visibleTasks.filter(t => t.priority === p),
      }))
    : groupBy === 'due' ? (() => {
        // Due buckets carry deadline semantics: a done task isn't
        // "Overdue" and a snoozed task is deliberately parked, so both
        // move to trailing sections instead of date buckets. Blocked
        // tasks keep their real deadlines and stay bucketed.
        const today = todayISO()
        const doneTasks = visibleTasks.filter(t => t.status === 'done')
        const snoozedTasks = visibleTasks.filter(t =>
          t.status !== 'done' && t.snoozed_until != null && t.snoozed_until > today)
        const parked = new Set([...doneTasks, ...snoozedTasks].map(t => t.id))
        return [
          ...groupByDue(visibleTasks.filter(t => !parked.has(t.id)), today).map(g => ({
            key: g.key as string, label: g.label, tone: g.tone, tasks: g.tasks,
          })),
          { key: 'snoozed', label: 'Snoozed', tasks: snoozedTasks },
          { key: 'done', label: 'Completed', tasks: doneTasks },
        ]
      })()
    : STATUS_ORDER.map(s => ({
        key: s, label: SECTION_LABELS[s], tasks: visibleTasks.filter(t => t.status === s),
      })),
  [groupBy, visibleTasks])

  function toggleStatus(s: StatusFilter) {
    setActiveStatuses(prev => {
      const next = new Set(prev)
      if (next.has(s)) { if (next.size > 1) next.delete(s) }
      else next.add(s)
      return next
    })
  }

  function toggleSection(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ── Optimistic mutation plumbing ───────────────────────────
  // Local state changes apply instantly; Supabase writes happen in the
  // background and roll back (with an error toast) on failure.
  // Store + handlers are referentially stable (latest data via refs)
  // so the memoized rows only re-render when their own task changes.

  const tasksRef = useRef(tasks); tasksRef.current = tasks
  const propertiesRef = useRef(properties); propertiesRef.current = properties
  const capexRef = useRef(capexProjects); capexRef.current = capexProjects

  const store: TaskStore = useMemo(() => {
    // Bare rows (recurrence instances, undo re-inserts) lack the joined
    // display fields — derive them from the already-loaded lookups.
    const enrich = (task: Task): TaskWithRelations => {
      const partial = task as TaskWithRelations
      const propName = propertiesRef.current.find(p => p.id === task.property_id)?.name
      const capexTitle = capexRef.current.find(c => c.id === task.capex_project_id)?.title
      return {
        ...task,
        properties: partial.properties ?? (propName ? { name: propName } : null),
        capex_projects: partial.capex_projects ?? (capexTitle ? { title: capexTitle } : null),
        contacts: partial.contacts ?? [],
      }
    }
    return {
      // Always re-sort on update — a due_date edit must move the row, and
      // the arrays are small enough that sorting every patch is cheap.
      update: (id, fields) => setTasks(prev => sortTasks(prev.map(t => t.id === id ? { ...t, ...fields } : t))),
      // Idempotent by id: creations arrive both from direct calls (the
      // inline quick-add) and the c2:task-created broadcast — whichever
      // lands second is a no-op.
      insert: task => setTasks(prev =>
        prev.some(t => t.id === task.id) ? prev : sortTasks([...prev, enrich(task)])),
      remove: id => setTasks(prev => prev.filter(t => t.id !== id)),
    }
  }, [])

  // Tasks captured on OTHER surfaces (global sheet, command palette,
  // record "+ Task" buttons) broadcast themselves — insert them so the
  // on-screen list never goes stale while this page is open.
  useEffect(() => {
    function onTaskCreated(e: Event) {
      const task = (e as CustomEvent<Task>).detail
      if (task?.id) store.insert(task)
    }
    window.addEventListener(TASK_CREATED_EVENT, onTaskCreated)
    return () => window.removeEventListener(TASK_CREATED_EVENT, onTaskCreated)
  }, [store])

  const markDone = useCallback(
    // Completing a parent takes its open subtasks with it — one action,
    // one toast, one undo (children resolved from the latest state).
    // onRevert cancels the exit animation (failed write / Undo) so the
    // row reappears instantly. The returned undo closure is only used
    // by the batch path — single completions undo via their own toast.
    async (task: TaskWithRelations): Promise<void> => {
      await toggleDoneOptimistic(supabase, store, task, {
        openSubtasks: openSubtasksOf(tasksRef.current, task.id),
        onRevert: () => cancelExit(task.id),
      })
    },
    [supabase, store, cancelExit]
  )

  // Completion entry point for every surface (circle, swipe, status
  // dropdown, keyboard 'c', modal saved as done): the mutation fires
  // immediately; the exit animation is presentation-only. Un-completing
  // (from a done section) skips the animation entirely.
  const completeTask = useCallback((task: TaskWithRelations): void | Promise<void> => {
    if (task.status === 'done') return markDone(task)
    // Already animating out (e.g. the same task rendered in two Review
    // sections) — the mutation already fired once.
    if (!beginExit(task)) return
    return markDone(task)
  }, [markDone, beginExit])

  const deleteTask = useCallback(
    (task: TaskWithRelations) => deleteTaskOptimistic(supabase, store, task, {
      // The junction rows died with the task — restored on undo.
      contactIds: (task.contacts ?? []).map(c => c.id),
    }),
    [supabase, store]
  )

  const taskById = useCallback((id: string) => tasksRef.current.find(t => t.id === id), [])

  // Expand/collapse a parent's drill-down. 'toggle' flips; 'open'/'close'
  // are idempotent (the keyboard layer's l / h). No-op for childless rows.
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

  // Toggle a row's membership in the batch set. Shift extends from the
  // last toggled row in DOM visual order — the same order j/k walks.
  const toggleCheck = useCallback((id: string, shift: boolean) => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (shift && lastCheckedRef.current && lastCheckedRef.current !== id) {
        const ids = Array.from(document.querySelectorAll<HTMLElement>('[data-task-id]'))
          .map(el => el.dataset.taskId as string)
        const a = ids.indexOf(lastCheckedRef.current)
        const b = ids.indexOf(id)
        if (a !== -1 && b !== -1) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(ids[i])
          lastCheckedRef.current = id
          return next
        }
      }
      if (next.has(id)) next.delete(id)
      else next.add(id)
      lastCheckedRef.current = id
      return next
    })
  }, [])

  const clearChecked = useCallback(() => {
    setCheckedIds(new Set())
    lastCheckedRef.current = null
  }, [])

  // The checked set only ever grows from visible rows, but rows can
  // leave (complete, delete, filter change) — prune quietly so the bar's
  // count never includes ghosts.
  useEffect(() => {
    setCheckedIds(prev => {
      const live = new Set(tasks.map(t => t.id))
      const next = new Set(Array.from(prev).filter(id => live.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [tasks])

  const checkedTasks = useMemo(
    () => tasks.filter(t => checkedIds.has(t.id)), [tasks, checkedIds])

  const postponeTask = useCallback((task: TaskWithRelations, days: number) => {
    postponeTaskOptimistic(supabase, store, task,
      postponeDate(task.due_date, days, todayISO()))
  }, [supabase, store])

  const handlers: RowHandlers = useMemo(() => ({
    onEdit: t => { setEditTask(t); setShowForm(true) },
    onDone: completeTask,
    onDelete: deleteTask,
    onPatch: (task, fields) => { patchTaskOptimistic(supabase, store, task, fields) },
    onSnooze: (task, date) => { snoozeTaskOptimistic(supabase, store, task, date) },
    onSelect: setSelectedId,
    getTask: taskById,
    exitPhaseOf: phaseOf,
    onToggleExpand: toggleExpand,
    onAddSubtask: (parent, title) => addSubtaskOptimistic(supabase, store, parent, title, userId),
    onToggleCheck: toggleCheck,
  }), [supabase, store, completeTask, deleteTask, taskById, phaseOf, toggleExpand, userId, toggleCheck])

  // Keyboard layer (desktop): j/k selection, c/s/d/e/1-4/Delete on the
  // selected row, n/q to the quick-add bar. Same mutation paths as the
  // buttons. Inert while the modal or any input has focus.
  useTaskListShortcuts({
    enabled: !showForm && !loading,
    selectedId,
    setSelectedId,
    onDelete: id => { const t = taskById(id); if (t) deleteTask(t) },
    onEdit: id => { const t = taskById(id); if (t) { setEditTask(t); setShowForm(true) } },
    onSetPriority: (id, priority) => {
      const t = taskById(id)
      if (t) patchTaskOptimistic(supabase, store, t, { priority })
    },
    onPostpone: id => { const t = taskById(id); if (t) postponeTask(t, 1) },
    onToggleSelect: id => toggleCheck(id, false),
    onExpand: toggleExpand,
  })

  const selectedCapex = filterCapex ? capexProjects.find(c => c.id === filterCapex) : null
  const hasActiveFilter = filterProp || filterCapex || filterContact || filterPriority || search

  // ── Saved views ────────────────────────────────────────────
  // A chip is "active" when its stored config matches the live state —
  // touch any filter afterwards and the highlight drops off on its own.

  const currentConfig: ViewConfig = useMemo(() => ({
    v: 1,
    view,
    statuses: STATUS_ORDER.filter(s => activeStatuses.has(s)), // canonical order
    property: filterProp,
    capex:    filterCapex,
    contact:  filterContact,
    priority: filterPriority,
    search,
    groupBy,
  }), [view, activeStatuses, filterProp, filterCapex, filterContact, filterPriority, search, groupBy])

  // Configs parse once per fetch/edit, not once per render per chip.
  const parsedViews = useMemo(
    () => savedViews.map(v => ({ row: v, config: parseViewConfig(v.config) })),
    [savedViews]
  )
  const activeViewId = parsedViews.find(p => sameViewConfig(currentConfig, p.config))?.row.id ?? null

  // Applying restores the whole state — including the tab, so an
  // Agenda-based view switches over to Agenda.
  function applySavedView(v: TaskView) {
    // Copy the pre-parsed config (stale-referent clearing mutates it).
    const parsed = parsedViews.find(p => p.row.id === v.id)?.config ?? parseViewConfig(v.config)
    const cfg = { ...parsed }
    // Stale referents (deleted/archived property, wrapped-up CapEx
    // project, removed contact) would silently filter everything down
    // to nothing — validate ids against the loaded option lists, clear
    // the stale ones, and say so.
    const stale: string[] = []
    if (cfg.property && !properties.some(p => p.id === cfg.property)) {
      cfg.property = ''
      stale.push('property')
    }
    if (cfg.capex && !capexProjects.some(c => c.id === cfg.capex)) {
      cfg.capex = ''
      stale.push('CapEx project')
    }
    if (cfg.contact && !contacts.some(c => c.id === cfg.contact)) {
      cfg.contact = ''
      stale.push('contact')
    }
    if (stale.length > 0) {
      toast(`Saved view referenced a removed ${stale.join(' and ')} — filter${stale.length > 1 ? 's' : ''} cleared`)
    }
    setView(cfg.view)
    setActiveStatuses(new Set(cfg.statuses))
    setFilterProp(cfg.property)
    setFilterCapex(cfg.capex)
    setFilterContact(cfg.contact)
    setFilterPriority(cfg.priority)
    setSearch(cfg.search)
    setGroupBy(cfg.groupBy)
  }

  async function saveCurrentView(name: string) {
    if (!userId) return
    const { data, error } = await supabase.from('task_views')
      .insert({
        user_id: userId, name,
        config: currentConfig as unknown as Json,
        sort_order: savedViews.length,
      })
      .select('*')
      .single()
    if (error || !data) {
      toast('Could not save view', { tone: 'error' })
      return
    }
    setSavedViews(prev => [...prev, data as TaskView])
  }

  function renameSavedView(v: TaskView, name: string) {
    setSavedViews(prev => prev.map(x => x.id === v.id ? { ...x, name } : x))
    void supabase.from('task_views').update({ name }).eq('id', v.id).then(({ error }) => {
      if (error) {
        setSavedViews(prev => prev.map(x => x.id === v.id ? { ...x, name: v.name } : x))
        toast('Could not rename view', { tone: 'error' })
      }
    })
  }

  function deleteSavedView(v: TaskView) {
    setSavedViews(prev => prev.filter(x => x.id !== v.id))
    void supabase.from('task_views').delete().eq('id', v.id).then(({ error }) => {
      if (error) {
        setSavedViews(prev => [...prev, v])
        toast('Could not delete view', { tone: 'error' })
        return
      }
      toast(`Deleted view "${v.name}"`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            // Same id — the delete committed, so it's free to re-insert.
            setSavedViews(prev => [...prev, v])
            const { error: restoreError } = await supabase.from('task_views').insert({
              id: v.id, user_id: v.user_id, name: v.name,
              config: v.config, sort_order: v.sort_order,
            })
            if (restoreError) {
              setSavedViews(prev => prev.filter(x => x.id !== v.id))
              toast('Could not restore view', { tone: 'error' })
            }
          },
        },
      })
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 bg-white flex-shrink-0">
        <h1 className="text-lg font-semibold text-slate-900 flex-1">Tasks</h1>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          {VIEW_TABS.map((v, i) => (
            <button key={v.key} onClick={() => setView(v.key)}
              className={cn('px-3 py-1.5 text-xs font-medium transition-colors',
                i > 0 && 'border-l border-slate-200',
                view === v.key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
              {v.label}
            </button>
          ))}
        </div>
        <button onClick={() => { setEditTask(null); setShowForm(true) }} className="btn-primary text-xs py-1.5">
          <Plus size={13} />Add task
        </button>
      </div>

      {/* Saved views — chips restore a whole page state (tab, pills,
          filters, search, group-by); shown on every tab since applying
          one can switch tabs anyway */}
      {(savedViews.length > 0 || view === 'all') && (
        <SavedViewsBar
          views={savedViews}
          activeId={activeViewId}
          onApply={applySavedView}
          onSaveNew={saveCurrentView}
          onRename={renameSavedView}
          onDelete={deleteSavedView}
        />
      )}

      {/* Filter bar — All tasks view only */}
      {view === 'all' && (
        <div className="flex items-center gap-2 px-6 py-2.5 border-b border-slate-200 bg-slate-50 flex-wrap flex-shrink-0">
          {STATUS_ORDER.map(s => (
            <button key={s} onClick={() => toggleStatus(s)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                activeStatuses.has(s)
                  ? STATUS_STYLES[s]
                  : 'text-slate-400 bg-white border-slate-200 hover:border-slate-300'
              )}>
              <span className="w-1.5 h-1.5 rounded-full"
                style={{ background: activeStatuses.has(s) ? 'currentColor' : '#cbd5e1' }} />
              {STATUS_LABELS[s]}
              <span className="opacity-60">({counts[s]})</span>
            </button>
          ))}

          <div className="w-px h-4 bg-slate-200 mx-1" />

          <FilterSelect value={filterProp} onChange={setFilterProp}
            className={cn('w-auto', filterProp && 'border-blue-400 bg-blue-50 text-blue-700')}>
            <option value="">All properties</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </FilterSelect>

          <FilterSelect value={filterCapex} onChange={setFilterCapex}
            className={cn('w-auto max-w-[160px]', filterCapex && 'border-orange-400 bg-orange-50 text-orange-700')}>
            <option value="">All CapEx projects</option>
            {capexProjects.map(c => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </FilterSelect>

          <FilterSelect value={filterContact} onChange={setFilterContact}
            className={cn('w-auto', filterContact && 'border-purple-400 bg-purple-50 text-purple-700')}>
            <option value="">All people</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </FilterSelect>

          <FilterSelect value={filterPriority} onChange={setFilterPriority}
            className={cn('w-auto', filterPriority && 'border-red-400 bg-red-50 text-red-700')}>
            <option value="">All priorities</option>
            {PRIORITY_ORDER.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </FilterSelect>

          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            aria-label="Search tasks"
            className={cn('input-sm w-32', search && 'border-blue-400 bg-blue-50 text-blue-700')}
          />

          <div className="w-px h-4 bg-slate-200 mx-1" />

          <FilterSelect value={groupBy} onChange={v => setGroupBy(v as GroupByMode)}
            ariaLabel="Group by"
            className={cn('w-auto', groupBy !== 'status' && 'border-slate-400 bg-slate-100 text-slate-700')}
            options={GROUP_BY_OPTIONS.map(o => ({ value: o.value, label: o.label }))} />

          {hasActiveFilter && (
            <button onClick={() => { setFilterProp(''); setFilterCapex(''); setFilterContact(''); setFilterPriority(''); setSearch('') }}
              className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
              <X size={12} />Clear filters
            </button>
          )}

          <span className="ml-auto text-xs text-slate-400">
            {visibleTasks.length} task{visibleTasks.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* CapEx context banner */}
      {view === 'all' && selectedCapex && (
        <div className="flex items-center gap-3 px-6 py-2 bg-orange-50 border-b border-orange-200 flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-orange-400" />
          <span className="text-xs font-medium text-orange-800">{selectedCapex.title}</span>
          <span className="text-xs text-orange-600">Showing tasks linked to this project</span>
          <button onClick={() => setFilterCapex('')}
            className="ml-auto text-xs text-orange-500 hover:text-orange-700 flex items-center gap-1">
            <X size={11} />Clear
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-slate-400">Loading…</div>
        ) : view === 'agenda' ? (
          <AgendaView tasks={renderTasks} userId={userId} handlers={handlers}
            selectedId={selectedId} properties={properties} onQuickAdd={store.insert}
            subtaskUi={subtaskUi} checkedIds={checkedIds} />
        ) : view === 'review' ? (
          <ReviewView tasks={renderTasks} userId={userId} handlers={handlers} selectedId={selectedId}
            subtaskUi={subtaskUi} checkedIds={checkedIds} />
        ) : (
          <div className="pb-8">
            {sections.map(section => {
              const sectionTasks = section.tasks
              if (!sectionTasks.length) return null
              const sectionKey = `${groupBy}:${section.key}`
              const isCollapsed = collapsed.has(sectionKey)
              return (
                <div key={sectionKey}>
                  {/* Section header */}
                  <button
                    onClick={() => toggleSection(sectionKey)}
                    className={cn(
                      'w-full flex items-center gap-2 px-6 py-2 border-b transition-colors sticky top-0 z-10',
                      section.tone === 'red'
                        ? 'bg-red-50 border-red-100 hover:bg-red-100'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    )}>
                    <ChevronDown size={13} className={cn('transition-transform', isCollapsed && '-rotate-90',
                      section.tone === 'red' ? 'text-red-400' : 'text-slate-400')} />
                    <span className={cn('text-xs font-semibold uppercase tracking-wide',
                      section.tone === 'red' ? 'text-red-700' : 'text-slate-600')}>
                      {section.label}
                    </span>
                    <span className={cn('text-xs px-1.5 py-0.5 rounded-full',
                      section.tone === 'red' ? 'text-red-600 bg-red-100' : 'text-slate-400 bg-slate-200')}>
                      {sectionTasks.length}
                    </span>
                  </button>

                  {/* Column headers */}
                  {!isCollapsed && (
                    <>
                      <div className="flex items-center px-6 py-1.5 border-b border-slate-200/70 bg-white">
                        <div className="w-3 mr-3" />
                        <div className="w-5 mr-2.5" />
                        <div className="flex-1 text-xs font-medium text-slate-400 uppercase tracking-wide">Task</div>
                        <div className="w-24 text-xs font-medium text-slate-400 uppercase tracking-wide text-center hidden md:block">Status</div>
                        <div className="w-28 text-xs font-medium text-slate-400 uppercase tracking-wide text-center hidden lg:block">People</div>
                        <div className="w-20 text-xs font-medium text-slate-400 uppercase tracking-wide text-right">Due</div>
                        <div className="w-6" />
                        <div className="w-6 ml-1" />
                      </div>

                      {sectionTasks.map(task => (
                        <TaskRow key={task.id} task={task} handlers={handlers}
                          selected={selectedId === task.id}
                          checked={checkedIds.has(task.id)}
                          exitPhase={handlers.exitPhaseOf(task.id)}
                          subtasks={subtaskUi.subtasksOf(task.id)}
                          expanded={subtaskUi.expandedIds.has(task.id)}
                          subtaskSelectedId={subtaskSelection(subtaskUi, selectedId, task.id)} />
                      ))}

                      <div
                        onClick={() => { setEditTask(null); setShowForm(true) }}
                        className="flex items-center gap-2 px-6 py-1.5 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 cursor-pointer border-b border-slate-200/70 transition-colors">
                        <Plus size={12} />Add task
                      </div>
                    </>
                  )}
                </div>
              )
            })}

            {visibleTasks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <CheckSquareIcon />
                <p className="mt-3 text-sm">No tasks match your filters</p>
                <button onClick={() => { setEditTask(null); setShowForm(true) }}
                  className="mt-3 text-sm text-blue-600 hover:underline">
                  Add a task
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Keyboard hints — desktop only, kept to one muted line */}
      <div className="hidden lg:flex items-center gap-3 px-6 py-1.5 border-t border-slate-200 bg-white flex-shrink-0 text-xs text-slate-400">
        <Keyboard size={12} className="text-slate-300 flex-shrink-0" />
        {([
          ['j/k', 'navigate'], ['c', 'complete'], ['s', 'snooze'], ['d', 'due'],
          ['p', 'postpone'], ['x', 'select'], ['e', 'edit'], ['1–4', 'priority'],
          ['l/h', 'subtasks'], ['⌫', 'delete'], ['n', 'quick add'],
        ] as const).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1 whitespace-nowrap">
            <kbd className="px-1 py-px bg-slate-100 border border-slate-200 rounded font-mono text-[10px] text-slate-500">{key}</kbd>
            {label}
          </span>
        ))}
      </div>

      {showForm && (
        <TaskFormModal
          task={editTask}
          properties={properties}
          contacts={contacts}
          capexProjects={capexProjects}
          allTasks={tasks}
          onComplete={completeTask}
          onClose={() => { setShowForm(false); setEditTask(null) }}
          onSave={() => { setShowForm(false); setEditTask(null); fetchTasks() }}
        />
      )}

      {/* Batch bar — RTM's multi-select move. Every action runs the same
          optimistic paths as the row controls; complete replays each
          task's full single-task path (recurrence, findings, undo). */}
      <BatchBar
        count={checkedTasks.length}
        onComplete={() => {
          const targets = checkedTasks
          clearChecked()
          void batchCompleteOptimistic(supabase, store, targets, {
            openSubtasksOf: id => openSubtasksOf(tasksRef.current, id),
            onRevert: cancelExit,
          })
          for (const t of targets) if (t.status !== 'done') beginExit(t)
        }}
        onDue={date => { void batchPatchOptimistic(supabase, store, checkedTasks, { due_date: date }, date ? `Due ${formatDateShort(date)}` : 'Due date cleared') }}
        onSnooze={date => { void batchPatchOptimistic(supabase, store, checkedTasks, { snoozed_until: date }, `Snoozed until ${formatDateShort(date)}`) }}
        onPriority={priority => { void batchPatchOptimistic(supabase, store, checkedTasks, { priority }, `Priority ${priority}`) }}
        onClear={clearChecked}
      />
    </div>
  )
}

// ── Agenda View ──────────────────────────────────────────────
// Daily driver: quick-add into my inbox, my inbox to process, then
// everything actionable now grouped by due date, snoozed at the end.

function AgendaView({ tasks, userId, handlers, selectedId, properties, onQuickAdd, subtaskUi, checkedIds }: {
  tasks: TaskWithRelations[]
  userId: string | null
  handlers: RowHandlers
  selectedId: string | null
  properties: Property[]
  onQuickAdd: (task: Task) => void
  subtaskUi: SubtaskUi
  checkedIds: Set<string>
}) {
  const [inboxOpen, setInboxOpen] = useState(true)
  const [snoozedOpen, setSnoozedOpen] = useState(false)

  const today = todayISO()

  const { myInbox, groups, hasDated, snoozed } = useMemo(() => {
    const taskById = new Map(tasks.map(t => [t.id, t]))

    // Actionable-now semantics — the shared MINE / AWAKE / UNBLOCKED
    // predicates (lib/tasks/agenda.ts, also driving the dashboard Today
    // lane). Subtasks never surface as top-level rows — they live in
    // their parent's drill-down only (shared topLevel helper,
    // lib/tasks/subtasks.ts).
    const tops = topLevel(tasks)

    // Personal inbox: things I captured that still need processing
    const myInbox = tops.filter(t =>
      t.status === 'inbox' && t.created_by != null && t.created_by === userId && isAwake(t, today)
    )
    const inboxIds = new Set(myInbox.map(t => t.id))

    const actionable = tops.filter(t =>
      t.status !== 'done' && isMine(t, userId) && isAwake(t, today) &&
      isUnblocked(t, taskById) && !inboxIds.has(t.id)
    )

    // Shared bucketing (same as the property Tasks tab) — 'Later' is
    // unbounded, so a capture dated months out still shows up.
    const groups = groupByDue(actionable, today, { nodate: 'No due date' })
    const hasDated = groups.some(g => g.tasks.length > 0)

    const snoozed = tops.filter(t =>
      t.status !== 'done' && isMine(t, userId) && t.snoozed_until != null && t.snoozed_until > today
    ).sort((a, b) => (a.snoozed_until ?? '').localeCompare(b.snoozed_until ?? ''))

    return { myInbox, groups, hasDated, snoozed }
  }, [tasks, userId, today])

  return (
    <div className="pb-8">
      {/* Quick add — natural language straight into my inbox (or the
          agenda, when a due date was typed) */}
      <TaskQuickAdd
        userId={userId}
        properties={properties.map(p => ({ id: p.id, name: p.name }))}
        onCreated={onQuickAdd}
      />

      {/* My inbox — collapsible */}
      {myInbox.length > 0 && (
        <div>
          <button onClick={() => setInboxOpen(o => !o)}
            className="w-full flex items-center gap-2 px-6 py-2 bg-indigo-50 border-b border-indigo-100 hover:bg-indigo-100 transition-colors">
            <ChevronDown size={13} className={cn('text-indigo-400 transition-transform', !inboxOpen && '-rotate-90')} />
            <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
              Inbox ({myInbox.length})
            </span>
            <span className="text-xs text-indigo-400">to process</span>
          </button>
          {inboxOpen && myInbox.map(t => (
            <TaskRow key={t.id} task={t} handlers={handlers} selected={selectedId === t.id} swipeable checked={checkedIds.has(t.id)}
              exitPhase={handlers.exitPhaseOf(t.id)}
              subtasks={subtaskUi.subtasksOf(t.id)} expanded={subtaskUi.expandedIds.has(t.id)}
              subtaskSelectedId={subtaskSelection(subtaskUi, selectedId, t.id)} />
          ))}
        </div>
      )}

      {/* Date groups */}
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
              <TaskRow key={t.id} task={t} handlers={handlers} selected={selectedId === t.id} swipeable checked={checkedIds.has(t.id)}
                exitPhase={handlers.exitPhaseOf(t.id)}
                subtasks={subtaskUi.subtasksOf(t.id)} expanded={subtaskUi.expandedIds.has(t.id)}
                subtaskSelectedId={subtaskSelection(subtaskUi, selectedId, t.id)} />
            ))}
          </div>
        )
      })}

      {!hasDated && myInbox.length === 0 && (
        <EmptyState
          icon={<CheckSquareIcon />}
          title="All clear — nothing actionable right now"
          hint="Capture something with the quick-add bar above"
          className="border-0"
        />
      )}

      {/* Snoozed — collapsed at the bottom */}
      {snoozed.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setSnoozedOpen(o => !o)}
            className="w-full flex items-center gap-2 px-6 py-2 bg-slate-50 border-y border-slate-200 hover:bg-slate-100 transition-colors">
            <ChevronDown size={13} className={cn('text-slate-400 transition-transform', !snoozedOpen && '-rotate-90')} />
            <Moon size={12} className="text-slate-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Snoozed ({snoozed.length})
            </span>
          </button>
          {snoozedOpen && snoozed.map(t => (
            <div key={t.id} className="flex items-center gap-3 px-6 py-1.5 border-b border-slate-200/70 hover:bg-slate-50 transition-colors">
              <Moon size={12} className="text-slate-300 flex-shrink-0" />
              <button onClick={() => handlers.onEdit(t)}
                className="flex-1 min-w-0 text-left text-sm text-slate-500 hover:text-slate-800 truncate">
                {t.title}
              </button>
              {t.properties?.name && (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                  style={{ background: `${propertyColor(t.properties.name)}18`, color: propertyColor(t.properties.name) }}>
                  {t.properties.name}
                </span>
              )}
              <span className="text-xs text-slate-400 flex-shrink-0">
                wakes {formatDateShort(t.snoozed_until)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Review View ──────────────────────────────────────────────
// Guided weekly sweep: inbox to zero, waiting-on, obligations
// horizon, rocks, and what shipped in the last 7 days.

function ReviewView({ tasks, userId, handlers, selectedId, subtaskUi, checkedIds }: {
  tasks: TaskWithRelations[]
  userId: string | null
  handlers: RowHandlers
  selectedId: string | null
  subtaskUi: SubtaskUi
  checkedIds: Set<string>
}) {
  const rowProps = (t: TaskWithRelations) =>
    ({
      task: t, handlers, selected: selectedId === t.id,
      checked: checkedIds.has(t.id),
      exitPhase: handlers.exitPhaseOf(t.id),
      subtasks: subtaskUi.subtasksOf(t.id), expanded: subtaskUi.expandedIds.has(t.id),
      subtaskSelectedId: subtaskSelection(subtaskUi, selectedId, t.id),
    })
  // Subtasks stay inside their parent's drill-down — every review
  // section except the obligations horizon sweeps top-level tasks only
  // (shared topLevel helper, lib/tasks/subtasks.ts).
  const tops = topLevel(tasks)
  const myInbox = tops.filter(t => t.status === 'inbox' && t.created_by != null && t.created_by === userId)

  const waiting = [...tops]
    .filter(t => t.status === 'waiting')
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))

  // Defense in depth: obligations sweep ALL tasks, not just top-level.
  // Auto-generated deadline tasks are supposed to stay top-level (the
  // modal enforces it), but if one somehow became a subtask it must
  // still surface here — a missed renewal is worse than a duplicate
  // row. Subtasked obligations render with their parent as context.
  const obligations = tasks.filter(t =>
    t.auto_source != null && t.status !== 'done' &&
    t.due_date != null && (daysUntil(t.due_date) ?? 999) <= 90
  )
  const obligationsByProperty = obligations.reduce((acc, t) => {
    const key = t.properties?.name ?? 'Portfolio-wide'
    ;(acc[key] ??= []).push(t)
    return acc
  }, {} as Record<string, TaskWithRelations[]>)

  const rocks = tops.filter(t => (t.tags ?? []).includes('rock') && t.status !== 'done')

  const shipped = [...tops]
    .filter(t => t.status === 'done' && t.completed_at != null && (daysUntil(t.completed_at) ?? -999) >= -7)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  return (
    <div className="pb-8">
      {/* (a) Inbox to zero */}
      <ReviewSection
        title="Inbox to zero"
        count={myInbox.length}
        hint="Date it, assign it, promote it to a next action — or delete it.">
        {myInbox.length
          ? myInbox.map(t => <TaskRow key={t.id} {...rowProps(t)} />)
          : <SectionEmpty label="Inbox zero. Nothing to process." />}
      </ReviewSection>

      {/* (b) Waiting on */}
      <ReviewSection
        title="Waiting on"
        count={waiting.length}
        hint="Oldest first — chase or close them out.">
        {waiting.length
          ? waiting.map(t => {
              const waitDays = Math.max(0, -(daysUntil(t.updated_at) ?? 0))
              const names = (t.contacts ?? []).map(c => c.full_name).join(', ')
              return (
                <TaskRow key={t.id} {...rowProps(t)}
                  meta={
                    <span className="text-xs text-purple-600">
                      waiting {waitDays}d{names ? ` · ${names}` : ''}
                    </span>
                  }
                />
              )
            })
          : <SectionEmpty label="Not waiting on anyone." />}
      </ReviewSection>

      {/* (c) Obligations horizon */}
      <ReviewSection
        title="Obligations horizon"
        count={obligations.length}
        hint="Auto-generated deadlines (renewals, expirations) due within 90 days, by property.">
        {obligations.length
          ? Object.entries(obligationsByProperty).map(([prop, propTasks]) => (
              <div key={prop}>
                <div className="flex items-center gap-2 px-6 py-1.5 bg-white border-b border-slate-200/70">
                  <span className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: propertyColor(prop === 'Portfolio-wide' ? null : prop) }} />
                  <span className="text-xs font-semibold text-slate-500">{prop}</span>
                  <span className="text-xs text-slate-300">({propTasks.length})</span>
                </div>
                {propTasks.map(t => {
                  const parent = t.parent_task_id ? handlers.getTask(t.parent_task_id) : undefined
                  return (
                    <TaskRow key={t.id} {...rowProps(t)}
                      meta={parent ? (
                        <span className="text-xs text-slate-400">in “{parent.title.slice(0, 40)}”</span>
                      ) : undefined}
                    />
                  )
                })}
              </div>
            ))
          : <SectionEmpty label="No obligations due within 90 days." />}
      </ReviewSection>

      {/* (d) Rocks */}
      {/* No border-b on the section wrapper: the last row (or
          SectionEmpty) already draws the closing line, and rows can't
          drop theirs via last: through the CollapseOnComplete wrapper. */}
      <div>
        <div className="px-6 py-3 bg-amber-50 border-b border-amber-100">
          <div className="flex items-center gap-2">
            <Mountain size={16} className="text-amber-500" />
            <span className="text-sm font-bold text-amber-800 uppercase tracking-wide">Rocks</span>
            <span className="text-xs text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">{rocks.length}</span>
          </div>
          <p className="text-xs text-amber-600 mt-0.5">The big things this quarter — are they moving?</p>
        </div>
        {rocks.length
          ? rocks.map(t => <TaskRow key={t.id} {...rowProps(t)} />)
          : <SectionEmpty label="No rocks tagged. Use the mountain toggle on a task to mark one." />}
      </div>

      {/* (e) Shipped last 7 days */}
      <ReviewSection
        title="Shipped last 7 days"
        count={shipped.length}
        hint="Done and dusted — momentum check.">
        {shipped.length
          ? shipped.map(t => (
              <TaskRow key={t.id} {...rowProps(t)}
                meta={
                  <span className="text-xs text-emerald-600">
                    done {formatDateShort(t.completed_at)}
                  </span>
                }
              />
            ))
          : <SectionEmpty label="Nothing completed in the last 7 days." />}
      </ReviewSection>
    </div>
  )
}

function ReviewSection({ title, count, hint, children }: {
  title: string
  count: number
  hint: string
  children: React.ReactNode
}) {
  return (
    // No border-b on the section wrapper: the last row (or SectionEmpty)
    // already draws the closing line, and rows can't drop theirs via
    // last: through the CollapseOnComplete wrapper.
    <div>
      <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{title}</span>
          <span className="text-xs text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded-full">{count}</span>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">{hint}</p>
      </div>
      {children}
    </div>
  )
}

function SectionEmpty({ label }: { label: string }) {
  return <div className="px-6 py-4 text-sm text-slate-400 border-b border-slate-200/70">{label}</div>
}

function CheckSquareIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-slate-200">
      <rect x="2" y="2" width="28" height="28" rx="6" stroke="currentColor" strokeWidth="2" />
      <path d="M10 16l4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
