'use client'

// Project Board + Timeline views. The List view is the shared scoped
// task list (components/tasks/scoped-task-list.tsx); these two views
// load the same project's top-level tasks and share one mutation path
// (lib/tasks/mutations) — so dragging a card to Done runs the real
// completion (recurrence spawn, completed_at, undo toast).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { createClient } from '@/lib/supabase/client'
import type { Contact, Project, Property, CapexProject, Task } from '@/lib/supabase/types'
import { cn, formatDateShort, todayISO, addDaysToDate, propertyColor, STATUS_LABELS } from '@/lib/utils'
import type { TaskWithRelations } from '@/components/tasks/task-row'
import { TaskFormModal } from '@/components/tasks/task-form-modal'
import { insertTask } from '@/lib/tasks/create'
import { topLevel, openSubtasksOf } from '@/lib/tasks/subtasks'
import { type TaskStore, patchTaskOptimistic, toggleDoneOptimistic } from '@/lib/tasks/mutations'
import { toast } from '@/components/ui/toast'
import { CalendarDays, Plus } from 'lucide-react'

type RawRow = Task & {
  properties: { name: string } | null
  capex_projects: { title: string } | null
  projects: { title: string } | null
  task_contacts: { contact_id: string; contacts: Contact | null }[] | null
}
const ROW_SELECT = '*, properties(name), capex_projects(title), projects(title), task_contacts(contact_id, contacts(*))'

// ── Shared data hook ─────────────────────────────────────────

function useProjectTasks(projectId: string) {
  const supabase = useMemo(() => createClient(), [])
  const [tasks, setTasks] = useState<TaskWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [names, setNames] = useState<Map<string, string>>(new Map())

  const fetchTasks = useCallback(async () => {
    const doneCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const [{ data: open }, { data: done }, { data: profiles }, { data: auth }] = await Promise.all([
      supabase.from('tasks').select(ROW_SELECT).eq('project_id', projectId).neq('status', 'done'),
      supabase.from('tasks').select(ROW_SELECT).eq('project_id', projectId).eq('status', 'done')
        .gte('completed_at', doneCutoff),
      supabase.from('user_profiles').select('id, full_name'),
      supabase.auth.getUser(),
    ])
    const me = auth.user?.id ?? null
    const nameById = new Map((profiles ?? []).map(p => [p.id, p.full_name ?? 'Teammate']))
    const rows = [...(open ?? []), ...(done ?? [])] as unknown as RawRow[]
    setUserId(me)
    setNames(nameById)
    setTasks(rows.map(({ task_contacts, ...t }) => ({
      ...t,
      assignee_name: t.assigned_to && t.assigned_to !== me ? (nameById.get(t.assigned_to) ?? 'Teammate') : null,
      contacts: (task_contacts ?? []).map(tc => tc.contacts).filter((c): c is Contact => Boolean(c)),
    })))
    setLoading(false)
  }, [supabase, projectId])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const store: TaskStore = useMemo(() => ({
    update: (id, fields) => setTasks(prev => prev.map(t => t.id === id ? { ...t, ...fields } : t)),
    // Recurrence spawns land here too — keep them only if they belong.
    insert: task => setTasks(prev => prev.some(t => t.id === task.id) || task.project_id !== projectId ? prev
      : [...prev, { ...task, properties: null, capex_projects: null, projects: null, contacts: [] } as TaskWithRelations]),
    remove: id => setTasks(prev => prev.filter(t => t.id !== id)),
  }), [projectId])

  const tasksRef = useRef(tasks); tasksRef.current = tasks

  const setStatus = useCallback((task: TaskWithRelations, status: Task['status']) => {
    if (task.status === status) return
    if (status === 'done' || task.status === 'done') {
      // Crossing done is not a plain field write — shared completion path.
      void toggleDoneOptimistic(supabase, store, task, { openSubtasks: openSubtasksOf(tasksRef.current, task.id) })
      return
    }
    void patchTaskOptimistic(supabase, store, task, { status })
  }, [supabase, store])

  // Modal plumbing (edit + new-with-status)
  const [modal, setModal] = useState<{ task: TaskWithRelations | null } | null>(null)
  const [modalData, setModalData] = useState<{
    properties: Property[]; contacts: Contact[]; capexProjects: CapexProject[]
  } | null>(null)
  const openModal = useCallback((task: TaskWithRelations | null) => {
    setModal({ task })
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
  }, [supabase, modalData])

  const modalEl = modal && modalData ? (
    <TaskFormModal
      task={modal.task}
      properties={modalData.properties}
      contacts={modalData.contacts}
      capexProjects={modalData.capexProjects}
      allTasks={tasks}
      defaults={{ project_id: projectId }}
      onComplete={t => setStatus(t, 'done')}
      onClose={() => setModal(null)}
      onSave={() => { setModal(null); fetchTasks() }}
    />
  ) : null

  return { supabase, tasks, loading, userId, names, store, setStatus, openModal, modalEl }
}

// ── Board ────────────────────────────────────────────────────

