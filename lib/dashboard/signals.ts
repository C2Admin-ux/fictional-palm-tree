// The dashboard's generated daily guide, as pure data: a typed signal
// union per lane, ONE ranking function for the Today lane, and per-lane
// selectors/assemblers. No fetching, no React — the server page feeds
// query rows in, and the client Today lane re-runs the same selectors
// whenever its local task state changes (complete / snooze / broadcast
// insert), so server render and client re-rank can never disagree.
//
// Per-signal resilience: every assembler takes `null` for a signal
// source and simply omits that section — a failed query (or a signal
// whose backing schema hasn't shipped yet) degrades to a quieter
// dashboard, never a crash. The server page maps query errors to null.

import type { Task } from '@/lib/supabase/types'
import { topLevel } from '@/lib/tasks/subtasks'
import { isMine, isAwake, isUnblocked } from '@/lib/tasks/agenda'
import { bidGlance, type BidLike } from '@/lib/capex/bids'
import { SEASONS, resolveSeasonConfig, seasonDueDate, type SeasonSpec } from '@/lib/tasks/seasonal'
import { addDaysToDate, daysBetween, formatDateShort } from '@/lib/utils'
import { format, parseISO } from 'date-fns'

// Task rows carry the joined property name (display) and stay full Task
// rows underneath — the Today lane's optimistic mutations need them.
export type DashboardTask = Task & { properties: { name: string } | null }

// Re-exported from lib/utils (hoisted there so the renewals board and
// these signals can never disagree on "days late"). Kept as an export
// here for existing consumers.
export { daysBetween } from '@/lib/utils'

// ── TODAY — ranked actionable list ───────────────────────────

export type TaskSignal = { kind: 'task'; id: string; task: DashboardTask }
export type TriageSignal = {
  kind: 'inspection_triage'; id: string; href: string
  title: string; propertyName: string | null; untriaged: number; ageDays: number
}
export type DraftCallSignal = {
  kind: 'draft_call'; id: string; href: string
  title: string; proposedItems: number; ageDays: number
}
export type StaleFlagSignal = {
  kind: 'stale_flags'; id: string; href: string
  title: string; propertyName: string | null; count: number; oldestDays: number
}
export type TodayLinkSignal = TriageSignal | DraftCallSignal | StaleFlagSignal
export type TodaySignal = TaskSignal | TodayLinkSignal

export const TODAY_CAP = 10
// Even when link signals crowd the lane, at least this many task rows
// always show before the "{n} more tasks" overflow.
export const TODAY_TASK_FLOOR = 4

// ── Raw source rows → link signals ───────────────────────────
// The server page passes its query rows through untransformed; the
// client lane builds the signals against ITS local `today`, so ages and
// day counts can never drift from the server's clock/timezone.

export type TriageSourceRow = {
  id: string; inspection_date: string
  properties: { name: string } | null
  inspection_items: { disposition: string }[]
}

export function buildTriageSignals(
  rows: TriageSourceRow[] | null, today: string
): TriageSignal[] | null {
  if (rows == null) return null
  return rows
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
}

export type DraftCallSourceRow = {
  id: string; title: string; created_at: string
  pmcs: { name: string } | null
  call_items: { kind: string }[]
}

export function buildDraftCallSignals(
  rows: DraftCallSourceRow[] | null, today: string
): DraftCallSignal[] | null {
  if (rows == null) return null
  return rows.map(c => {
    const n = c.call_items.filter(i => i.kind === 'action').length
    return {
      kind: 'draft_call' as const, id: `call:${c.id}`, href: `/calls/${c.id}`,
      title: `Review call: ${c.title || c.pmcs?.name || 'Untitled call'} · ${n} proposed item${n === 1 ? '' : 's'}`,
      proposedItems: n,
      ageDays: Math.max(0, daysBetween(c.created_at.slice(0, 10), today)),
    }
  })
}

export type StaleFlagSourceRow = {
  id: string; inspection_id: string; disposition_at: string | null
  inspections: { properties: { name: string } | null } | null
}

