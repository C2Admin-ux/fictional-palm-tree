'use client'

import { useEffect, useState, useCallback, useMemo, useRef, memo } from 'react'
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
import { groupByDue } from '@/lib/tasks/dates'
import { topLevel, childrenByParent, openSubtasksOf } from '@/lib/tasks/subtasks'
import {
  Plus, X, ChevronDown, RefreshCw, Mountain, Moon,
  Link as LinkIcon, Keyboard,
} from 'lucide-react'
import { TaskQuickAdd } from '@/components/tasks/task-quick-add'
import { SnoozeMenu } from '@/components/tasks/snooze-menu'
import { SwipeRow } from '@/components/tasks/swipe-row'
import { PriorityPip, CompleteCircle, TaskBadges, DueDateCell, DeleteX } from '@/components/tasks/row-cells'
import { SubtaskChip, SubtaskList } from '@/components/tasks/subtask-list'
import { CollapseOnComplete, useExitingRows, type ExitPhase } from '@/components/tasks/complete-collapse'
import { SavedViewsBar } from '@/components/tasks/saved-views'
import { useTaskListShortcuts } from '@/components/tasks/use-task-list-shortcuts'
import { InlineText, InlineSelect, STATUS_OPTIONS } from '@/components/ui/inline-edit'
import { FilterSelect } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'
import {
  type TaskStore, patchTaskOptimistic, toggleDoneOptimistic, deleteTaskOptimistic,
  snoozeTaskOptimistic, addSubtaskOptimistic,
} from '@/lib/tasks/mutations'
import { toast } from '@/components/ui/toast'

type TaskWithRelations = Task & {
  properties?: { name: string } | null
  capex_projects?: { title: string } | null
  contacts?: Contact[]
}

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

// Handlers every task list needs, bundled so the three views share
// one prop shape.
type RowHandlers = {
  onEdit: (task: TaskWithRelations) => void
  onDone: (task: TaskWithRelations) => void
  onDelete: (task: TaskWithRelations) => void
  onPatch: (task: TaskWithRelations, fields: Partial<Task>) => void
  onSnooze: (task: TaskWithRelations, date: string) => void
  // Keyboard-driven row selection (j/k etc.)
  onSelect: (id: string) => void
  // Local lookup — lets rows check whether a blocker still exists
  getTask: (id: string) => TaskWithRelations | undefined
  // Presentation-only exit animation state (useExitingRows) — stable
  // identity; rows read it for their subtask drill-downs.
  exitPhaseOf: (id: string) => ExitPhase | null
  // Subtask drill-down: toggle a parent's expanded state / inline add
  onToggleExpand: (id: string) => void
  onAddSubtask: (parent: TaskWithRelations, title: string) => void | Promise<void>
}

// Per-view subtask plumbing: children lookup + which parents are open.
// (Passed as props, not via handlers, so memoized rows re-render when
// their own children change — the progress chip must move.)
type SubtaskUi = {
  subtasksOf: (id: string) => TaskWithRelations[] | undefined
  expandedIds: Set<string>
}

