// Dashboard — a GENERATED daily guide, not a KPI wall. Four lanes:
//   1 TODAY            ranked actionable list (interactive task rows)
//   2 DECISIONS        the executive queue (bids ready, closing windows)
//   3 THIS WEEK        the 7-day forecast + waiting-on + open seasons
//   4 PORTFOLIO PULSE  one slim strip of property chips + three tiles
//
// Division of labor: this server component does every read in parallel
// with lean selects and passes the RAW source rows through; the client
// DashboardLanes owns "today" (computed locally, so a UTC server clock
// can't shift the guide) and assembles lanes 1–3 via the pure selectors
// in lib/dashboard/signals.ts, re-deriving on every client task
// mutation or broadcast. Only Portfolio Pulse renders here. Each
// non-core signal query is individually guarded: on error its rows go
// null and the signal is simply omitted — one broken source never
// blanks the whole guide.

import { createClient } from '@/lib/supabase/server'
import { format, parseISO } from 'date-fns'
import {
  cn, todayISO, addDaysToDate, formatCurrency,
  propertyColor, propertyAbbr,
} from '@/lib/utils'
import {
  type DashboardTask, type TriageSourceRow, type DraftCallSourceRow,
  type StaleFlagSourceRow, type CapexSignalRow, type DecisionContractRow,
  type DecisionPolicyRow, type SeasonSettingRow,
} from '@/lib/dashboard/signals'
import { isMine } from '@/lib/tasks/agenda'
import { topLevel } from '@/lib/tasks/subtasks'
import { isOpenFinding, UNSETTLED_DISPOSITIONS } from '@/lib/inspections/dispositions'
import { inspectionScore, scoreGrade, GRADE_STYLES, type ScoreGrade } from '@/lib/inspections/score'
import { SNOW_SETTING_KEY, LANDSCAPING_SETTING_KEY } from '@/lib/tasks/seasonal'
import { StatTile } from '@/components/ui/stat-tile'
import { DashboardLanes } from './lanes'
import Link from 'next/link'
import { CheckSquare, Flag, HardHat } from 'lucide-react'

export const dynamic = 'force-dynamic'

// ── Raw query-row shapes (lean selects below) ────────────────
// The signal-source shapes live in lib/dashboard/signals.ts next to
// their builders; only Pulse-specific shapes remain here.
type CapexRow = {
  id: string; title: string; status: string
  budget: number | null; actual_spend: number | null; bids_target: number | null
  properties: { name: string } | null
  capex_bids: { vendor_name: string; status: 'requested' | 'received' | 'declined' | 'selected' | 'rejected'; amount: number | null; requested_at: string | null }[]
}
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
  const weekAgo = addDaysToDate(today, -7)
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
    // Horizon guard: the client re-buckets against ITS local today, so
    // this fetch must cover the widest window it could need (overdue →
    // +7d) regardless of server-vs-client clock skew. With no due-date
    // bound at all that holds trivially — if a bound is ever added for
    // volume, widen it by ±1 day beyond the client horizon to absorb
    // timezone drift (and keep null-due rows: blockers and subtasks).
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
    // Lower bound: active policies expired more than a week ago are
    // stale data, not decisions — the recent ones (≤7d) collapse into
    // one hygiene row in assembleDecisions.
    supabase.from('insurance_policies')
      .select('id, carrier, policy_type, expiry_date')
      .eq('status', 'active')
      .gte('expiry_date', weekAgo)
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
    // Global AND property-level season windows — the client resolves
    // them per property in the engine's order (property → global →
    // defaults).
    supabase.from('alert_settings')
      .select('property_id, setting_key, value')
      .in('setting_key', [SNOW_SETTING_KEY, LANDSCAPING_SETTING_KEY]),
  ])

  const userId = auth.user?.id ?? null
  const properties = (propertiesRes.data ?? []) as { id: string; name: string }[]
  const tasks = (tasksRes.data ?? []) as unknown as DashboardTask[]
  const propertyNames = Object.fromEntries(properties.map(p => [p.id, p.name]))

  // ── Raw signal sources (each individually guarded) ─────────
  const triageRows = triageRes.error ? null
    : ((triageRes.data ?? []) as unknown as TriageSourceRow[])
  const callRows = callsRes.error ? null
    : ((callsRes.data ?? []) as unknown as DraftCallSourceRow[])
  const flagRows = flagsRes.error ? null
    : ((flagsRes.data ?? []) as unknown as StaleFlagSourceRow[])

  const capexRows = (capexRes.data ?? []) as unknown as CapexRow[]
  const capexSignals: CapexSignalRow[] | null = capexRes.error ? null
    : capexRows.map(p => ({
        id: p.id, title: p.title, propertyName: p.properties?.name ?? null,
        bids_target: p.bids_target, bids: p.capex_bids,
      }))

  const contracts = contractsRes.error ? null
    : ((contractsRes.data ?? []) as DecisionContractRow[])
  const policies = policiesRes.error ? null
    : ((policiesRes.data ?? []) as DecisionPolicyRow[])
  const seasonSettings = (seasonSettingsRes.data ?? []) as SeasonSettingRow[]

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
      openFindings: openByProperty.get(p.id) ?? 0 as number | null,
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
        triageRows={triageRows}
        callRows={callRows}
        flagRows={flagRows}
        capexSignals={capexSignals}
        contracts={contracts}
        policies={policies}
        seasonSettings={seasonSettings}
        activePropertyIds={properties.map(p => p.id)}
        userId={userId}
        serverToday={today}
        propertyNames={propertyNames}
        pulse={<PulseStrip chips={pulseChips}
          openTasks={myOpenTasks.length} overdue={myOverdue}
          capexCount={capexRows.length} capexBudget={capexBudget} capexSpent={capexSpent}
          openFlags={openFlagCount} />}
      />
    </div>
  )
}

// ── 4 · PORTFOLIO PULSE (server-rendered) ────────────────────

function PulseStrip({ chips, openTasks, overdue, capexCount, capexBudget, capexSpent, openFlags }: {
  chips: { id: string; name: string; grade: ScoreGrade | null; openFindings: number | null }[]
  openTasks: number
  overdue: number
  capexCount: number
  capexBudget: number
  capexSpent: number
  openFlags: number | null
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
            {c.openFindings != null && (
              <span className={cn('text-xs', c.openFindings > 0 ? 'text-amber-600 font-medium' : 'text-slate-400')}>
                {c.openFindings} open
              </span>
            )}
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
        <StatTile label="Open Flags" value={openFlags != null ? String(openFlags) : '—'}
          sub={openFlags != null ? 'flagged findings in play' : 'count unavailable'}
          icon={<Flag size={15} />} alert={openFlags != null && openFlags > 0} href="/inspections" />
      </div>
    </section>
  )
}
