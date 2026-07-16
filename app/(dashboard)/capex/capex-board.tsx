'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import type { CapexProject } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate, isOverdue, propertyColor, CAPEX_STATUS_DOT } from '@/lib/utils'
import { CAPEX_PRIORITY_OPTIONS } from '@/components/ui/inline-edit'
import { CalendarDays } from 'lucide-react'

export type CapexWithProp = CapexProject & { properties?: { name: string } | null }
export type CapexStatus = CapexProject['status']

// Shared "% Used" bar logic — same numbers the list table shows.
export function budgetUsage(p: CapexProject): { pct: number; over: boolean } {
  const pct = p.budget && p.budget > 0
    ? Math.min(Math.round((p.actual_spend ?? 0) / p.budget * 100), 100)
    : 0
  const over = (p.actual_spend ?? 0) > (p.budget ?? Infinity)
  return { pct, over }
}

const COLUMNS: { status: CapexStatus; label: string }[] = [
  { status: 'planning',    label: 'Planning' },
  { status: 'approved',    label: 'Approved' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'on_hold',     label: 'On Hold' },
  { status: 'complete',    label: 'Complete' },
]

// ── Board ────────────────────────────────────────────────────
// 5 status columns. Dragging a card to another column persists the
// status change (optimistically, via onMove). Ordering within a
// column is display-only — there is no sort column to persist.

export function CapexBoard({ projects, onMove }: {
  projects: CapexWithProp[]
  onMove: (id: string, status: CapexStatus) => void
}) {
  const router = useRouter()
  const [activeId, setActiveId] = useState<string | null>(null)
  // A click event still fires after a drag's pointerup — swallow exactly
  // that one so dropping a card doesn't also navigate to its detail page.
  const suppressClick = useRef(false)

  const sensors = useSensors(
    // Small distance so plain taps/clicks still open the card.
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // Long-press on touch, so vertical/horizontal scrolling stays natural.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    suppressClick.current = true
    setTimeout(() => { suppressClick.current = false }, 0)
    if (e.over) onMove(String(e.active.id), e.over.id as CapexStatus)
  }

  const activeProject = activeId ? projects.find(p => p.id === activeId) : null

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart}
      onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="flex gap-3 overflow-x-auto pb-2 xl:grid xl:grid-cols-5 xl:overflow-visible">
        {COLUMNS.map(col => (
          <BoardColumn key={col.status} status={col.status} label={col.label}
            projects={projects.filter(p => p.status === col.status)}
            onOpen={id => { if (!suppressClick.current) router.push(`/capex/${id}`) }} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
        {activeProject ? <BoardCard project={activeProject} className="shadow-lg rotate-2" /> : null}
      </DragOverlay>
    </DndContext>
  )
}

// ── Column ───────────────────────────────────────────────────

function BoardColumn({ status, label, projects, onOpen }: {
  status: CapexStatus
  label: string
  projects: CapexWithProp[]
  onOpen: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const budget = projects.reduce((s, p) => s + (p.budget ?? 0), 0)

  return (
    <div ref={setNodeRef}
      className={cn(
        'w-64 flex-shrink-0 xl:w-auto rounded-xl border p-2 flex flex-col gap-2 transition-colors',
        isOver ? 'border-blue-300 bg-blue-50/60' : 'border-slate-100 bg-slate-50',
      )}>
      <div className="flex items-center gap-1.5 px-1.5 pt-1">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CAPEX_STATUS_DOT[status] }} />
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <span className="text-xs text-slate-400">{projects.length}</span>
        {budget > 0 && <span className="ml-auto text-xs text-slate-400">{formatCurrency(budget, true)}</span>}
      </div>
      <div className="space-y-2 flex-1 min-h-[48px]">
        {projects.map(p => (
          <DraggableCard key={p.id} project={p} onOpen={() => onOpen(p.id)} />
        ))}
      </div>
    </div>
  )
}

// ── Cards ────────────────────────────────────────────────────

function DraggableCard({ project, onOpen }: {
  project: CapexWithProp
  onOpen: () => void
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: project.id })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} onClick={onOpen}
      className={cn(
        'cursor-grab active:cursor-grabbing touch-manipulation select-none',
        isDragging && 'opacity-40',
      )}>
      <BoardCard project={project} className="hover:shadow-md transition-shadow" />
    </div>
  )
}

function BoardCard({ project: p, className }: { project: CapexWithProp; className?: string }) {
  const { pct, over } = budgetUsage(p)
  const overdue = !!p.target_completion && isOverdue(p.target_completion) && p.status !== 'complete'
  const pip = CAPEX_PRIORITY_OPTIONS.find(o => o.value === p.priority)?.dot

  return (
    <div className={cn('card p-3 space-y-2', className)}>
      <div className="flex items-start gap-1.5">
        <span className="text-sm font-medium text-slate-900 leading-snug flex-1">{p.title}</span>
        {pip && (
          <span title={`${p.priority} priority`}
            className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
            style={{ background: pip }} />
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: propertyColor(p.properties?.name) }} />
        <span className="truncate">{p.properties?.name ?? '—'}</span>
      </div>
      {(p.budget != null || p.actual_spend != null) && (
        <div>
          <div className="flex items-center justify-between gap-2 text-xs mb-1">
            <span className="text-slate-500">
              {formatCurrency(p.actual_spend ?? 0, true)}
              <span className="text-slate-300"> / </span>
              {formatCurrency(p.budget, true)}
            </span>
            {p.budget != null && p.budget > 0 && (
              <span className={over ? 'text-red-500' : 'text-slate-400'}>{pct}%</span>
            )}
          </div>
          <div className="bg-slate-100 rounded-full h-1">
            <div className={cn('h-1 rounded-full', over ? 'bg-red-400' : 'bg-orange-400')}
              style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {p.target_completion && (
        <div className={cn('text-xs flex items-center gap-1', overdue ? 'text-red-600 font-medium' : 'text-slate-400')}>
          <CalendarDays size={11} className="flex-shrink-0" />
          {formatDate(p.target_completion)}{overdue && ' · overdue'}
        </div>
      )}
    </div>
  )
}
