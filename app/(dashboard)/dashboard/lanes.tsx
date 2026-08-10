'use client'

// DashboardLanes — the daily guide's client shell, and the OWNER of
// "today". The server page runs the queries and passes RAW source rows
// through; this component computes todayISO() locally (the server's
// today is only a first-paint fallback, recomputed on mount) and
// assembles Today, Decisions (days-left labels included), and This Week
// via the pure selectors in lib/dashboard/signals.ts. Everything
// re-derives whenever client task state changes (complete / snooze /
// undo) or a c2:task-created broadcast lands — a broadcast task due
// within the horizon joins the week lane too, and a snoozed Today row
// re-buckets under its weekday (or leaves the guide with one muted
// "snoozed" mention). Only Portfolio Pulse still arrives
// server-rendered as a node.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Task } from '@/lib/supabase/types'
import {
  buildTodaySignals, buildTriageSignals, buildDraftCallSignals, buildStaleFlagSignals,
  capToday, capSignals, selectTodayTasks, selectWeekTasks, selectWaitingBids,
  seasonalWindows, assembleDecisions, isOverdueSignal, signalAgeDays, daysBetween,
  DECISIONS_CAP,
  type DashboardTask, type TaskSignal, type TodayLinkSignal,
  type TriageSourceRow, type DraftCallSourceRow, type StaleFlagSourceRow,
  type CapexSignalRow, type DecisionContractRow, type DecisionPolicyRow,
  type SeasonSettingRow, type DecisionSignal, type WeekdayGroup,
  type WaitingBidsSignal, type SeasonalWindowLine,
} from '@/lib/dashboard/signals'
import { openSubtasksOf } from '@/lib/tasks/subtasks'
import { TASK_CREATED_EVENT } from '@/lib/tasks/create'
import {
  type TaskStore, toggleDoneOptimistic, snoozeTaskOptimistic,
} from '@/lib/tasks/mutations'
import { CompleteCircle } from '@/components/tasks/row-cells'
import { SnoozeMenu } from '@/components/tasks/snooze-menu'
import { CollapseOnComplete, useExitingRows, type ExitPhase } from '@/components/tasks/complete-collapse'
import {
  cn, todayISO, formatDate, formatDateShort, propertyColor, propertyAbbr, PRIORITY_DOT,
} from '@/lib/utils'
import {
  ClipboardCheck, Phone, Flag, ChevronRight, Sun, Moon,
  Scale, FileSignature, Shield, HardHat, CalendarRange, CalendarClock,
} from 'lucide-react'

// Small shared chip — property context on any row type. Full name from
// md up, 2-letter abbreviation below (one breakpoint for every lane).
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

