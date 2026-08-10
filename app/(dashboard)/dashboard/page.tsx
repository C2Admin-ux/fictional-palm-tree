// Dashboard — a GENERATED daily guide, not a KPI wall. Four lanes:
//   1 TODAY            ranked actionable list (interactive task rows)
//   2 DECISIONS        the executive queue (bids ready, closing windows)
//   3 THIS WEEK        the 7-day forecast + waiting-on + open seasons
//   4 PORTFOLIO PULSE  one slim strip of property chips + three tiles
//
// Server component does every read in parallel with lean selects; all
// pure derivation lives in lib/dashboard/signals.ts (shared with the
// client Today lane so re-ranking after a mutation can't drift). Each
// non-core signal query is individually guarded: on error its rows go
// null and the signal is simply omitted — one broken source never
// blanks the whole guide.

import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import {
  cn, todayISO, addDaysToDate, formatCurrency, formatDate,
  propertyColor, propertyAbbr, PRIORITY_DOT,
} from '@/lib/utils'
import {
  assembleDecisions, selectWeekTasks, selectWaitingBids,
  seasonalWindows, daysBetween,
  type DashboardTask, type TriageSignal, type DraftCallSignal, type StaleFlagSignal,
  type CapexSignalRow, type DecisionSignal, type WeekdayGroup, type WaitingBidsSignal,
  type SeasonalWindowLine,
} from '@/lib/dashboard/signals'
import { isMine } from '@/lib/tasks/agenda'
import { topLevel } from '@/lib/tasks/subtasks'
import { daysSince, isOpenFinding, UNSETTLED_DISPOSITIONS } from '@/lib/inspections/dispositions'
import { inspectionScore, scoreGrade, GRADE_STYLES, type ScoreGrade } from '@/lib/inspections/score'
import { SNOW_SETTING_KEY, LANDSCAPING_SETTING_KEY } from '@/lib/tasks/seasonal'
import { StatTile } from '@/components/ui/stat-tile'
import { DashboardLanes } from './lanes'
import {
  Scale, FileSignature, Shield, HardHat, CalendarRange, CheckSquare, Flag, CalendarClock,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

// ── Raw query-row shapes (lean selects below) ────────────────
type TriageRow = {
  id: string; inspection_date: string
  properties: { name: string } | null
  inspection_items: { disposition: string }[]
}
type DraftCallRow = {
  id: string; title: string; created_at: string
  pmcs: { name: string } | null
  call_items: { kind: string }[]
}
type FlagRow = {
  id: string; inspection_id: string; disposition_at: string | null
  inspections: { properties: { name: string } | null } | null
}
type CapexRow = {
  id: string; title: string; status: string
  budget: number | null; actual_spend: number | null; bids_target: number | null
  properties: { name: string } | null
  capex_bids: { vendor_name: string; status: 'requested' | 'received' | 'declined' | 'selected' | 'rejected'; amount: number | null; requested_at: string | null }[]
}
type ContractRow = { id: string; title: string; vendor_name: string; cancel_deadline: string }
type PolicyRow = { id: string; carrier: string; policy_type: string; expiry_date: string }
type CompletedInspectionRow = { id: string; property_id: string; inspection_date: string }
type OpenFindingRow = {
  requires_action: boolean; disposition: string
  inspections: { property_id: string } | null
}
type GradeItemRow = { inspection_id: string; requires_action: boolean; action_priority: string | null; disposition: string }

export default async function DashboardPage() {
  const supabase = await createClient()
  const today = todayISO()
  const in30 = addDaysToDate(today, 30)
  const in90 = addDaysToDate(today, 90)
  const draftCallCutoff = new Date(Date.now() - 1 * 86400000).toISOString()
  const staleFlagCutoff = new Date(Date.now() - 3 * 86400000).toISOString()

  const [
    { data: auth },
    propertiesRes,
    tasksRes,
    triageRes,
    callsRes,
    flagsRes,
    capexRes,
    contractsRes,
    policiesRes,
    completedInspRes,
    openFindingsRes,
    seasonSettingsRes,
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('properties').select('id, name').eq('status', 'active').order('name'),
    // ALL my open tasks including subtasks — the Today lane needs the
    // children so completing a parent sweeps them (openSubtasksOf),
    // and every list derivation starts from topLevel().
    supabase.from('tasks').select('*, properties(name)').neq('status', 'done'),
    // Submitted walks with untriaged findings: the embed is filtered to
    // disposition='open' so only the untriaged rows ride along.
    supabase.from('inspections')
      .select('id, inspection_date, properties(name), inspection_items(disposition)')
      .eq('status', 'submitted')
      .eq('inspection_items.disposition', 'open'),
    supabase.from('calls')
      .select('id, title, created_at, pmcs(name), call_items(kind)')
      .eq('status', 'draft')
      .lte('created_at', draftCallCutoff),
    supabase.from('inspection_items')
      .select('id, inspection_id, disposition_at, inspections!inner(properties(name))')
      .eq('disposition', 'flagged')
      .is('communicated_at', null)
      .lte('disposition_at', staleFlagCutoff),
    supabase.from('capex_projects')
      .select('id, title, status, budget, actual_spend, bids_target, properties(name), capex_bids(vendor_name, status, amount, requested_at)')
      .in('status', ['planning', 'approved', 'in_progress']),
    supabase.from('contracts')
      .select('id, title, vendor_name, cancel_deadline')
      .eq('status', 'active')
      .gte('cancel_deadline', today)
      .lte('cancel_deadline', in30),
    // The old expiring-policies banner, folded into Decisions rows.
    supabase.from('insurance_policies')
      .select('id, carrier, policy_type, expiry_date')
      .eq('status', 'active')
      .lte('expiry_date', in90),
    supabase.from('inspections')
      .select('id, property_id, inspection_date')
      .in('status', ['submitted', 'report_sent'])
      .order('inspection_date', { ascending: false }),
    // Canonical open-finding candidates (dispositions.ts): unsettled,
    // completed client-side with isOpenFinding.
    supabase.from('inspection_items')
      .select('requires_action, disposition, inspections!inner(property_id)')
      .in('disposition', [...UNSETTLED_DISPOSITIONS])
      .or('requires_action.eq.true,disposition.neq.open'),
    supabase.from('alert_settings')
      .select('setting_key, value')
      .is('property_id', null)
      .in('setting_key', [SNOW_SETTING_KEY, LANDSCAPING_SETTING_KEY]),
  ])

  const userId = auth.user?.id ?? null
  const properties = (propertiesRes.data ?? []) as { id: string; name: string }[]
  const tasks = (tasksRes.data ?? []) as unknown as DashboardTask[]
  const propertyNames = Object.fromEntries(properties.map(p => [p.id, p.name]))

  // ── TODAY link signals (each source individually guarded) ──
  const triage: TriageSignal[] | null = triageRes.error ? null
    : ((triageRes.data ?? []) as unknown as TriageRow[])
        .filter(i => i.inspection_items.length > 0)
        .map(i => {
          const n = i.inspection_items.length
          return {
            kind: 'inspection_triage' as const, id: `triage:${i.id}`, href: `/inspections/${i.id}`,
            title: `Triage inspection — ${n} untriaged finding${n === 1 ? '' : 's'}`,
            propertyName: i.properties?.name ?? null,
            untriaged: n,
            ageDays: Math.max(0, daysBetween(i.inspection_date, today)),
          }
        })

  const draftCalls: DraftCallSignal[] | null = callsRes.error ? null
    : ((callsRes.data ?? []) as unknown as DraftCallRow[]).map(c => {
        const n = c.call_items.filter(i => i.kind === 'action').length
        return {
          kind: 'draft_call' as const, id: `call:${c.id}`, href: `/calls/${c.id}`,
          title: `Review call: ${c.title || c.pmcs?.name || 'Untitled call'} · ${n} proposed item${n === 1 ? '' : 's'}`,
          proposedItems: n,
          ageDays: daysSince(c.created_at) ?? 0,
        }
      })

  const staleFlags: StaleFlagSignal[] | null = flagsRes.error ? null
    : Array.from(
        ((flagsRes.data ?? []) as unknown as FlagRow[])
          .reduce((acc, row) => {
            const entry = acc.get(row.inspection_id) ?? {
              count: 0, oldestDays: 0,
              propertyName: row.inspections?.properties?.name ?? null,
            }
            entry.count += 1
            entry.oldestDays = Math.max(entry.oldestDays, daysSince(row.disposition_at) ?? 0)
            return acc.set(row.inspection_id, entry)
          }, new Map<string, { count: number; oldestDays: number; propertyName: string | null }>())
          .entries()
      ).map(([inspectionId, g]) => ({
        kind: 'stale_flags' as const, id: `flags:${inspectionId}`, href: `/inspections/${inspectionId}`,
        title: `${g.count} flagged finding${g.count === 1 ? '' : 's'} not yet communicated`,
        propertyName: g.propertyName, count: g.count, oldestDays: g.oldestDays,
      }))

  // ── DECISIONS + THIS WEEK inputs ───────────────────────────
  const capexRows = (capexRes.data ?? []) as unknown as CapexRow[]
  const capexSignals: CapexSignalRow[] | null = capexRes.error ? null
    : capexRows.map(p => ({
        id: p.id, title: p.title, propertyName: p.properties?.name ?? null,
        bids_target: p.bids_target, bids: p.capex_bids,
      }))

  const decisions = assembleDecisions({
    capex: capexSignals,
    contracts: contractsRes.error ? null : ((contractsRes.data ?? []) as ContractRow[]),
    policies: policiesRes.error ? null : ((policiesRes.data ?? []) as PolicyRow[]),
  }, today)

  const weekGroups = selectWeekTasks(tasks, userId, today)
  const waitingBids = selectWaitingBids(capexSignals, today)
  const seasons = seasonalWindows(today, Object.fromEntries(
    ((seasonSettingsRes.data ?? []) as { setting_key: string; value: unknown }[])
      .map(s => [s.setting_key, s.value])
  ))

  // ── PORTFOLIO PULSE ────────────────────────────────────────
  // Latest completed walk per property → grade (one dependent fetch for
  // just those inspections' items).
  const latestInspByProp = new Map<string, string>()
  for (const i of ((completedInspRes.data ?? []) as CompletedInspectionRow[])) {
    if (!latestInspByProp.has(i.property_id)) latestInspByProp.set(i.property_id, i.id)
  }
  const latestIds = Array.from(latestInspByProp.values())
  const gradeItemsRes = latestIds.length > 0
    ? await supabase.from('inspection_items')
        .select('inspection_id, requires_action, action_priority, disposition')
        .in('inspection_id', latestIds)
    : { data: [] as GradeItemRow[], error: null }
  const itemsByInspection = new Map<string, GradeItemRow[]>()
  for (const it of ((gradeItemsRes.data ?? []) as GradeItemRow[])) {
    const arr = itemsByInspection.get(it.inspection_id)
    if (arr) arr.push(it)
    else itemsByInspection.set(it.inspection_id, [it])
  }

  const openFindingRows = (openFindingsRes.data ?? []) as unknown as OpenFindingRow[]
  const openByProperty = new Map<string, number>()
  let openFlagCount = 0
  for (const row of openFindingRows) {
    if (!isOpenFinding(row)) continue
    const pid = row.inspections?.property_id
    if (pid) openByProperty.set(pid, (openByProperty.get(pid) ?? 0) + 1)
    if (row.disposition === 'flagged') openFlagCount++
  }

  const pulseChips = properties.map(p => {
    const inspId = latestInspByProp.get(p.id)
    const items = inspId ? itemsByInspection.get(inspId) ?? [] : null
    return {
      id: p.id, name: p.name,
      grade: items != null ? scoreGrade(inspectionScore(items)) : null,
      openFindings: openByProperty.get(p.id) ?? 0,
    }
  })

  const myOpenTasks = topLevel(tasks).filter(t => isMine(t, userId))
  const myOverdue = myOpenTasks.filter(t => t.due_date != null && t.due_date < today).length
  const capexBudget = capexRows.reduce((s, p) => s + (p.budget ?? 0), 0)
  const capexSpent = capexRows.reduce((s, p) => s + (p.actual_spend ?? 0), 0)

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="page-title">{format(parseISO(today), 'EEEE, MMMM d')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Your day, generated — edit it as you go. {properties.length} active properties.
        </p>
      </div>

      <DashboardLanes
        initialTasks={tasks}
        triage={triage}
        draftCalls={draftCalls}
        staleFlags={staleFlags}
        userId={userId}
        today={today}
        propertyNames={propertyNames}
        decisions={<DecisionsLane signals={decisions} />}
        week={<WeekLane groups={weekGroups} waitingBids={waitingBids} seasons={seasons} />}
        pulse={<PulseStrip chips={pulseChips}
          openTasks={myOpenTasks.length} overdue={myOverdue}
          capexCount={capexRows.length} capexBudget={capexBudget} capexSpent={capexSpent}
          openFlags={openFlagCount} />}
      />
    </div>
  )
}