// Keyboard selection can land on a subtask row (j/k walks the DOM in
// visual order). Resolve it to a prop only for the parent that owns
// it, so the other memoized rows don't re-render on selection moves.
function subtaskSelection(ui: SubtaskUi, selectedId: string | null, parentId: string): string | null {
  if (!selectedId) return null
  return (ui.subtasksOf(parentId) ?? []).some(s => s.id === selectedId) ? selectedId : null
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
  const [filterProp, setFilterProp] = useState(searchParams.get('property') ?? '')
  const [filterCapex, setFilterCapex] = useState(searchParams.get('capex') ?? '')
  const [filterContact, setFilterContact] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [search, setSearch] = useState('')

  // How the All-tasks list is sectioned — per-session, captured by
  // saved views.
  const [groupBy, setGroupBy] = useState<GroupByMode>('status')

  // View mode. Agenda is the default, but deep links that carry a
  // property/capex filter land on the list where those filters live.
  const [view, setView] = useState<ViewMode>(() =>
    searchParams.get('property') || searchParams.get('capex') ? 'all' : 'agenda'
  )

  // Collapsed sections (All tasks view) — keyed per grouping so a
  // collapse in one group-by doesn't leak into another.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['status:done']))

  // Keyboard-selected row (j/k navigation)
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
      insert: task => setTasks(prev => sortTasks([...prev, enrich(task)])),
      remove: id => setTasks(prev => prev.filter(t => t.id !== id)),
    }
  }, [])

  const markDone = useCallback(
    // Completing a parent takes its open subtasks with it — one action,
    // one toast, one undo (children resolved from the latest state).
    // onRevert cancels the exit animation (failed write / Undo) so the
    // row reappears instantly.
    (task: TaskWithRelations) => toggleDoneOptimistic(supabase, store, task, {
      openSubtasks: openSubtasksOf(tasksRef.current, task.id),
      onRevert: () => cancelExit(task.id),
    }),
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
  }), [supabase, store, completeTask, deleteTask, taskById, phaseOf, toggleExpand, userId])

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
            subtaskUi={subtaskUi} />
        ) : view === 'review' ? (
          <ReviewView tasks={renderTasks} userId={userId} handlers={handlers} selectedId={selectedId}
            subtaskUi={subtaskUi} />
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
                      <div className="flex items-center px-6 py-1.5 border-b border-slate-100 bg-white">
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
                          exitPhase={handlers.exitPhaseOf(task.id)}
                          subtasks={subtaskUi.subtasksOf(task.id)}
                          expanded={subtaskUi.expandedIds.has(task.id)}
                          subtaskSelectedId={subtaskSelection(subtaskUi, selectedId, task.id)} />
                      ))}

                      <div
                        onClick={() => { setEditTask(null); setShowForm(true) }}
                        className="flex items-center gap-2 px-6 py-2 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 cursor-pointer border-b border-slate-100 transition-colors">
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
          ['e', 'edit'], ['1–4', 'priority'], ['l/h', 'subtasks'], ['⌫', 'delete'],
          ['n', 'quick add'],
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
    </div>
  )
}

// ── Task Row ─────────────────────────────────────────────────
// Memoized: handlers/store are referentially stable, so a row only
// re-renders when its own task object (or selection) changes.