// One row shell for every lane: icon/content/badges in a 34px line with
// the shared border + spacing. Links get the hover affordance.
function SignalRow({ href, className, children }: {
  href?: string
  className?: string
  children: React.ReactNode
}) {
  const base = 'flex items-center gap-2 px-4 py-1.5 min-h-[34px] border-b border-slate-200/70 last:border-0'
  if (href != null) {
    return (
      <Link href={href} className={cn(base, 'hover:bg-slate-50 transition-colors', className)}>
        {children}
      </Link>
    )
  }
  return <div className={cn(base, className)}>{children}</div>
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
  initialTasks, triageRows, callRows, flagRows,
  capexSignals, contracts, policies, seasonSettings, activePropertyIds,
  userId, serverToday, propertyNames, pulse,
}: {
  // ALL my open tasks (subtasks included — completing a parent must
  // sweep its children exactly like the tasks page does).
  initialTasks: DashboardTask[]
  // Raw signal source rows (null = that query failed; section omitted).
  triageRows: TriageSourceRow[] | null
  callRows: DraftCallSourceRow[] | null
  flagRows: StaleFlagSourceRow[] | null
  capexSignals: CapexSignalRow[] | null
  contracts: DecisionContractRow[] | null
  policies: DecisionPolicyRow[] | null
  seasonSettings: SeasonSettingRow[]
  activePropertyIds: string[]
  userId: string | null
  // The server's today — first-paint fallback only; the client's local
  // calendar takes over on mount.
  serverToday: string
  // property_id → name, for enriching broadcast-inserted bare rows
  propertyNames: Record<string, string>
  pulse: React.ReactNode
}) {
  const supabase = useMemo(() => createClient(), [])
  const [tasks, setTasks] = useState<DashboardTask[]>(initialTasks)
  const tasksRef = useRef(tasks); tasksRef.current = tasks

  // The client owns "today": recompute locally on mount so a UTC server
  // rendering at local 8pm can't shift the whole guide a day forward.
  const [today, setToday] = useState(serverToday)
  useEffect(() => { setToday(todayISO()) }, [])

  // Tasks snoozed from this dashboard session — if one re-buckets into
  // the week lane it just moves; if it leaves the guide entirely, a
  // single muted line below Today says so.
  const [snoozedIds, setSnoozedIds] = useState<ReadonlySet<string>>(new Set())

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
  // let the selectors decide relevance (due today ranks into Today, due
  // within the horizon lands in its weekday, an undated capture simply
  // doesn't select).
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
    setSnoozedIds(prev => new Set(prev).add(task.id))
  }, [supabase, store])

  // ── Lane assembly — all client-side, all against local `today` ──
  const signals = useMemo(() => buildTodaySignals({
    tasks: selectTodayTasks(renderTasks, userId, today),
    triage: buildTriageSignals(triageRows, today),
    draftCalls: buildDraftCallSignals(callRows, today),
    staleFlags: buildStaleFlagSignals(flagRows, today),
  }, today), [renderTasks, userId, today, triageRows, callRows, flagRows])

  const { shown, moreTasks } = capToday(signals)
  const overdueCount = signals.filter(s => isOverdueSignal(s, today)).length

  const decisions = useMemo(
    () => assembleDecisions({ capex: capexSignals, contracts, policies }, today),
    [capexSignals, contracts, policies, today])
  const weekGroups = useMemo(
    () => selectWeekTasks(tasks, userId, today), [tasks, userId, today])
  const waitingBids = useMemo(
    () => selectWaitingBids(capexSignals, today), [capexSignals, today])
  const seasons = useMemo(
    () => seasonalWindows(today, seasonSettings, activePropertyIds),
    [today, seasonSettings, activePropertyIds])

  // Session-snoozed tasks that no longer appear anywhere in the guide
  // (not Today, not any weekday) — surfaced as one muted line so the
  // row doesn't just vanish.
  const snoozedAway = useMemo(() => {
    if (snoozedIds.size === 0) return []
    const inGuide = new Set([
      ...signals.filter((s): s is TaskSignal => s.kind === 'task').map(s => s.id),
      ...weekGroups.flatMap(g => g.tasks.map(t => t.id)),
    ])
    return Array.from(snoozedIds)
      .map(id => tasks.find(t => t.id === id))
      .filter((t): t is DashboardTask =>
        t != null && t.status !== 'done' && !inGuide.has(t.id) &&
        t.snoozed_until != null && t.snoozed_until > today)
  }, [snoozedIds, signals, weekGroups, tasks, today])

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
        {moreTasks > 0 && (
          <Link href="/tasks" className="block px-4 py-2 text-xs text-blue-600 hover:underline">
            {moreTasks} more task{moreTasks === 1 ? '' : 's'} →
          </Link>
        )}
        {snoozedAway.length > 0 && (
          <p className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-slate-400 border-t border-slate-200/70">
            <Moon size={11} className="flex-shrink-0" />
            {snoozedAway.length === 1
              ? <>snoozed &ldquo;{snoozedAway[0].title}&rdquo; — wakes {formatDateShort(snoozedAway[0].snoozed_until)}</>
              : <>{snoozedAway.length} tasks snoozed out of the guide</>}
          </p>
        )}
      </section>

      {/* ── 2 · DECISIONS WAITING ─────────────────────────── */}
      <DecisionsLane signals={decisions} today={today} />

      {/* ── 3 · THIS WEEK ─────────────────────────────────── */}
      <WeekLane groups={weekGroups} waitingBids={waitingBids} seasons={seasons} />

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
      <SignalRow className={cn('group hover:bg-slate-50 transition-colors',
        overdue && 'border-l-2 border-l-red-400')}>
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
      </SignalRow>
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
    <SignalRow href={signal.href}>
      <Icon size={14} className={cn('flex-shrink-0', LINK_ICON_TONES[signal.kind])} />
      <span className="flex-1 min-w-0 truncate text-sm text-slate-800">{signal.title}</span>
      {propertyName && <PropertyChip name={propertyName} />}
      <span className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">{ageLabel}</span>
      <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
    </SignalRow>
  )
}

// ── 2 · DECISIONS WAITING ────────────────────────────────────

function DecisionsLane({ signals, today }: { signals: DecisionSignal[]; today: string }) {
  const { shown, more } = capSignals(signals, DECISIONS_CAP)
  return (
    <section className="card">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200">
        <Scale size={14} className="text-blue-500" />
        <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Decisions waiting</h2>
        <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{signals.length}</span>
      </div>
      {signals.length === 0 ? (
        <p className="px-4 py-4 text-sm text-emerald-600">No decisions waiting ✓</p>
      ) : shown.map(s => <DecisionRow key={s.id} signal={s} today={today} />)}
      {more > 0 && (
        <p className="px-4 py-2 text-xs text-slate-400">+{more} more decision{more === 1 ? '' : 's'}</p>
      )}
    </section>
  )
}