// ── 2 · DECISIONS WAITING (server-rendered) ──────────────────

function DecisionsLane({ signals }: { signals: DecisionSignal[] }) {
  return (
    <section className="card">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200">
        <Scale size={14} className="text-blue-500" />
        <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Decisions waiting</h2>
        <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{signals.length}</span>
      </div>
      {signals.length === 0 ? (
        <p className="px-4 py-4 text-sm text-emerald-600">No decisions waiting ✓</p>
      ) : signals.map(s => <DecisionRow key={s.id} signal={s} />)}
    </section>
  )
}

function DecisionRow({ signal }: { signal: DecisionSignal }) {
  const inner = signal.kind === 'bids_ready' ? (
    <>
      <HardHat size={14} className="text-emerald-500 flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate text-sm text-slate-800">
        <span className="font-medium">{signal.project}</span>
        {': '}{signal.received} bid{signal.received === 1 ? '' : 's'} in — <span className="text-emerald-700 font-medium">decide</span>
      </span>
      {signal.propertyName && <ChipSpan name={signal.propertyName} />}
    </>
  ) : signal.kind === 'cancel_window' ? (
    <>
      <FileSignature size={14} className="text-amber-500 flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate text-sm text-slate-800">
        Cancel window closes <span className="font-medium">{formatDate(signal.deadline)}</span>
        {': '}{signal.vendor} — {signal.title}
      </span>
      <DaysBadge date={signal.deadline} />
    </>
  ) : (
    <>
      <Shield size={14} className="text-amber-500 flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate text-sm text-slate-800">
        Policy renewal: <span className="font-medium">{signal.carrier}</span> · {signal.policyType.toUpperCase()}
        {' — '}{signal.daysLeft < 0 ? 'expired' : 'expires'} {formatDate(signal.expiry)}
      </span>
      <DaysBadge date={signal.expiry} />
    </>
  )
  return (
    <Link href={signal.href}
      className="flex items-center gap-2 px-4 py-2 border-b border-slate-200/70 last:border-0 hover:bg-slate-50 transition-colors">
      {inner}
    </Link>
  )
}

