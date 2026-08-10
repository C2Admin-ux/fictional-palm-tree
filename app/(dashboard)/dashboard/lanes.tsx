'use client'

// DashboardLanes — the four-lane daily guide's client shell. Only the
// TODAY lane is interactive (real task completion + snooze with the
// same optimistic mutations as the tasks page); the Decisions / This
// Week / Portfolio Pulse lanes arrive fully server-rendered as nodes
// and pass straight through.
//
// The Today lane owns a live task list: the server's initial rows,
// kept fresh by the c2:task-created broadcast (a capture from the
// global sheet or palette lands here without a refetch, deduped by id)
// and by the optimistic store the mutations write through. Ranking
// re-runs from the SAME pure selectors the server used
// (lib/dashboard/signals.ts), so a completed row leaves the lane and a
// newly relevant one slots into rank order.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Task } from '@/lib/supabase/types'
import {
  buildTodaySignals, capSignals, selectTodayTasks, isOverdueSignal, signalAgeDays,
  type DashboardTask, type TaskSignal, type TodayLinkSignal,
  type TriageSignal, type DraftCallSignal, type StaleFlagSignal,
} from '@/lib/dashboard/signals'
import { openSubtasksOf } from '@/lib/tasks/subtasks'
import { TASK_CREATED_EVENT } from '@/lib/tasks/create'
import {
  type TaskStore, toggleDoneOptimistic, snoozeTaskOptimistic,
} from '@/lib/tasks/mutations'
import { CompleteCircle } from '@/components/tasks/row-cells'
import { SnoozeMenu } from '@/components/tasks/snooze-menu'
import { CollapseOnComplete, useExitingRows, type ExitPhase } from '@/components/tasks/complete-collapse'
import { cn, propertyColor, propertyAbbr, PRIORITY_DOT } from '@/lib/utils'
import { ClipboardCheck, Phone, Flag, ChevronRight, Sun } from 'lucide-react'

// Small shared chip — property context on any row type.
export function PropertyChip({ name, abbrBelow = 'md' }: { name: string; abbrBelow?: 'md' | 'never' }) {
  const pc = propertyColor(name)
  return (
    <>
      <span
        className={cn('flex-shrink-0 max-w-[13ch] truncate text-xs font-medium px-1.5 py-0.5 rounded',
          abbrBelow === 'md' && 'hidden md:inline-block')}
        style={{ background: `${pc}18`, color: pc }}>
        {name}
      </span>
      {abbrBelow === 'md' && (
        <span className="md:hidden flex-shrink-0 text-[10px] font-semibold px-1 py-0.5 rounded"
          style={{ background: `${pc}18`, color: pc }} title={name}>
          {propertyAbbr(name)}
        </span>
      )}
    </>
  )
}

const LINK_ICONS = {
  inspection_triage: ClipboardCheck,
  draft_call: Phone,
  stale_flags: Flag,
} as const

const LINK_ICON_TONES = {
  inspection_triage: 'text-emerald-500',
  draft_call: 'text-violet-500',
  stale_flags: 'text-red-500',
} as const