function DecisionRow({ signal, today }: { signal: DecisionSignal; today: string }) {
  const inner = signal.kind === 'bids_ready' ? (
    <>
      <HardHat size={14} className="text-emerald-500 flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate text-sm text-slate-800">
        <span className="font-medium">{signal.project}</span>
        {': '}{signal.received} bid{signal.received === 1 ? '' : 's'} in — <span className="text-emerald-700 font-medium">decide</span>
      </span>
      {signal.propertyName && <PropertyChip name={signal.propertyName} />}
    </>
  ) : signal.kind === 'cancel_window' ? (
    <>
      <FileSignature size={14} className="text-amber-500 flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate text-sm text-slate-800">
        Cancel window closes <span className="font-medium">{formatDate(signal.deadline)}</span>
        {': '}{signal.vendor} — {signal.title}
      </span>
      <DaysBadge date={signal.deadline} today={today} />
    </>
  ) : signal.kind === 'policy_renewal' ? (
    <>
      <Shield size={14} className="text-amber-500 flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate text-sm text-slate-800">
        Policy renewal: <span className="font-medium">{signal.carrier}</span> · {signal.policyType.toUpperCase()}
        {' — '}expires {formatDate(signal.expiry)}
      </span>
      <DaysBadge date={signal.expiry} today={today} />
    </>
  ) : (
    <>
      <Shield size={14} className="text-slate-400 flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate text-sm text-slate-600">
        {signal.count} active {signal.count === 1 ? 'policy shows an expired date' : 'policies show expired dates'} — review
      </span>
    </>
  )
  return <SignalRow href={signal.href}>{inner}</SignalRow>
}

function DaysBadge({ date, today }: { date: string; today: string }) {
  const days = daysBetween(today, date)
  return (
    <span className={cn('badge flex-shrink-0',
      days < 0 ? 'text-red-700 bg-red-50 border-red-200'
      : days <= 30 ? 'text-amber-700 bg-amber-50 border-amber-200'
      : 'text-slate-500 bg-slate-50 border-slate-200')}>
      {days < 0 ? 'EXPIRED' : `${days}d left`}
    </span>
  )
}

// ── 3 · THIS WEEK ────────────────────────────────────────────

function WeekLane({ groups, waitingBids, seasons }: {
  groups: WeekdayGroup[]
  waitingBids: WaitingBidsSignal[]
  seasons: SeasonalWindowLine[]
}) {
  const taskCount = groups.reduce((s, g) => s + g.tasks.length, 0)
  const empty = taskCount === 0 && waitingBids.length === 0 && seasons.length === 0
  return (
    <section className="card">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200">
        <CalendarRange size={14} className="text-blue-500" />
        <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">This week</h2>
        <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{taskCount}</span>
        <Link href="/tasks?view=review" className="ml-auto text-xs text-blue-600 hover:underline">
          Plan my week →
        </Link>
      </div>

      {empty && <p className="px-4 py-4 text-sm text-slate-400">Nothing scheduled for the next 7 days.</p>}

      {groups.map(g => (
        <div key={g.date}>
          <div className="px-4 py-1 bg-slate-50 border-b border-slate-200/70 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {g.label}
          </div>
          {g.tasks.map(t => (
            <SignalRow key={t.id}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: PRIORITY_DOT[t.priority] ?? '#94a3b8' }} />
              <span className="flex-1 min-w-0 truncate text-sm text-slate-700">{t.title}</span>
              {t.properties?.name && <PropertyChip name={t.properties.name} />}
            </SignalRow>
          ))}
        </div>
      ))}

      {waitingBids.map(w => (
        <SignalRow key={w.id} href={w.href}>
          <HardHat size={14} className="text-amber-500 flex-shrink-0" />
          <span className="flex-1 min-w-0 truncate text-sm text-slate-700">
            <span className="font-medium">{w.project}</span>: waiting on {w.vendors.join(', ')}
            {w.oldestRequestDays != null && <span className="text-slate-400"> · {w.oldestRequestDays}d</span>}
          </span>
          {w.propertyName && <PropertyChip name={w.propertyName} />}
        </SignalRow>
      ))}

      {seasons.map(s => (
        <SignalRow key={s.key} className="text-sm text-slate-600">
          <CalendarClock size={14} className="text-sky-500 flex-shrink-0" />
          {s.label}
        </SignalRow>
      ))}
    </section>
  )
}