function DaysBadge({ date }: { date: string }) {
  const days = daysBetween(todayISO(), date)
  return (
    <span className={cn('badge flex-shrink-0',
      days < 0 ? 'text-red-700 bg-red-50 border-red-200'
      : days <= 30 ? 'text-amber-700 bg-amber-50 border-amber-200'
      : 'text-slate-500 bg-slate-50 border-slate-200')}>
      {days < 0 ? 'EXPIRED' : `${days}d left`}
    </span>
  )
}

// ── 3 · THIS WEEK (server-rendered) ──────────────────────────

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
            <div key={t.id} className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-200/70 last:border-0">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: PRIORITY_DOT[t.priority] ?? '#94a3b8' }} />
              <span className="flex-1 min-w-0 truncate text-sm text-slate-700">{t.title}</span>
              {t.properties?.name && <ChipSpan name={t.properties.name} />}
            </div>
          ))}
        </div>
      ))}

      {waitingBids.map(w => (
        <Link key={w.id} href={w.href}
          className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-200/70 last:border-0 hover:bg-slate-50 transition-colors">
          <HardHat size={14} className="text-amber-500 flex-shrink-0" />
          <span className="flex-1 min-w-0 truncate text-sm text-slate-700">
            <span className="font-medium">{w.project}</span>: waiting on {w.vendors.join(', ')}
            {w.oldestRequestDays != null && <span className="text-slate-400"> · {w.oldestRequestDays}d</span>}
          </span>
          {w.propertyName && <ChipSpan name={w.propertyName} />}
        </Link>
      ))}

      {seasons.map(s => (
        <div key={s.key} className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-200/70 last:border-0 text-sm text-slate-600">
          <CalendarClock size={14} className="text-sky-500 flex-shrink-0" />
          {s.label}
        </div>
      ))}
    </section>
  )
}