export function DashboardLanes({
  initialTasks, triage, draftCalls, staleFlags, userId, today, propertyNames,
  decisions, week, pulse,
}: {
  // ALL my open tasks (subtasks included — completing a parent must
  // sweep its children exactly like the tasks page does).
  initialTasks: DashboardTask[]
  triage: TriageSignal[] | null
  draftCalls: DraftCallSignal[] | null
  staleFlags: StaleFlagSignal[] | null
  userId: string | null
  today: string
  // property_id → name, for enriching broadcast-inserted bare rows
  propertyNames: Record<string, string>
  decisions: React.ReactNode
  week: React.ReactNode
  pulse: React.ReactNode
}) {
  const supabase = useMemo(() => createClient(), [])
  const [tasks, setTasks] = useState<DashboardTask[]>(initialTasks)
  const tasksRef = useRef(tasks); tasksRef.current = tasks

  const store: TaskStore = useMemo(() => ({
    update: (id, fields) => setTasks(prev => prev.map(t => t.id === id ? { ...t, ...fields } : t)),
    // Idempotent by id — inserts arrive from the broadcast AND from
    // recurrence spawns inside the completion mutation.
    insert: task => setTasks(prev => prev.some(t => t.id === task.id)
      ? prev
      : [...prev, {
          ...task,
          properties: (task as DashboardTask).properties
            ?? (task.property_id != null && propertyNames[task.property_id]
              ? { name: propertyNames[task.property_id] }
              : null),
        }]),
    remove: id => setTasks(prev => prev.filter(t => t.id !== id)),
  }), [propertyNames])

  // Tasks captured on other surfaces broadcast themselves — insert and
  // let the selector decide relevance (a task due today ranks in; an
  // undated capture simply doesn't select).
  useEffect(() => {
    function onTaskCreated(e: Event) {
      const task = (e as CustomEvent<Task>).detail
      if (task?.id) store.insert(task)
    }
    window.addEventListener(TASK_CREATED_EVENT, onTaskCreated)
    return () => window.removeEventListener(TASK_CREATED_EVENT, onTaskCreated)
  }, [store])

  // Presentation-only completion exit (same RTM feel as the tasks page):
  // the mutation fires immediately; the snapshot keeps the row in place
  // while the check pops and the row collapses out of the lane.
  const { begin: beginExit, cancel: cancelExit, overlay, phaseOf } = useExitingRows<DashboardTask>()
  const renderTasks = useMemo(() => overlay(tasks), [overlay, tasks])

  const completeTask = useCallback((task: DashboardTask) => {
    if (!beginExit(task)) return
    void toggleDoneOptimistic(supabase, store, task, {
      openSubtasks: openSubtasksOf(tasksRef.current, task.id),
      onRevert: () => cancelExit(task.id),
    })
  }, [supabase, store, beginExit, cancelExit])

  const snoozeTask = useCallback((task: DashboardTask, date: string) => {
    snoozeTaskOptimistic(supabase, store, task, date)
  }, [supabase, store])

  const signals = useMemo(() => buildTodaySignals({
    tasks: selectTodayTasks(renderTasks, userId, today),
    triage, draftCalls, staleFlags,
  }, today), [renderTasks, userId, today, triage, draftCalls, staleFlags])

  const { shown, more } = capSignals(signals)
  const overdueCount = signals.filter(s => isOverdueSignal(s, today)).length

  return (
    <div className="space-y-5">
      {/* ── 1 · TODAY ─────────────────────────────────────── */}
      <section className="card">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200">
          <Sun size={14} className="text-amber-500" />
          <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Today</h2>
          <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{signals.length}</span>
          {overdueCount > 0 && (
            <span className="text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full font-medium">
              {overdueCount} overdue
            </span>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-5 text-sm text-slate-400">Nothing needs you today — enjoy the quiet ✓</p>
        ) : shown.map(s => s.kind === 'task'
          ? <TodayTaskRow key={s.id} signal={s} today={today}
              exitPhase={phaseOf(s.id)} onComplete={completeTask} onSnooze={snoozeTask} />
          : <TodayLinkRow key={s.id} signal={s} />)}
        {more > 0 && (
          <Link href="/tasks" className="block px-4 py-2 text-xs text-blue-600 hover:underline">
            {more} more →
          </Link>
        )}
      </section>

      {/* ── 2 · DECISIONS WAITING ─────────────────────────── */}
      {decisions}

      {/* ── 3 · THIS WEEK ─────────────────────────────────── */}
      {week}

      {/* ── 4 · PORTFOLIO PULSE ───────────────────────────── */}
      {pulse}
    </div>
  )
}

// One interactive task row: complete circle + title + property chip +
// due accent + snooze — the tasks page affordances, dashboard-compact.
function TodayTaskRow({ signal, today, exitPhase, onComplete, onSnooze }: {
  signal: TaskSignal
  today: string
  exitPhase: ExitPhase | null
  onComplete: (task: DashboardTask) => void
  onSnooze: (task: DashboardTask, date: string) => void
}) {
  const t = signal.task
  const overdue = isOverdueSignal(signal, today)
  const overdueDays = overdue ? signalAgeDays(signal, today) : 0
  const leaving = exitPhase != null
  return (
    <CollapseOnComplete phase={exitPhase}>
      <div className={cn(
        'flex items-center gap-2 px-4 py-1.5 min-h-[34px] border-b border-slate-200/70 last:border-0 group hover:bg-slate-50 transition-colors',
        overdue && 'border-l-2 border-l-red-400'
      )}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: PRIORITY_DOT[t.priority] ?? '#94a3b8' }} />
        <CompleteCircle isDone={t.status === 'done' || leaving} onToggle={() => onComplete(t)} />
        <span className={cn('flex-1 min-w-0 truncate text-sm text-slate-800',
          (t.status === 'done' || leaving) && 'line-through text-slate-400')}>
          {t.title}
        </span>
        {t.properties?.name && <PropertyChip name={t.properties.name} />}
        <span className={cn('text-xs flex-shrink-0 whitespace-nowrap',
          overdue ? 'text-red-600 font-semibold' : 'text-amber-600 font-medium')}>
          {overdue ? `${overdueDays}d overdue` : 'today'}
        </span>
        <SnoozeMenu onSnooze={date => onSnooze(t, date)}
          buttonClassName="md:opacity-0 md:group-hover:opacity-100" />
      </div>
    </CollapseOnComplete>
  )
}

// Non-task signals deep-link to where the work happens.
function TodayLinkRow({ signal }: { signal: TodayLinkSignal }) {
  const Icon = LINK_ICONS[signal.kind]
  const propertyName = signal.kind === 'draft_call' ? null : signal.propertyName
  const ageLabel =
    signal.kind === 'inspection_triage' ? (signal.ageDays === 0 ? 'today' : `${signal.ageDays}d ago`)
    : signal.kind === 'draft_call' ? `${signal.ageDays}d old`
    : `oldest ${signal.oldestDays}d`
  return (
    <Link href={signal.href}
      className="flex items-center gap-2 px-4 py-1.5 min-h-[34px] border-b border-slate-200/70 last:border-0 hover:bg-slate-50 transition-colors">
      <Icon size={14} className={cn('flex-shrink-0', LINK_ICON_TONES[signal.kind])} />
      <span className="flex-1 min-w-0 truncate text-sm text-slate-800">{signal.title}</span>
      {propertyName && <PropertyChip name={propertyName} />}
      <span className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">{ageLabel}</span>
      <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
    </Link>
  )
}