export function buildStaleFlagSignals(
  rows: StaleFlagSourceRow[] | null, today: string
): StaleFlagSignal[] | null {
  if (rows == null) return null
  return Array.from(
    rows
      .reduce((acc, row) => {
        const entry = acc.get(row.inspection_id) ?? {
          count: 0, oldestDays: 0,
          propertyName: row.inspections?.properties?.name ?? null,
        }
        entry.count += 1
        entry.oldestDays = Math.max(entry.oldestDays,
          row.disposition_at != null ? Math.max(0, daysBetween(row.disposition_at.slice(0, 10), today)) : 0)
        return acc.set(row.inspection_id, entry)
      }, new Map<string, { count: number; oldestDays: number; propertyName: string | null }>())
      .entries()
  ).map(([inspectionId, g]) => ({
    kind: 'stale_flags' as const, id: `flags:${inspectionId}`, href: `/inspections/${inspectionId}`,
    title: `${g.count} flagged finding${g.count === 1 ? '' : 's'} not yet communicated`,
    propertyName: g.propertyName, count: g.count, oldestDays: g.oldestDays,
  }))
}

// My actionable tasks due today or overdue — the same MINE / AWAKE /
// UNBLOCKED predicates as the tasks page Agenda (lib/tasks/agenda.ts),
// top-level rows only (subtasks live in their parent's drill-down).
// Inbox rows are excluded to match the Agenda's composition: an inbox
// item is unprocessed capture, not a commitment for today.
export function selectTodayTasks(
  tasks: DashboardTask[], userId: string | null, today: string
): TaskSignal[] {
  const byId = new Map(tasks.map(t => [t.id, t]))
  return topLevel(tasks)
    .filter(t =>
      t.status !== 'done' && t.status !== 'inbox' &&
      isMine(t, userId) && isAwake(t, today) &&
      isUnblocked(t, byId) && t.due_date != null && t.due_date <= today)
    .map(t => ({ kind: 'task' as const, id: t.id, task: t }))
}

export function isOverdueSignal(s: TodaySignal, today: string): boolean {
  return s.kind === 'task' && s.task.due_date != null && s.task.due_date < today
}

// Urgency rank shared by the mixed Today list. Tasks use their own
// priority; non-task signals slot in beside it: an untriaged walk or a
// flag going stale reads as 'high' (a person/report is waiting), a
// draft call to review as 'medium'.
const TASK_PRIORITY_RANK: Record<Task['priority'], number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export function signalPriorityRank(s: TodaySignal): number {
  switch (s.kind) {
    case 'task': return TASK_PRIORITY_RANK[s.task.priority] ?? 2
    case 'inspection_triage': return 1
    case 'stale_flags': return 1
    case 'draft_call': return 2
  }
}

// Age tie-break: older signals rise. Tasks age from their due date
// (overdue) or creation date; link signals carry their own age.
export function signalAgeDays(s: TodaySignal, today: string): number {
  switch (s.kind) {
    case 'task': {
      const from = s.task.due_date != null && s.task.due_date < today
        ? s.task.due_date
        : s.task.created_at.slice(0, 10)
      return Math.max(0, daysBetween(from, today))
    }
    case 'inspection_triage': return s.ageDays
    case 'draft_call': return s.ageDays
    case 'stale_flags': return s.oldestDays
  }
}

// The Today ranking: overdue tasks first (oldest due date, then
// priority), then everything else by priority, then age (older first).
export function rankToday<T extends TodaySignal>(signals: T[], today: string): T[] {
  return [...signals].sort((a, b) => {
    const ao = isOverdueSignal(a, today)
    const bo = isOverdueSignal(b, today)
    if (ao !== bo) return ao ? -1 : 1
    if (ao && bo) {
      const byDue = ((a as TaskSignal).task.due_date ?? '')
        .localeCompare((b as TaskSignal).task.due_date ?? '')
      if (byDue !== 0) return byDue
    }
    const byPriority = signalPriorityRank(a) - signalPriorityRank(b)
    if (byPriority !== 0) return byPriority
    return signalAgeDays(b, today) - signalAgeDays(a, today)
  })
}

// Merge + rank, omitting null (failed/absent) sources — the client lane
// re-runs this with its live task list.
export function buildTodaySignals(input: {
  tasks: TaskSignal[]
  triage: TriageSignal[] | null
  draftCalls: DraftCallSignal[] | null
  staleFlags: StaleFlagSignal[] | null
}, today: string): TodaySignal[] {
  return rankToday(
    [...input.tasks, ...(input.triage ?? []), ...(input.draftCalls ?? []), ...(input.staleFlags ?? [])],
    today
  )
}

export function capSignals<T>(signals: T[], cap: number = TODAY_CAP): { shown: T[]; more: number } {
  return signals.length <= cap
    ? { shown: signals, more: 0 }
    : { shown: signals.slice(0, cap), more: signals.length - cap }
}