const COLUMNS: { status: Task['status']; hint: string }[] = [
  { status: 'inbox',       hint: 'Not triaged' },
  { status: 'next_action', hint: 'Ready to work' },
  { status: 'waiting',     hint: 'On someone else' },
  { status: 'blocked',     hint: 'Stuck' },
  { status: 'done',        hint: 'Last 30 days' },
]

export function ProjectBoard({ project }: { project: Project }) {
  const { supabase, tasks, loading, userId, store, setStatus, openModal, modalEl } = useProjectTasks(project.id)
  const [activeId, setActiveId] = useState<string | null>(null)
  const suppressClick = useRef(false)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )

  const tops = useMemo(() => topLevel(tasks), [tasks])

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)) }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    suppressClick.current = true
    setTimeout(() => { suppressClick.current = false }, 400)
    if (!e.over) return
    const task = tops.find(t => t.id === e.active.id)
    if (task) setStatus(task, e.over.id as Task['status'])
  }

  async function addCard(status: Task['status'], title: string) {
    if (!userId) return
    const created = await insertTask(supabase, {
      title, status, project_id: project.id, property_id: project.property_id,
      created_by: userId, assigned_to: userId, priority: 'medium',
    })
    if (created) store.insert(created)
    else toast('Could not add task', { tone: 'error' })
  }

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>
  const active = activeId ? tops.find(t => t.id === activeId) : null

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart}
        onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="flex gap-3 overflow-x-auto pb-2 xl:grid xl:grid-cols-5 xl:overflow-visible">
          {COLUMNS.map(col => (
            <Column key={col.status} status={col.status} hint={col.hint}
              tasks={tops.filter(t => t.status === col.status)
                .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))}
              onOpen={t => { if (!suppressClick.current) openModal(t) }}
              onAdd={title => addCard(col.status, title)} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
          {active ? <Card task={active} className="shadow-lg rotate-1" /> : null}
        </DragOverlay>
      </DndContext>
      {modalEl}
    </>
  )
}

