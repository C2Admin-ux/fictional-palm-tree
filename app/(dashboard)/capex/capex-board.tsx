'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import type { CapexProject } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate, isOverdue, propertyColor, CAPEX_STATUS_DOT, CAPEX_STATUS_STYLES, CAPEX_STATUS_LABELS } from '@/lib/utils'
import { type BidLike } from '@/lib/capex/bids'
import { BidChip } from '@/components/capex/bid-chip'
import { CAPEX_PRIORITY_OPTIONS, CAPEX_STATUS_OPTIONS } from '@/components/ui/inline-edit'
import { CalendarDays, ChevronRight } from 'lucide-react'

// capex_bids is the lean embed from the list page fetch — only what
// bidGlance needs. Optional so detail-page shapes still fit.
export type CapexWithProp = CapexProject & {
  properties?: { name: string } | null
  capex_bids?: BidLike[] | null
}

export type CapexStatus = CapexProject['status']

// Shared "% Used" bar logic — same numbers the list table shows.
// pct is the TRUE percentage (can exceed 100) — clamp only the bar
// width at render. Spend with no budget to burn also counts as over.
export function budgetUsage(p: CapexProject): { pct: number; over: boolean } {
  const spend = p.actual_spend ?? 0
  const pct = p.budget && p.budget > 0 ? Math.round(spend / p.budget * 100) : 0
  const over = spend > 0 && (p.budget == null || spend > p.budget)
  return { pct, over }
}

// Labels come from CAPEX_STATUS_OPTIONS — the same source the list's
// inline status select uses — so the board can't drift from it. Only the
// column ORDER is a board-layout concern. Nick's pipeline (2026-08-23):
// Proposed → Vendor Selection → In Progress, On Hold parked last.
// Complete is deliberately NOT a column — finished projects live in the
// table (status filter), not on the board; mark complete from the
// table's status select or the detail page.
const COLUMN_ORDER: CapexStatus[] = ['planning', 'approved', 'in_progress', 'on_hold']
const COLUMNS: { status: CapexStatus; label: string }[] = COLUMN_ORDER.map(status => ({
  status,
  label: CAPEX_STATUS_OPTIONS.find(o => o.value === status)?.label ?? status,
}))

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
  // that one (consume-once in onOpen) so dropping a card doesn't also
  // navigate to its detail page. Some touch browsers never deliver that
  // click, so a short fallback timer clears the flag if nothing consumed it.
  const suppressClick = useRef(false)
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (suppressTimer.current) clearTimeout(suppressTimer.current) }, [])

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
    if (suppressTimer.current) clearTimeout(suppressTimer.current)
    suppressTimer.current = setTimeout(() => { suppressClick.current = false }, 400)
    if (e.over) onMove(String(e.active.id), e.over.id as CapexStatus)
  }

  const activeProject = activeId ? projects.find(p => p.id === activeId) : null

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart}
      onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="flex gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible">
        {COLUMNS.map(col => (
          <BoardColumn key={col.status} status={col.status} label={col.label}
            projects={projects.filter(p => p.status === col.status)}
            onOpen={id => {
              if (suppressClick.current) { suppressClick.current = false; return }
              router.push(`/capex/${id}`)
            }} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
        {activeProject ? <ProjectCard project={activeProject} compact className="shadow-lg rotate-2" /> : null}
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
      {/* Columns grow to fit every card — Nick wants the whole board
          visible with only the page scrolling, no inner scrollbars
          (2026-08-25, reversing the earlier fixed-height strip). */}
      <div className="space-y-2 flex-1 min-h-[48px]">
        {projects.map(p => (
          <DraggableCard key={p.id} project={p} onOpen={() => onOpen(p.id)} />
        ))}
        {projects.length === 0 && (
          <p className="text-xs text-slate-300 italic px-1.5 py-2">Drop projects here</p>
        )}
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
      <ProjectCard project={project} compact className="hover:shadow-md transition-shadow" />
    </div>
  )
}

// Shared between the board columns/drag overlay and the list's mobile
// cards — one place for the title row, property dot, budget bar and
// overdue-date logic (incl. the status !== 'complete' guard).
export function ProjectCard({ project: p, showStatus = false, showChevron = false, compact = false, className }: {
  project: CapexWithProp
  showStatus?: boolean   // list context: column doesn't imply the status
  showChevron?: boolean  // list context: card is a link to the detail page
  compact?: boolean      // board context: no budget/spend block — Nick wants glanceable tiles
  className?: string
}) {
  const { pct, over } = budgetUsage(p)
  const overdue = !!p.target_completion && isOverdue(p.target_completion) && p.status !== 'complete'
  const pip = CAPEX_PRIORITY_OPTIONS.find(o => o.value === p.priority)?.dot

  return (
    <div className={cn('card p-3 space-y-2', className)}>
      <div className="flex items-start gap-1.5">
        <span className="text-sm font-medium text-slate-900 leading-snug flex-1">{p.title}</span>
        {showStatus ? (
          <span className={cn('badge flex-shrink-0', CAPEX_STATUS_STYLES[p.status])}>
            {CAPEX_STATUS_LABELS[p.status]}
          </span>
        ) : pip ? (
          <span title={`${p.priority} priority`}
            className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
            style={{ background: pip }} />
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: propertyColor(p.properties?.name) }} />
        <span className="truncate">{p.properties?.name ?? '—'}</span>
        {showChevron && <ChevronRight size={14} className="text-slate-300 ml-auto flex-shrink-0" />}
      </div>
      <BidChip bids={p.capex_bids} target={p.bids_target} />
      {!compact && (p.budget != null || p.actual_spend != null) && (
        <div>
          <div className="flex items-center justify-between gap-2 text-xs mb-1">
            <span className="text-slate-500">
              {formatCurrency(p.actual_spend ?? 0, true)}
              <span className="text-slate-300"> / </span>
              {formatCurrency(p.budget, true)}
            </span>
            {p.budget != null && p.budget > 0 ? (
              <span className={over ? 'text-red-500 font-medium' : 'text-slate-400'}>{pct}%</span>
            ) : over ? (
              <span className="text-red-500 font-medium">over — no budget</span>
            ) : null}
          </div>
          <div className="bg-slate-100 rounded-full h-1">
            <div className={cn('h-1 rounded-full', over ? 'bg-red-400' : 'bg-orange-400')}
              style={{ width: `${Math.min(pct, 100)}%` }} />
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