// Today-lane cap: link signals (triage / calls / flags) are few and
// each represents a person or report waiting — they are NEVER hidden.
// Only task rows are capped, at whatever room the links leave
// (TODAY_CAP − links), never below TODAY_TASK_FLOOR. Ranked order is
// preserved; the overflow count is tasks only ("{n} more tasks →").
export function capToday(signals: TodaySignal[]): { shown: TodaySignal[]; moreTasks: number } {
  const linkCount = signals.reduce((n, s) => n + (s.kind === 'task' ? 0 : 1), 0)
  const taskCount = signals.length - linkCount
  const taskCap = Math.max(TODAY_CAP - linkCount, TODAY_TASK_FLOOR)
  if (taskCount <= taskCap) return { shown: signals, moreTasks: 0 }
  let kept = 0
  const shown = signals.filter(s => s.kind !== 'task' || ++kept <= taskCap)
  return { shown, moreTasks: taskCount - taskCap }
}

// ── DECISIONS WAITING — the executive queue ──────────────────

// Lean capex shape the dashboard fetch embeds — enough for bidGlance
// (lib/capex/bids.ts, the single source of bid-state truth) plus the
// request dates the waiting-age label needs.
export type DashBid = BidLike & { requested_at: string | null }
export type CapexSignalRow = {
  id: string
  title: string
  propertyName: string | null
  bids_target: number | null
  bids: DashBid[]
}

export type BidsReadySignal = {
  kind: 'bids_ready'; id: string; href: string
  project: string; propertyName: string | null; received: number
}
export type CancelWindowSignal = {
  kind: 'cancel_window'; id: string; href: string
  vendor: string; title: string; deadline: string
}
export type PolicyRenewalSignal = {
  kind: 'policy_renewal'; id: string; href: string
  carrier: string; policyType: string; expiry: string; daysLeft: number
}
// Active policies whose expiry date is already in the past are stale
// DATA, not renewal decisions — they collapse into one hygiene row.
export type PolicyHygieneSignal = {
  kind: 'policy_hygiene'; id: string; href: string; count: number
}
export type DecisionSignal =
  BidsReadySignal | CancelWindowSignal | PolicyRenewalSignal | PolicyHygieneSignal

// The Decisions lane renders at most this many rows ("+N more decisions").
export const DECISIONS_CAP = 8

// Raw decisions source rows as the server queries them — passed through
// to the client so days-left labels derive from the client's today.
export type DecisionContractRow = { id: string; title: string; vendor_name: string; cancel_deadline: string }
export type DecisionPolicyRow = { id: string; carrier: string; policy_type: string; expiry_date: string }

// Decisions assembly: bid decks ready to decide first (the money is
// already gathered — deciding is pure upside), then the date-driven
// windows (contract cancel deadlines, policy renewals) soonest first.
// Active-but-expired policies (the server query's lower bound admits
// only the last 7 days of them) collapse into a single trailing
// data-hygiene row instead of masquerading as N renewal decisions.
export function assembleDecisions(input: {
  capex: CapexSignalRow[] | null
  contracts: DecisionContractRow[] | null
  policies: DecisionPolicyRow[] | null
}, today: string): DecisionSignal[] {
  const bidsReady: BidsReadySignal[] = (input.capex ?? [])
    .map(p => ({ p, g: bidGlance(p.bids, p.bids_target) }))
    .filter(x => x.g.state === 'ready')
    .map(({ p, g }) => ({
      kind: 'bids_ready', id: `bids:${p.id}`, href: `/capex/${p.id}`,
      project: p.title, propertyName: p.propertyName, received: g.received,
    }))

  const upcoming = (input.policies ?? []).filter(p => p.expiry_date >= today)
  const expiredCount = (input.policies ?? []).length - upcoming.length

  const dated: (CancelWindowSignal | PolicyRenewalSignal)[] = [
    ...(input.contracts ?? []).map((c): CancelWindowSignal => ({
      kind: 'cancel_window', id: `cancel:${c.id}`, href: '/documents',
      vendor: c.vendor_name, title: c.title, deadline: c.cancel_deadline,
    })),
    ...upcoming.map((p): PolicyRenewalSignal => ({
      kind: 'policy_renewal', id: `policy:${p.id}`, href: '/insurance/policies',
      carrier: p.carrier, policyType: p.policy_type,
      expiry: p.expiry_date, daysLeft: daysBetween(today, p.expiry_date),
    })),
  ].sort((a, b) =>
    (a.kind === 'cancel_window' ? a.deadline : a.expiry)
      .localeCompare(b.kind === 'cancel_window' ? b.deadline : b.expiry))

  const hygiene: PolicyHygieneSignal[] = expiredCount > 0
    ? [{ kind: 'policy_hygiene', id: 'policy-hygiene', href: '/insurance/policies', count: expiredCount }]
    : []

  return [...bidsReady, ...dated, ...hygiene]
}