function Column({ status, hint, tasks, onOpen, onAdd }: {
  status: Task['status']
  hint: string
  tasks: TaskWithRelations[]
  onOpen: (t: TaskWithRelations) => void
  onAdd: (title: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  return (
    <div ref={setNodeRef}
      className={cn('w-64 flex-shrink-0 xl:w-auto rounded-xl border p-2 flex flex-col gap-2 transition-colors',
        isOver ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 bg-white')}>
      <div className="flex items-center gap-1.5 px-1.5 pt-1">
        <span className="text-xs font-semibold text-slate-700">{STATUS_LABELS[status] ?? status}</span>
        <span className="text-xs text-slate-400">{tasks.length}</span>
        <span className="ml-auto text-[11px] text-slate-400">{hint}</span>
      </div>
      <div className="space-y-2 flex-1 min-h-[48px]">
        {tasks.map(t => <DraggableCard key={t.id} task={t} onOpen={() => onOpen(t)} />)}
        {tasks.length === 0 && !adding && (
          <p className="text-xs text-slate-300 italic px-1.5 py-2">Drop tasks here</p>
        )}
      </div>
      {status !== 'done' && (adding ? (
        <form onSubmit={e => {
          e.preventDefault()
          if (draft.trim()) onAdd(draft.trim())
          setDraft('')
        }}>
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
            onBlur={() => { if (!draft.trim()) setAdding(false) }}
            onKeyDown={e => { if (e.key === 'Escape') { setDraft(''); setAdding(false) } }}
            className="input-sm" placeholder="Task title, Enter to add" />
        </form>
      ) : (
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-1.5 py-1 text-xs text-slate-400 hover:text-slate-700">
          <Plus size={12} />Add task
        </button>
      ))}
    </div>
  )
}

function DraggableCard({ task, onOpen }: { task: TaskWithRelations; onOpen: () => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: task.id })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} onClick={onOpen}
      className={cn('cursor-grab active:cursor-grabbing touch-manipulation select-none', isDragging && 'opacity-40')}>
      <Card task={task} className="hover:shadow-md transition-shadow" />
    </div>
  )
}

function Card({ task: t, className }: { task: TaskWithRelations; className?: string }) {
  const today = todayISO()
  const overdue = t.due_date != null && t.due_date < today && t.status !== 'done'
  const waitingOn = (t.contacts ?? []).map(c => c.full_name.split(' ')[0]).join(', ')
  return (
    <div className={cn('card p-2.5 space-y-1.5', className)}>
      <p className={cn('text-sm leading-snug', t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-900')}>
        {t.title}
      </p>
      <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
        {t.properties?.name && (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: propertyColor(t.properties.name) }} />
            {t.properties.name}
          </span>
        )}
        {t.due_date && (
          <span className={cn('flex items-center gap-1', overdue && 'text-red-600 font-medium')}>
            <CalendarDays size={11} />{formatDateShort(t.due_date)}
          </span>
        )}
        {t.status === 'waiting' && waitingOn && <span className="text-purple-600">on {waitingOn}</span>}
        {t.status === 'waiting' && t.follow_up_on && (
          <span className="text-purple-600">chase {formatDateShort(t.follow_up_on)}</span>
        )}
        <span className="ml-auto text-slate-500">{t.assignee_name ? `→ ${t.assignee_name.split(' ')[0]}` : ''}</span>
      </div>
    </div>
  )
}

// ── Timeline ─────────────────────────────────────────────────
// A light Gantt: one row per dated task, a thin bar from its start
// (start date / creation) to its due date, across a week grid spanning
// the project. Ink-light by design — outlines and hairlines, no fills
// beyond a pale tint. Undated tasks list below as unscheduled.

export function ProjectTimeline({ project }: { project: Project }) {
  const { tasks, loading, openModal, modalEl } = useProjectTasks(project.id)
  const today = todayISO()
  const tops = useMemo(() => topLevel(tasks), [tasks])
  const dated = tops.filter(t => t.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!))
  const undated = tops.filter(t => !t.due_date && t.status !== 'done')

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>

  const startOf = (t: Task) => {
    const s = t.snoozed_until ?? t.created_at.slice(0, 10)
    return s < t.due_date! ? s : t.due_date!
  }
  const candidates = [
    project.start_date, project.due_date, today,
    ...dated.map(startOf), ...dated.map(t => t.due_date!),
  ].filter((d): d is string => !!d).sort()
  // Snap the window to whole weeks (Mondays) with a little air.
  const rawStart = addDaysToDate(candidates[0], -3)
  const rawEnd = addDaysToDate(candidates[candidates.length - 1], 7)
  const dow = (new Date(rawStart + 'T00:00:00').getDay() + 6) % 7
  const start = addDaysToDate(rawStart, -dow)
  const days = Math.max(14, Math.round((Date.parse(rawEnd) - Date.parse(start)) / 86_400_000))
  const weeks = Math.ceil(days / 7)
  const pct = (d: string) => Math.min(100, Math.max(0,
    ((Date.parse(d) - Date.parse(start)) / 86_400_000) / (weeks * 7) * 100))

  return (
    <>
      <div className="card overflow-x-auto">
        <div className="min-w-[720px]">
          {/* Week header */}
          <div className="flex border-b border-slate-200 text-[11px] text-slate-400">
            <div className="w-64 flex-shrink-0 px-3 py-2">Task</div>
            <div className="flex-1 relative flex">
              {Array.from({ length: weeks }, (_, i) => (
                <div key={i} className="flex-1 px-1 py-2 border-l border-slate-100">
                  {formatDateShort(addDaysToDate(start, i * 7))}
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
          {dated.length === 0 && (
            <p className="px-3 py-4 text-sm text-slate-400">No dated tasks yet — give tasks due dates to see them here.</p>
          )}
          {dated.map(t => {
            const s = startOf(t)
            const overdue = t.due_date! < today && t.status !== 'done'
            return (
              <div key={t.id} className="flex border-b border-slate-100 hover:bg-slate-50">
                <button onClick={() => openModal(t)}
                  className={cn('w-64 flex-shrink-0 px-3 py-1.5 text-left text-sm truncate',
                    t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800')}>
                  {t.title}
                </button>
                <div className="flex-1 relative">
                  {/* week hairlines */}
                  {Array.from({ length: weeks }, (_, i) => (
                    <div key={i} className="absolute top-0 bottom-0 border-l border-slate-100"
                      style={{ left: `${(i / weeks) * 100}%` }} />
                  ))}
                  <div
                    className={cn('absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full border',
                      t.status === 'done' ? 'border-slate-300 bg-slate-50'
                        : overdue ? 'border-red-400 bg-red-50'
                        : t.status === 'waiting' ? 'border-purple-400 bg-purple-50'
                        : 'border-blue-400 bg-blue-50')}
                    style={{ left: `${pct(s)}%`, width: `max(6px, ${pct(t.due_date!) - pct(s)}%)` }}
                    title={`${formatDateShort(s)} → ${formatDateShort(t.due_date)}${t.assignee_name ? ` · ${t.assignee_name}` : ''}`} />
                </div>
              </div>
            )
          })}
          {/* Today + project target markers, drawn over the rows */}
          {dated.length > 0 && (
            <div className="absolute top-0 bottom-0 right-0 left-64 pointer-events-none">
              <Marker at={pct(today)} label="Today" className="border-red-400 text-red-500" />
              {project.due_date && <Marker at={pct(project.due_date)} label="Target" className="border-slate-500 text-slate-500" />}
            </div>
          )}
          </div>
        </div>
      </div>
      {undated.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Unscheduled ({undated.length})
          </p>
          <div className="card divide-y divide-slate-100">
            {undated.map(t => (
              <button key={t.id} onClick={() => openModal(t)}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {modalEl}
    </>
  )
}

function Marker({ at, label, className }: { at: number; label: string; className?: string }) {
  return (
    <div className={cn('absolute top-0 bottom-0 border-l border-dashed', className)} style={{ left: `${at}%` }}>
      <span className="absolute top-0 left-1 text-[10px] whitespace-nowrap bg-white/90 px-0.5">{label}</span>
    </div>
  )
}
