'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Task, Contact, Property, CapexProject } from '@/lib/supabase/types'
import {
  cn, formatDateShort, isOverdue, isSoon,
  PRIORITY_DOT, STATUS_STYLES, STATUS_LABELS,
  PRIORITY_STYLES, RECUR_LABELS, propertyColor,
} from '@/lib/utils'
import {
  Plus, Filter, X, ChevronDown, Users, RefreshCw,
  Link as LinkIcon, AlertTriangle, Clock,
} from 'lucide-react'

type TaskWithRelations = Task & {
  properties?: { name: string } | null
  capex_projects?: { title: string } | null
  contacts?: Contact[]
}

type StatusFilter = 'inbox' | 'next_action' | 'waiting' | 'blocked' | 'done'

const STATUS_ORDER: StatusFilter[] = ['inbox', 'next_action', 'waiting', 'blocked', 'done']
const SECTION_LABELS: Record<StatusFilter, string> = {
  inbox:       'Inbox — to process',
  next_action: 'Next actions',
  waiting:     'Waiting for',
  blocked:     'Blocked',
  done:        'Completed',
}

export default function TasksPage() {
  const supabase = createClient()
  const searchParams = useSearchParams()

  const [tasks, setTasks] = useState<TaskWithRelations[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [capexProjects, setCapexProjects] = useState<CapexProject[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTask, setEditTask] = useState<TaskWithRelations | null>(null)

  // Filters
  const [activeStatuses, setActiveStatuses] = useState<Set<StatusFilter>>(
    new Set<StatusFilter>(['inbox', 'next_action', 'waiting', 'blocked'])
  )
  const [filterProp, setFilterProp] = useState(searchParams.get('property') ?? '')
  const [filterCapex, setFilterCapex] = useState(searchParams.get('capex') ?? '')
  const [filterContact, setFilterContact] = useState('')
  const [filterPriority, setFilterPriority] = useState('')

  // View mode: tasks or agenda
  const [view, setView] = useState<'tasks' | 'agenda'>('tasks')
  const [agendaPerson, setAgendaPerson] = useState<string | null>(null)

  // Collapsed sections
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['done']))

  const fetchTasks = useCallback(async () => {
    let q = supabase
      .from('tasks')
      .select(`
        *,
        properties(name),
        capex_projects(title),
        task_contacts(contact_id, contacts(*))
      `)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (filterProp) q = q.eq('property_id', filterProp)
    if (filterCapex) q = q.eq('capex_project_id', filterCapex)

    const { data } = await q

    // Flatten contacts from junction table
    const withContacts = (data ?? []).map((t: any) => ({
      ...t,
      contacts: (t.task_contacts ?? []).map((tc: any) => tc.contacts).filter(Boolean),
    }))

    let filtered = withContacts as TaskWithRelations[]
    if (filterContact) {
      filtered = filtered.filter(t =>
        (t.contacts ?? []).some((c: Contact) => c.id === filterContact)
      )
    }

    setTasks(filtered)
    setLoading(false)
  }, [filterProp, filterCapex, filterContact])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  useEffect(() => {
    supabase.from('properties').select('*').eq('status', 'active').order('name')
      .then(({ data }) => setProperties(data ?? []))
    supabase.from('contacts').select('*').order('full_name')
      .then(({ data }) => setContacts(data ?? []))
    supabase.from('capex_projects').select('id, title, property_id')
      .in('status', ['planning', 'approved', 'in_progress'])
      .order('title')
      .then(({ data }) => setCapexProjects((data as CapexProject[]) ?? []))
  }, [])

  // Filter + group
  const visibleTasks = tasks.filter(t => {
    if (!activeStatuses.has(t.status as StatusFilter)) return false
    if (filterPriority && t.priority !== filterPriority) return false
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

  async function markDone(task: TaskWithRelations) {
    const newStatus = task.status === 'done' ? 'next_action' : 'done'
    await (supabase.from('tasks') as any).update({
      status: newStatus,
      completed_at: newStatus === 'done' ? new Date().toISOString() : null,
    }).eq('id', task.id)
    fetchTasks()
  }

  async function deleteTask(id: string) {
    if (!confirm('Delete this task?')) return
    await supabase.from('tasks').delete().eq('id', id)
    fetchTasks()
  }

  const selectedCapex = filterCapex ? capexProjects.find(c => c.id === filterCapex) : null
  const hasActiveFilter = filterProp || filterCapex || filterContact || filterPriority

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 bg-white flex-shrink-0">
        <h1 className="text-lg font-semibold text-slate-900 flex-1">Tasks</h1>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          <button onClick={() => setView('tasks')}
            className={cn('px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'tasks' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
            All Tasks
          </button>
          <button onClick={() => setView('agenda')}
            className={cn('px-3 py-1.5 text-xs font-medium transition-colors border-l border-slate-200',
              view === 'agenda' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
            <Users size={12} className="inline mr-1" />Agenda
          </button>
        </div>
        <button onClick={() => { setEditTask(null); setShowForm(true) }} className="btn-primary text-xs py-1.5">
          <Plus size={13} />Add task
        </button>
      </div>

      {/* Filter bar */}
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

        <select value={filterProp} onChange={e => setFilterProp(e.target.value)}
          className={cn('input-sm w-auto', filterProp && 'border-blue-400 bg-blue-50 text-blue-700')}>
          <option value="">All properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select value={filterCapex} onChange={e => setFilterCapex(e.target.value)}
          className={cn('input-sm w-auto max-w-[160px]', filterCapex && 'border-orange-400 bg-orange-50 text-orange-700')}>
          <option value="">All CapEx projects</option>
          {capexProjects.map(c => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>

        <select value={filterContact} onChange={e => setFilterContact(e.target.value)}
          className={cn('input-sm w-auto', filterContact && 'border-purple-400 bg-purple-50 text-purple-700')}>
          <option value="">All people</option>
          {contacts.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select>

        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
          className={cn('input-sm w-auto', filterPriority && 'border-red-400 bg-red-50 text-red-700')}>
          <option value="">All priorities</option>
          {['urgent', 'high', 'medium', 'low'].map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

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

      {/* CapEx context banner */}
      {selectedCapex && (
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
          <AgendaView
            tasks={tasks}
            contacts={contacts}
            agendaPerson={agendaPerson}
            setAgendaPerson={setAgendaPerson}
            onMarkDone={markDone}
          />
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
                        <TaskRow
                          key={task.id}
                          task={task}
                          contacts={contacts}
                          onEdit={() => { setEditTask(task); setShowForm(true) }}
                          onDone={() => markDone(task)}
                          onDelete={() => deleteTask(task.id)}
                        />
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

function TaskRow({ task, contacts, onEdit, onDone, onDelete }: {
  task: TaskWithRelations
  contacts: Contact[]
  onEdit: () => void
  onDone: () => void
  onDelete: () => void
}) {
  const isDone = task.status === 'done'
  const overdue = !isDone && isOverdue(task.due_date)
  const soon = !isDone && !overdue && isSoon(task.due_date, 7)
  const taskContacts = task.contacts ?? []
  const blockerTitle = task.blocked_by_task_id ? '(blocked)' : ''
  const pc = task.properties?.name ? propertyColor(task.properties.name) : '#64748b'

  return (
    <div className={cn(
      'flex items-center px-6 py-0 min-h-[38px] border-b border-slate-100 group hover:bg-slate-50 transition-colors',
      isDone && 'opacity-60'
    )}>
      {/* Priority pip */}
      <div className="w-1 self-stretch mr-3 flex-shrink-0 rounded-sm"
        style={{ background: isDone ? 'transparent' : PRIORITY_DOT[task.priority] }} />

      {/* Checkbox */}
      <button onClick={onDone}
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

      {/* Title */}
      <div className="flex-1 min-w-0 py-2.5 cursor-pointer" onClick={onEdit}>
        <div className={cn('text-sm text-slate-900 truncate', isDone && 'line-through text-slate-400')}>
          {task.title}
          {task.recur_freq && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-1.5 py-0.5">
              <RefreshCw size={9} />{RECUR_LABELS[task.recur_freq]}
            </span>
          )}
          {task.auto_source === 'expiration' && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
              <Clock size={9} />Auto
            </span>
          )}
        </div>
        {(task.properties?.name || task.capex_projects?.title) && (
          <div className="flex items-center gap-2 mt-0.5">
            {task.properties?.name && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded"
                style={{ background: `${pc}18`, color: pc }}>
                {task.properties.name}
              </span>
            )}
            {task.capex_projects?.title && (
              <span className="text-xs text-orange-600 flex items-center gap-1">
                <LinkIcon size={9} />{task.capex_projects.title.slice(0, 24)}…
              </span>
            )}
            {task.blocked_by_task_id && (
              <span className="text-xs text-amber-600 flex items-center gap-1">
                ⛓ blocked
              </span>
            )}
          </div>
        )}
      </div>

      {/* Status badge */}
      <div className="w-24 hidden md:flex justify-center">
        <span className={cn('badge text-xs', STATUS_STYLES[task.status])}>
          {STATUS_LABELS[task.status]}
        </span>
      </div>

      {/* People avatars */}
      <div className="w-28 hidden lg:flex justify-center items-center gap-1">
        {taskContacts.slice(0, 4).map((c: Contact) => (
          <span key={c.id} title={c.full_name}
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
            style={{ background: c.color_hex ?? '#64748b' }}>
            {c.initials ?? c.full_name.slice(0, 2).toUpperCase()}
          </span>
        ))}
        {taskContacts.length > 4 && (
          <span className="text-xs text-slate-400">+{taskContacts.length - 4}</span>
        )}
      </div>

      {/* Due date */}
      <div className={cn('w-20 text-right text-xs flex-shrink-0',
        overdue ? 'text-red-600 font-semibold' : soon ? 'text-amber-600 font-medium' : 'text-slate-400')}>
        {overdue && <AlertTriangle size={10} className="inline mr-1" />}
        {task.due_date ? formatDateShort(task.due_date) : '—'}
      </div>

      {/* Delete */}
      <div className="w-6 flex justify-center ml-1">
        <button onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all">
          <X size={13} />
        </button>
      </div>
    </div>
  )
}

// ── Agenda View ──────────────────────────────────────────────

function AgendaView({ tasks, contacts, agendaPerson, setAgendaPerson, onMarkDone }: {
  tasks: TaskWithRelations[]
  contacts: Contact[]
  agendaPerson: string | null
  setAgendaPerson: (id: string | null) => void
  onMarkDone: (task: TaskWithRelations) => void
}) {
  const activeTasks = tasks.filter(t => t.status !== 'done')

  const contactsWithTasks = contacts.filter(c =>
    activeTasks.some(t => (t.contacts ?? []).some((tc: Contact) => tc.id === c.id))
  )

  function copyAgenda(contactId: string) {
    const c = contacts.find(x => x.id === contactId)
    if (!c) return
    const ctasks = activeTasks.filter(t =>
      (t.contacts ?? []).some((tc: Contact) => tc.id === contactId)
    )
    const text = `Agenda — ${c.full_name}\n${new Date().toLocaleDateString()}\n\n` +
      ctasks.map((t, i) =>
        `${i + 1}. ${t.title}\n   ${t.properties?.name ?? 'Portfolio'} · ${STATUS_LABELS[t.status]}${t.due_date ? ' · Due ' + formatDateShort(t.due_date) : ''}`
      ).join('\n\n')
    navigator.clipboard?.writeText(text)
  }

  const displayContacts = agendaPerson
    ? contacts.filter(c => c.id === agendaPerson)
    : contactsWithTasks

  return (
    <div>
      {/* Person chips */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-200 bg-white flex-wrap">
        <button onClick={() => setAgendaPerson(null)}
          className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
            !agendaPerson ? 'bg-slate-800 text-white border-slate-800' : 'text-slate-600 border-slate-200 hover:border-slate-300')}>
          All people
        </button>
        {contactsWithTasks.map(c => {
          const cnt = activeTasks.filter(t => (t.contacts ?? []).some((tc: Contact) => tc.id === c.id)).length
          const isActive = agendaPerson === c.id
          return (
            <button key={c.id} onClick={() => setAgendaPerson(isActive ? null : c.id)}
              className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                isActive ? 'text-white border-transparent' : 'text-slate-600 border-slate-200 hover:border-slate-300')}
              style={isActive ? { background: c.color_hex ?? '#64748b', borderColor: c.color_hex ?? '#64748b' } : {}}>
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-bold"
                style={{ background: c.color_hex ?? '#64748b', fontSize: 9 }}>
                {c.initials ?? c.full_name.slice(0, 2)}
              </span>
              {c.full_name.split(' ')[0]}
              <span className="opacity-70">({cnt})</span>
            </button>
          )
        })}
      </div>

      {/* Contact sections */}
      {displayContacts.map(c => {
        const ctasks = activeTasks.filter(t =>
          (t.contacts ?? []).some((tc: Contact) => tc.id === c.id)
        )
        if (!ctasks.length) return null
        return (
          <div key={c.id} className="border-b border-slate-200">
            <div className="flex items-center gap-3 px-6 py-3 bg-slate-50 border-b border-slate-200">
              <span className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ background: c.color_hex ?? '#64748b' }}>
                {c.initials ?? c.full_name.slice(0, 2)}
              </span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900">{c.full_name}</div>
                <div className="text-xs text-slate-500">{c.role} · {ctasks.length} open item{ctasks.length !== 1 ? 's' : ''}</div>
              </div>
              <button onClick={() => copyAgenda(c.id)}
                className="text-xs text-slate-500 hover:text-blue-600 border border-slate-200 hover:border-blue-300 px-3 py-1.5 rounded-lg transition-colors">
                Copy agenda
              </button>
            </div>
            {ctasks.map(t => {
              const isDone = t.status === 'done'
              const pc = t.properties?.name ? propertyColor(t.properties.name) : '#64748b'
              return (
                <div key={t.id} className="flex items-start gap-3 px-6 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <button onClick={() => onMarkDone(t)}
                    className={cn('w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all',
                      isDone ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 hover:border-blue-400')}>
                    {isDone && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3l2.5 2.5L7 1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={cn('text-sm text-slate-900', isDone && 'line-through text-slate-400')}>
                      {t.title}
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {t.properties?.name && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded"
                          style={{ background: `${pc}18`, color: pc }}>
                          {t.properties.name}
                        </span>
                      )}
                      <span className={cn('badge text-xs', STATUS_STYLES[t.status])}>
                        {STATUS_LABELS[t.status]}
                      </span>
                      {t.due_date && (
                        <span className={cn('text-xs', isOverdue(t.due_date) ? 'text-red-600 font-medium' : 'text-slate-400')}>
                          {isOverdue(t.due_date) ? 'Overdue · ' : ''}{formatDateShort(t.due_date)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      {displayContacts.length === 0 && (
        <div className="py-16 text-center text-sm text-slate-400">
          No people tagged on open tasks
        </div>
      )}
    </div>
  )
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

    const payload: any = {
      title:              form.title,
      description:        form.description || null,
      property_id:        form.property_id || null,
      capex_project_id:   form.capex_project_id || null,
      status:             form.status,
      priority:           form.priority,
      due_date:           form.due_date || null,
      snoozed_until:      form.snoozed_until || null,
      blocked_by_task_id: form.blocked_by_task_id || null,
      tags:               form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      recur_freq:         form.recur_freq || null,
      recur_interval:     form.recur_freq === 'custom' ? parseInt(form.recur_interval) || null : null,
      recur_unit:         form.recur_freq === 'custom' ? form.recur_unit : null,
      recur_end_type:     form.recur_freq ? form.recur_end_type : null,
      recur_end_date:     form.recur_end_type === 'on' ? form.recur_end_date || null : null,
      recur_end_count:    form.recur_end_type === 'after' ? parseInt(form.recur_end_count) || null : null,
    }

    let taskId: string
    if (task) {
      await (supabase.from('tasks') as any).update(payload).eq('id', task.id)
      taskId = task.id
    } else {
      const { data } = await (supabase.from('tasks') as any).insert(payload).select('id').single()
      taskId = (data as any)?.id
    }

    // Sync contacts
    if (taskId) {
      await (supabase.from('task_contacts') as any).delete().eq('task_id', taskId)
      if (selectedContacts.length > 0) {
        await (supabase.from('task_contacts') as any).insert(
          selectedContacts.map(cid => ({ task_id: taskId, contact_id: cid }))
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-slate-900">{task ? 'Edit Task' : 'New Task'}</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-700" /></button>
        </div>

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
            <p className="text-xs text-slate-400 mt-1">Task will hide from all views until this date</p>
          </div>

          {/* Tags */}
          <div>
            <label className="label">Tags</label>
            <input value={form.tags}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              className="input" placeholder="vendor, follow-up, urgent (comma separated)" />
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
      </div>
    </div>
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