const TaskRow = memo(function TaskRow({
  task, handlers, selected = false, meta, swipeable = false, subtasks, expanded = false,
  subtaskSelectedId = null, exitPhase = null,
}: {
  task: TaskWithRelations
  handlers: RowHandlers
  selected?: boolean      // keyboard-selected (j/k)
  meta?: React.ReactNode  // extra info rendered on the second line (review views)
  swipeable?: boolean     // touch: swipe right = complete, swipe left = snooze
  subtasks?: TaskWithRelations[]  // children of this row (parents only)
  expanded?: boolean              // drill-down open (page-level session state)
  subtaskSelectedId?: string | null  // keyboard selection inside the drill-down
  exitPhase?: ExitPhase | null    // presentation-only completion exit (useExitingRows)
}) {
  const { onEdit, onDone, onDelete, onPatch, onSnooze, onSelect } = handlers
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const isDone = task.status === 'done'
  // RTM completion feel, presentation-only: every completion surface on
  // this row (circle, swipe, status dropdown, keyboard 'c' via
  // data-complete-toggle) calls onDone, which fires the mutation
  // IMMEDIATELY and starts the exit animation; while it plays, this row
  // is the pre-completion snapshot (exitPhase non-null: check popped,
  // pointer-events off, collapsing). Un-completing skips the animation.
  const leaving = exitPhase != null
  const taskContacts = task.contacts ?? []
  const pc = task.properties?.name ? propertyColor(task.properties.name) : '#64748b'
  const isRock = (task.tags ?? []).includes('rock')
  // Same semantics as the agenda's isUnblocked: only a blocker that
  // still exists locally and isn't done counts (no chip on dangling ids).
  const blocker = task.blocked_by_task_id ? handlers.getTask(task.blocked_by_task_id) : undefined
  const isBlocked = blocker != null && blocker.status !== 'done'

  // Fire-and-forget: the optimistic store already applied the change,
  // so the inline-edit primitives never sit in a saving state.
  function patch(fields: Partial<Task>) {
    onPatch(task, fields)
  }

  function toggleRock() {
    const tags = isRock
      ? (task.tags ?? []).filter(t => t !== 'rock')
      : [...(task.tags ?? []), 'rock']
    patch({ tags })
  }

  const row = (
    <div
      data-task-id={task.id}
      onClick={() => onSelect(task.id)}
      className={cn(
        'flex items-center px-6 py-0 min-h-[38px] border-b border-slate-100 group hover:bg-slate-50 transition-colors',
        isDone && 'opacity-60',
        selected && 'bg-blue-50/70 hover:bg-blue-50/70 ring-1 ring-inset ring-blue-200'
      )}>
      {/* Priority pip — click to change priority */}
      <PriorityPip priority={task.priority} isDone={isDone}
        onSave={priority => patch({ priority })} />

      {/* Checkbox */}
      <CompleteCircle isDone={isDone || leaving} onToggle={() => onDone(task)} />

      {/* Title — inline editable */}
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
              subtasks={subtasks}
              expanded={expanded}
              onToggle={() => handlers.onToggleExpand(task.id)}
            />
          )}
        </div>
        {(task.properties?.name || task.capex_projects?.title || isBlocked || meta) && (
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {task.properties?.name && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded"
                style={{ background: `${pc}18`, color: pc }}>
                {task.properties.name}
              </span>
            )}
            {task.capex_projects?.title && (
              <span className="text-xs text-orange-600 flex items-center gap-1">
                <LinkIcon size={9} />{task.capex_projects.title.slice(0, 24)}
              </span>
            )}
            {isBlocked && (
              <span className="text-xs text-amber-600">⛓ blocked</span>
            )}
            {meta}
          </div>
        )}
      </div>

      {/* Rock toggle — 'rock' tag on/off */}
      <button
        onClick={toggleRock}
        title={isRock ? 'Remove from rocks' : 'Mark as a rock'}
        className={cn('mr-1 p-1 rounded flex-shrink-0 transition-all',
          isRock
            ? 'text-amber-500 hover:text-amber-600'
            : 'text-slate-200 hover:text-amber-400 opacity-0 group-hover:opacity-100')}>
        <Mountain size={13} />
      </button>

      {/* Status — inline dropdown. Completing routes through onDone so
          it picks up the undo toast + recurrence handling. */}
      <div className="w-28 hidden md:flex justify-center">
        <InlineSelect
          value={task.status}
          options={STATUS_OPTIONS}
          onSave={v => {
            if (v === 'done') onDone(task)
            else patch({ status: v as Task['status'], completed_at: null })
          }}
        />
      </div>

      {/* People avatars */}
      <div className="w-24 hidden lg:flex justify-center items-center gap-1">
        {taskContacts.slice(0, 3).map((c: Contact) => (
          <span key={c.id} title={c.full_name}
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
            style={{ background: c.color_hex ?? '#64748b' }}>
            {c.initials ?? c.full_name.slice(0, 2).toUpperCase()}
          </span>
        ))}
        {taskContacts.length > 3 && (
          <span className="text-xs text-slate-400">+{taskContacts.length - 3}</span>
        )}
        <button onClick={() => onEdit(task)}
          className="w-6 h-6 rounded-full border border-dashed border-slate-300 flex items-center justify-center text-slate-300 hover:border-blue-400 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0">
          <Plus size={10} />
        </button>
      </div>

      {/* Due date — inline date picker (data-due-edit lets the `d`
          shortcut open it via the same click path) */}
      <DueDateCell dueDate={task.due_date} isDone={isDone}
        onSave={v => patch({ due_date: v })} />

      {/* Snooze presets — no modal needed. Always visible on mobile,
          hover-revealed on desktop; the `s` shortcut clicks this same
          trigger. */}
      <div data-snooze-trigger className="w-6 flex justify-center">
        <SnoozeMenu
          open={snoozeOpen}
          onOpenChange={setSnoozeOpen}
          onSnooze={date => onSnooze(task, date)}
          buttonClassName="md:opacity-0 md:group-hover:opacity-100"
        />
      </div>

      {/* Delete — instant, with an Undo toast */}
      <DeleteX onDelete={() => onDelete(task)} />
    </div>
  )

  const body = swipeable ? (
    <SwipeRow
      onSwipeRight={() => onDone(task)}
      onSwipeLeft={() => setSnoozeOpen(true)}>
      {row}
    </SwipeRow>
  ) : row

  // The collapse wraps the row AND its expanded drill-down: completing
  // a parent takes the whole block out in one motion.
  return (
    <CollapseOnComplete phase={exitPhase}>
      {body}
      {subtasks != null && subtasks.length > 0 && expanded && (
        <SubtaskList
          subtasks={subtasks}
          selectedId={subtaskSelectedId}
          onSelect={onSelect}
          exitPhaseOf={handlers.exitPhaseOf}
          onToggleDone={onDone}
          onPatch={onPatch}
          onDelete={onDelete}
          onAdd={title => handlers.onAddSubtask(task, title)}
        />
      )}
    </CollapseOnComplete>
  )
})

// ── Agenda View ──────────────────────────────────────────────
// Daily driver: quick-add into my inbox, my inbox to process, then
// everything actionable now grouped by due date, snoozed at the end.