// ── 4 · PORTFOLIO PULSE (server-rendered) ────────────────────

function PulseStrip({ chips, openTasks, overdue, capexCount, capexBudget, capexSpent, openFlags }: {
  chips: { id: string; name: string; grade: ScoreGrade | null; openFindings: number }[]
  openTasks: number
  overdue: number
  capexCount: number
  capexBudget: number
  capexSpent: number
  openFlags: number
}) {
  return (
    <section className="space-y-3">
      <div className="card px-3 py-2 flex flex-wrap items-center gap-2">
        {chips.length === 0 && <span className="text-sm text-slate-400 px-1">No active properties</span>}
        {chips.map(c => (
          <Link key={c.id} href={`/properties/${c.id}`} title={c.name}
            className="flex items-center gap-1.5 border border-slate-200 rounded-full pl-2 pr-2.5 py-1 hover:border-blue-300 hover:bg-slate-50 transition-colors">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: propertyColor(c.name) }} />
            <span className="text-xs font-semibold text-slate-700">{propertyAbbr(c.name)}</span>
            {c.grade != null && (
              <span className={cn('text-[10px] font-bold px-1 rounded border leading-4', GRADE_STYLES[c.grade])}>
                {c.grade}
              </span>
            )}
            <span className={cn('text-xs', c.openFindings > 0 ? 'text-amber-600 font-medium' : 'text-slate-400')}>
              {c.openFindings} open
            </span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile label="Open Tasks" value={String(openTasks)}
          sub={overdue > 0 ? `${overdue} overdue` : 'none overdue'}
          icon={<CheckSquare size={15} />} alert={overdue > 0} href="/tasks" />
        <StatTile label="Active CapEx" value={String(capexCount)}
          sub={`${formatCurrency(capexSpent, true)} spent of ${formatCurrency(capexBudget, true)}`}
          icon={<HardHat size={15} />} href="/capex" />
        <StatTile label="Open Flags" value={String(openFlags)}
          sub="flagged findings in play"
          icon={<Flag size={15} />} alert={openFlags > 0} href="/inspections" />
      </div>
    </section>
  )
}

// Property chip for server rows (the client lane has its own).
function ChipSpan({ name }: { name: string }) {
  const pc = propertyColor(name)
  return (
    <span className="hidden sm:inline-block flex-shrink-0 max-w-[13ch] truncate text-xs font-medium px-1.5 py-0.5 rounded"
      style={{ background: `${pc}18`, color: pc }} title={name}>
      {name}
    </span>
  )
}
