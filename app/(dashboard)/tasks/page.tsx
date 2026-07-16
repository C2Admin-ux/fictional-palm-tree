'use client'

import { useEffect, useState, useCallback } from 'react'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Task, Contact, Property, CapexProject } from '@/lib/supabase/types'
import {
  cn, formatDateShort, isOverdue, isSoon, daysUntil,
  todayISO, addDaysToDate,
  PRIORITY_DOT, STATUS_STYLES, STATUS_LABELS,
  RECUR_LABELS, propertyColor,
} from '@/lib/utils'
import {
  Plus, X, ChevronDown, RefreshCw, Mountain, Moon,
  Link as LinkIcon, AlertTriangle, Clock, Inbox as InboxIcon,
} from 'lucide-react'
import { InlineText, InlineSelect, InlineDate, STATUS_OPTIONS, PRIORITY_OPTIONS } from '@/components/ui/inline-edit'
import { FilterSelect } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'
import {
  type TaskStore, patchTaskOptimistic, toggleDoneOptimistic, deleteTaskOptimistic,
} from '@/lib/tasks/mutations'

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

const STATUS_ORDER: StatusFilter[] = ['inbox', 'next_action', 'waiting', 'blocked', 'done']
const SECTION_LABELS: Record<StatusFilter, string> = {
  inbox:       'Inbox — to process',
  next_action: 'Next actions',
  waiting:     'Waiting for',
  blocked:     'Blocked',
  done:        'Completed',
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
  onRefresh: () => void
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading…</div>}>
      <TasksInner />
    </Suspense>
  )
}