function AgendaView({ tasks, userId, handlers, selectedId, properties, onQuickAdd, subtaskUi }: {
  tasks: TaskWithRelations[]
  userId: string | null
  handlers: RowHandlers
  selectedId: string | null
  properties: Property[]
  onQuickAdd: (task: Task) => void
  subtaskUi: SubtaskUi
}) {
  const [inboxOpen, setInboxOpen] = useState(true)
  const [snoozedOpen, setSnoozedOpen] = useState(false)

  const today = todayISO()

  const { myInbox, groups, hasDated, snoozed } = useMemo(() => {
    const taskById = new Map(tasks.map(t => [t.id, t]))

    // Actionable-now semantics. Subtasks never surface as top-level
    // rows — they live in their parent's drill-down only (shared
    // topLevel helper, lib/tasks/subtasks.ts).
    const tops = topLevel(tasks)
    const isMine = (t: TaskWithRelations) => !t.assigned_to || t.assigned_to === userId
    const isAwake = (t: TaskWithRelations) => !t.snoozed_until || t.snoozed_until <= today
    const isUnblocked = (t: TaskWithRelations) => {
      if (!t.blocked_by_task_id) return true
      const blocker = taskById.get(t.blocked_by_task_id)
      return !blocker || blocker.status === 'done'
    }

    // Personal inbox: things I captured that still need processing
    const myInbox = tops.filter(t =>
      t.status === 'inbox' && t.created_by != null && t.created_by === userId && isAwake(t)
    )
    const inboxIds = new Set(myInbox.map(t => t.id))

    const actionable = tops.filter(t =>
      t.status !== 'done' && isMine(t) && isAwake(t) && isUnblocked(t) && !inboxIds.has(t.id)
    )

    // Shared bucketing (same as the property Tasks tab) — 'Later' is
    // unbounded, so a capture dated months out still shows up.
    const groups = groupByDue(actionable, today, { nodate: 'No due date' })
    const hasDated = groups.some(g => g.tasks.length > 0)

    const snoozed = tops.filter(t =>
      t.status !== 'done' && isMine(t) && t.snoozed_until != null && t.snoozed_until > today
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
            <TaskRow key={t.id} task={t} handlers={handlers} selected={selectedId === t.id} swipeable
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
              <TaskRow key={t.id} task={t} handlers={handlers} selected={selectedId === t.id} swipeable
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
            <div key={t.id} className="flex items-center gap-3 px-6 py-2 border-b border-slate-100 hover:bg-slate-50 transition-colors">
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

function ReviewView({ tasks, userId, handlers, selectedId, subtaskUi }: {
  tasks: TaskWithRelations[]
  userId: string | null
  handlers: RowHandlers
  selectedId: string | null
  subtaskUi: SubtaskUi
}) {
  const rowProps = (t: TaskWithRelations) =>
    ({
      task: t, handlers, selected: selectedId === t.id,
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
                <div className="flex items-center gap-2 px-6 py-1.5 bg-white border-b border-slate-100">
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
      <div className="border-b border-slate-200">
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
    <div className="border-b border-slate-200">
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
  return <div className="px-6 py-4 text-sm text-slate-400">{label}</div>
}

// ── Task Form Modal ──────────────────────────────────────────

function TaskFormModal({ task, properties, contacts, capexProjects, allTasks, onComplete, onClose, onSave }: {
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
              <input type="date" value={form.due_date}
                onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                className="input" />
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

          {/* People */}
          <div>
            <label className="label">People</label>
            <div className="flex flex-wrap gap-2">
              {contacts.map(c => (
                <button key={c.id} type="button"
                  onClick={() => toggleContact(c.id)}
                  className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-all',
                    selectedContacts.includes(c.id)
                      ? 'text-white border-transparent'
                      : 'text-slate-600 border-slate-200 hover:border-slate-300'
                  )}
                  style={selectedContacts.includes(c.id)
                    ? { background: c.color_hex ?? '#64748b' }
                    : {}}>
                  <span className="w-4 h-4 rounded-full flex items-center justify-center text-white flex-shrink-0"
                    style={{ background: c.color_hex ?? '#64748b', fontSize: 9 }}>
                    {(c.initials ?? c.full_name.slice(0, 2)).toUpperCase()}
                  </span>
                  {c.full_name.split(' ')[0]}
                </button>
              ))}
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

function CheckSquareIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-slate-200">
      <rect x="2" y="2" width="28" height="28" rx="6" stroke="currentColor" strokeWidth="2" />
      <path d="M10 16l4 4 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