// ── THIS WEEK ────────────────────────────────────────────────

export type WeekdayGroup = { date: string; label: string; tasks: DashboardTask[] }

// My tasks due within the next 7 days, EXCLUDING today's (those live in
// the Today lane), grouped by weekday. Same mine/unblocked predicates
// as the agenda; the snooze rule is forecast-shaped: a task snoozed to
// a date on or before its due date will have woken by then, so it still
// belongs in the week plan — only a snooze past the due date parks it.
export function selectWeekTasks(
  tasks: DashboardTask[], userId: string | null, today: string
): WeekdayGroup[] {
  const in7 = addDaysToDate(today, 7)
  const byId = new Map(tasks.map(t => [t.id, t]))
  const week = topLevel(tasks)
    .filter(t =>
      t.status !== 'done' && isMine(t, userId) && isUnblocked(t, byId) &&
      t.due_date != null && t.due_date > today && t.due_date <= in7 &&
      (isAwake(t, today) || (t.snoozed_until != null && t.snoozed_until <= t.due_date)))
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
  const groups = new Map<string, DashboardTask[]>()
  for (const t of week) {
    const arr = groups.get(t.due_date as string)
    if (arr) arr.push(t)
    else groups.set(t.due_date as string, [t])
  }
  return Array.from(groups.entries()).map(([date, dayTasks]) => ({
    date,
    label: format(parseISO(date), 'EEEE · MMM d'),
    tasks: dayTasks,
  }))
}

export type WaitingBidsSignal = {
  kind: 'waiting_bids'; id: string; href: string
  project: string; propertyName: string | null
  vendors: string[]; oldestRequestDays: number | null
}

// Bid decks still gathering with requests outstanding — "waiting on
// {vendors} · {age}d", longest wait first.
export function selectWaitingBids(capex: CapexSignalRow[] | null, today: string): WaitingBidsSignal[] {
  return (capex ?? [])
    .map(p => ({ p, g: bidGlance(p.bids, p.bids_target) }))
    .filter(x => x.g.state === 'gathering' && x.g.requested > 0)
    .map(({ p, g }) => {
      const requestDates = p.bids
        .filter(b => b.status === 'requested' && b.requested_at != null)
        .map(b => (b.requested_at as string).slice(0, 10))
        .sort()
      return {
        kind: 'waiting_bids' as const, id: `waiting:${p.id}`, href: `/capex/${p.id}`,
        project: p.title, propertyName: p.propertyName, vendors: g.outstandingVendors,
        oldestRequestDays: requestDates.length > 0 ? Math.max(0, daysBetween(requestDates[0], today)) : null,
      }
    })
    .sort((a, b) => (b.oldestRequestDays ?? -1) - (a.oldestRequestDays ?? -1))
}

export type SeasonalWindowLine = { key: string; label: string }

// One alert_settings row as the dashboard fetches it (global rows have
// property_id null; property rows override them).
export type SeasonSettingRow = { property_id: string | null; setting_key: string; value: unknown }

// Seasonal bid windows currently open, resolved PER ACTIVE PROPERTY in
// the same order the obligations engine uses (property row → global row
// → code defaults, via the engine's own resolveSeasonConfig in
// lib/tasks/seasonal.ts). A cycle shows one informational line when its
// window is open for at least one property — "open for N properties ·
// due {earliest due date among them}" — and is hidden when open for
// none; the engine's generated tasks carry the actual work.
export function seasonalWindows(
  today: string, settings: SeasonSettingRow[], activePropertyIds: string[]
): SeasonalWindowLine[] {
  const settingFor = (spec: SeasonSpec, propertyId: string | null) =>
    settings.find(s => s.setting_key === spec.setting_key && s.property_id === propertyId)?.value
  return SEASONS.flatMap(spec => {
    const globalValue = settingFor(spec, null)
    const dueDates = activePropertyIds
      .map(pid => {
        const cfg = resolveSeasonConfig(spec, globalValue, settingFor(spec, pid))
        return cfg.enabled ? seasonDueDate(cfg, today) : null
      })
      .filter((d): d is string => d != null)
      .sort()
    if (dueDates.length === 0) return []
    const n = dueDates.length
    const label = spec.label.charAt(0).toUpperCase() + spec.label.slice(1)
    return [{
      key: spec.auto_source,
      label: `${label} bid season — open for ${n} propert${n === 1 ? 'y' : 'ies'} · due ${formatDateShort(dueDates[0])}`,
    }]
  })
}