function TasksInner() {
  const supabase = createClient()
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

  // View mode. Agenda is the default, but deep links that carry a
  // property/capex filter land on the list where those filters live.
  const [view, setView] = useState<ViewMode>(() =>
    searchParams.get('property') || searchParams.get('capex') ? 'all' : 'agenda'
  )

  // Collapsed status sections (All tasks view)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['done']))

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
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
    supabase.from('properties').select('*').eq('status', 'active').order('name')
      .then(({ data }) => setProperties(data ?? []))
    supabase.from('contacts').select('*').order('full_name')
      .then(({ data }) => setContacts(data ?? []))
    supabase.from('capex_projects').select('id, title, property_id')
      .in('status', ['planning', 'approved', 'in_progress'])
      .order('title')
      .then(({ data }) => setCapexProjects((data as CapexProject[]) ?? []))
  }, [])

  // All-view filtering (client side — the shared fetch feeds all three views)
  const visibleTasks = tasks.filter(t => {
    if (!activeStatuses.has(t.status as StatusFilter)) return false
    if (filterPriority && t.priority !== filterPriority) return false
    if (filterProp && t.property_id !== filterProp) return false
    if (filterCapex && t.capex_project_id !== filterCapex) return false
    if (filterContact && !(t.contacts ?? []).some(c => c.id === filterContact)) return false
    return true
  })

  const grouped = STATUS_ORDER.reduce((acc, status) => {
    acc[status] = visibleTasks.filter(t => t.status === status)
    return acc
  }, {} as Record<StatusFilter, TaskWithRelations[]>)

  const counts = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = tasks.filter(t => t.status === s).length
    return acc
  }, {} as Record<StatusFilter, number>)

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

  // Keep inserts in the same order the fetch would return them
  // (due_date asc nulls-last, then created_at desc).
  function sortTasks(list: TaskWithRelations[]): TaskWithRelations[] {
    return [...list].sort((a, b) => {
      const ad = a.due_date ?? '9999-12-31'
      const bd = b.due_date ?? '9999-12-31'
      if (ad !== bd) return ad.localeCompare(bd)
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
  }

  // Bare rows (recurrence instances, undo re-inserts) lack the joined
  // display fields — derive them from the already-loaded lookups.
  function enrich(task: Task): TaskWithRelations {
    const partial = task as TaskWithRelations
    const propName = properties.find(p => p.id === task.property_id)?.name
    const capexTitle = capexProjects.find(c => c.id === task.capex_project_id)?.title
    return {
      ...task,
      properties: partial.properties ?? (propName ? { name: propName } : null),
      capex_projects: partial.capex_projects ?? (capexTitle ? { title: capexTitle } : null),
      contacts: partial.contacts ?? [],
    }
  }

  const store: TaskStore = {
    update: (id, fields) => setTasks(prev => prev.map(t => t.id === id ? { ...t, ...fields } : t)),
    insert: task => setTasks(prev => sortTasks([...prev, enrich(task)])),
    remove: id => setTasks(prev => prev.filter(t => t.id !== id)),
  }

  function markDone(task: TaskWithRelations) {
    toggleDoneOptimistic(supabase, store, task)
  }

  function deleteTask(task: TaskWithRelations) {
    deleteTaskOptimistic(supabase, store, task, {
      // The junction rows died with the task — bring them back on undo.
      onRestored: async () => {
        const contactIds = (task.contacts ?? []).map(c => c.id)
        if (contactIds.length > 0) {
          await supabase.from('task_contacts').insert(
            contactIds.map(cid => ({ task_id: task.id, contact_id: cid }))
          )
        }
      },
    })
  }

  const handlers: RowHandlers = {
    onEdit: t => { setEditTask(t); setShowForm(true) },
    onDone: markDone,
    onDelete: deleteTask,
    onPatch: (task, fields) => { patchTaskOptimistic(supabase, store, task, fields) },
    onRefresh: fetchTasks,
  }

  const selectedCapex = filterCapex ? capexProjects.find(c => c.id === filterCapex) : null
  const hasActiveFilter = filterProp || filterCapex || filterContact || filterPriority

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
            {['urgent', 'high', 'medium', 'low'].map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </FilterSelect>

          {hasActiveFilter && (
            <button onClick={() => { setFilterProp(''); setFilterCapex(''); setFilterContact(''); setFilterPriority('') }}
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
          <AgendaView tasks={tasks} userId={userId} handlers={handlers} />
        ) : view === 'review' ? (
          <ReviewView tasks={tasks} userId={userId} handlers={handlers} />
        ) : (
          <div className="pb-8">
            {STATUS_ORDER.map(status => {
              const sectionTasks = grouped[status]
              if (!sectionTasks.length) return null
              const isCollapsed = collapsed.has(status)
              return (
                <div key={status}>
                  {/* Section header */}
                  <button
                    onClick={() => toggleSection(status)}
                    className="w-full flex items-center gap-2 px-6 py-2 bg-slate-50 border-b border-slate-200 hover:bg-slate-100 transition-colors sticky top-0 z-10">
                    <ChevronDown size={13} className={cn('text-slate-400 transition-transform', isCollapsed && '-rotate-90')} />
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      {SECTION_LABELS[status]}
                    </span>
                    <span className="text-xs text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded-full">
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
                      </div>

                      {sectionTasks.map(task => (
                        <TaskRow key={task.id} task={task} handlers={handlers} />
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

      {showForm && (
        <TaskFormModal
          task={editTask}
          properties={properties}
          contacts={contacts}
          capexProjects={capexProjects}
          allTasks={tasks}
          onClose={() => { setShowForm(false); setEditTask(null) }}
          onSave={() => { setShowForm(false); setEditTask(null); fetchTasks() }}
        />
      )}
    </div>
  )
}

// ── Task Row ─────────────────────────────────────────────────

function TaskRow({ task, handlers, meta }: {
  task: TaskWithRelations
  handlers: RowHandlers
  meta?: React.ReactNode  // extra info rendered on the second line (review views)
}) {
  const { onEdit, onDone, onDelete, onPatch } = handlers
  const isDone = task.status === 'done'
  const overdue = !isDone && isOverdue(task.due_date)
  const soon = !isDone && !overdue && isSoon(task.due_date, 7)
  const taskContacts = task.contacts ?? []
  const pc = task.properties?.name ? propertyColor(task.properties.name) : '#64748b'
  const isRock = (task.tags ?? []).includes('rock')

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

  return (
    <div className={cn(
      'flex items-center px-6 py-0 min-h-[38px] border-b border-slate-100 group hover:bg-slate-50 transition-colors',
      isDone && 'opacity-60'
    )}>
      {/* Priority pip — click to change priority */}
      <InlineSelect
        value={task.priority}
        options={PRIORITY_OPTIONS}
        onSave={v => patch({ priority: v as Task['priority'] })}
        trigger={
          <div className="w-2 h-8 mr-3 flex-shrink-0 rounded-sm cursor-pointer hover:opacity-70 transition-opacity"
            style={{ background: isDone ? '#e2e8f0' : PRIORITY_DOT[task.priority] }} />
        }
      />

      {/* Checkbox */}
      <button onClick={() => onDone(task)}
        className={cn(
          'w-4 h-4 rounded-full border-2 flex items-center justify-center mr-3 flex-shrink-0 transition-all',
          isDone ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 hover:border-blue-400'
        )}>
        {isDone && (
          <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
            <path d="M1 3l2.5 2.5L7 1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Title — inline editable */}
      <div className="flex-1 min-w-0 py-2.5">
        <div className={cn('text-sm text-slate-900', isDone && 'line-through text-slate-400')}>
          <InlineText
            value={task.title}
            onSave={v => patch({ title: v })}
            displayClassName="font-medium"
          />
          <span className="inline-flex items-center gap-1.5 ml-1">
            {task.recur_freq && (
              <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-1.5 py-0.5">
                <RefreshCw size={9} />{RECUR_LABELS[task.recur_freq]}
              </span>
            )}
            {task.auto_source === 'expiration' && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                <Clock size={9} />Auto
              </span>
            )}
          </span>
        </div>
        {(task.properties?.name || task.capex_projects?.title || task.blocked_by_task_id || meta) && (
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
            {task.blocked_by_task_id && (
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

      {/* Due date — inline date picker */}
      <div className={cn('w-20 text-right flex-shrink-0',
        overdue ? 'text-red-600' : soon ? 'text-amber-600' : 'text-slate-400')}>
        {overdue && <AlertTriangle size={10} className="inline mr-1" />}
        <InlineDate
          value={task.due_date}
          onSave={v => patch({ due_date: v })}
          className={cn('text-xs', overdue ? 'text-red-600 font-semibold' : soon ? 'text-amber-600 font-medium' : 'text-slate-400')}
          emptyLabel="no date"
        />
      </div>

      {/* Delete — instant, with an Undo toast */}
      <div className="w-6 flex justify-center ml-1">
        <button onClick={() => onDelete(task)}
          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all">
          <X size={13} />
        </button>
      </div>
    </div>
  )
}

// ── Agenda View ──────────────────────────────────────────────
// Daily driver: quick-add into my inbox, my inbox to process, then
// everything actionable now grouped by due date, snoozed at the end.

function AgendaView({ tasks, userId, handlers }: {
  tasks: TaskWithRelations[]
  userId: string | null
  handlers: RowHandlers
}) {
  const supabase = createClient()
  const [quickTitle, setQuickTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [inboxOpen, setInboxOpen] = useState(true)
  const [snoozedOpen, setSnoozedOpen] = useState(false)

  const today = todayISO()
  const in7 = addDaysToDate(today, 7)
  const in14 = addDaysToDate(today, 14)
  const taskById = new Map(tasks.map(t => [t.id, t]))

  // Actionable-now semantics
  const isMine = (t: TaskWithRelations) => !t.assigned_to || t.assigned_to === userId
  const isAwake = (t: TaskWithRelations) => !t.snoozed_until || t.snoozed_until <= today
  const isUnblocked = (t: TaskWithRelations) => {
    if (!t.blocked_by_task_id) return true
    const blocker = taskById.get(t.blocked_by_task_id)
    return !blocker || blocker.status === 'done'
  }

  // Personal inbox: things I captured that still need processing
  const myInbox = tasks.filter(t =>
    t.status === 'inbox' && t.created_by != null && t.created_by === userId && isAwake(t)
  )
  const inboxIds = new Set(myInbox.map(t => t.id))

  const actionable = tasks.filter(t =>
    t.status !== 'done' && isMine(t) && isAwake(t) && isUnblocked(t) && !inboxIds.has(t.id)
  )

  const groups: { key: string; label: string; tone?: 'red'; tasks: TaskWithRelations[] }[] = [
    { key: 'overdue', label: 'Overdue', tone: 'red', tasks: actionable.filter(t => t.due_date != null && t.due_date < today) },
    { key: 'today',   label: 'Today',                tasks: actionable.filter(t => t.due_date === today) },
    { key: 'week',    label: 'This week',            tasks: actionable.filter(t => t.due_date != null && t.due_date > today && t.due_date <= in7) },
    { key: 'later',   label: 'Next 7–14 days',       tasks: actionable.filter(t => t.due_date != null && t.due_date > in7 && t.due_date <= in14) },
    { key: 'nodate',  label: 'No due date',          tasks: actionable.filter(t => !t.due_date) },
  ]
  const hasDated = groups.some(g => g.tasks.length > 0)

  const snoozed = tasks.filter(t =>
    t.status !== 'done' && isMine(t) && t.snoozed_until != null && t.snoozed_until > today
  ).sort((a, b) => (a.snoozed_until ?? '').localeCompare(b.snoozed_until ?? ''))

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault()
    const title = quickTitle.trim()
    if (!title || !userId) return
    setAdding(true)
    await supabase.from('tasks').insert({
      title,
      status:      'inbox',
      priority:    'medium',
      created_by:  userId,
      assigned_to: userId,
    })
    setQuickTitle('')
    setAdding(false)
    handlers.onRefresh()
  }

  return (
    <div className="pb-8">
      {/* Quick add — straight into my inbox */}
      <form onSubmit={quickAdd}
        className="flex items-center gap-2 px-6 py-3 border-b border-slate-200 bg-white">
        <InboxIcon size={15} className="text-slate-400 flex-shrink-0" />
        <input
          value={quickTitle}
          onChange={e => setQuickTitle(e.target.value)}
          disabled={!userId}
          className="input flex-1"
          placeholder={userId ? 'Quick add to my inbox…' : 'Sign in to capture tasks'} />
        <button type="submit" disabled={adding || !quickTitle.trim() || !userId}
          className="btn-primary text-xs py-1.5">
          <Plus size={13} />Add
        </button>
      </form>

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
          {inboxOpen && myInbox.map(t => <TaskRow key={t.id} task={t} handlers={handlers} />)}
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
            {g.tasks.map(t => <TaskRow key={t.id} task={t} handlers={handlers} />)}
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

function ReviewView({ tasks, userId, handlers }: {
  tasks: TaskWithRelations[]
  userId: string | null
  handlers: RowHandlers
}) {
  const myInbox = tasks.filter(t => t.status === 'inbox' && t.created_by != null && t.created_by === userId)

  const waiting = [...tasks]
    .filter(t => t.status === 'waiting')
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))

  const obligations = tasks.filter(t =>
    t.auto_source != null && t.status !== 'done' &&
    t.due_date != null && (daysUntil(t.due_date) ?? 999) <= 90
  )
  const obligationsByProperty = obligations.reduce((acc, t) => {
    const key = t.properties?.name ?? 'Portfolio-wide'
    ;(acc[key] ??= []).push(t)
    return acc
  }, {} as Record<string, TaskWithRelations[]>)

  const rocks = tasks.filter(t => (t.tags ?? []).includes('rock') && t.status !== 'done')

  const shipped = [...tasks]
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
          ? myInbox.map(t => <TaskRow key={t.id} task={t} handlers={handlers} />)
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
                <TaskRow key={t.id} task={t} handlers={handlers}
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
                {propTasks.map(t => <TaskRow key={t.id} task={t} handlers={handlers} />)}
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
          ? rocks.map(t => <TaskRow key={t.id} task={t} handlers={handlers} />)
          : <SectionEmpty label="No rocks tagged. Use the mountain toggle on a task to mark one." />}
      </div>

      {/* (e) Shipped last 7 days */}
      <ReviewSection
        title="Shipped last 7 days"
        count={shipped.length}
        hint="Done and dusted — momentum check.">
        {shipped.length
          ? shipped.map(t => (
              <TaskRow key={t.id} task={t} handlers={handlers}
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

function TaskFormModal({ task, properties, contacts, capexProjects, allTasks, onClose, onSave }: {
  task: TaskWithRelations | null
  properties: Property[]
  contacts: Contact[]
  capexProjects: CapexProject[]
  allTasks: TaskWithRelations[]
  onClose: () => void
  onSave: () => void
}) {
  const supabase = createClient()

  type FormState = {
    title: string; description: string; property_id: string
    capex_project_id: string; status: string; priority: string
    due_date: string; snoozed_until: string; blocked_by_task_id: string
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

  function toggleContact(id: string) {
    setSelectedContacts(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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
      tags:               form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      recur_freq:         (form.recur_freq || null) as Task['recur_freq'],
      recur_interval:     form.recur_freq === 'custom' ? parseInt(form.recur_interval) || null : null,
      recur_unit:         form.recur_freq === 'custom' ? (form.recur_unit as Task['recur_unit']) : null,
      recur_end_type:     form.recur_freq ? (form.recur_end_type as Task['recur_end_type']) : null,
      recur_end_date:     form.recur_end_type === 'on' ? form.recur_end_date || null : null,
      recur_end_count:    form.recur_end_type === 'after' ? parseInt(form.recur_end_count) || null : null,
    }

    let taskId: string | undefined
    if (task) {
      await supabase.from('tasks').update(payload).eq('id', task.id)
      taskId = task.id
    } else {
      // Stamp ownership on create so the personal inbox / agenda can
      // tell whose task this is.
      const { data: auth } = await supabase.auth.getUser()
      const { data: inserted } = await supabase.from('tasks')
        .insert({ ...payload, created_by: auth.user?.id ?? null })
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
