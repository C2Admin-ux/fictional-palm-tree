import type { RenewalSetting, Task } from '@/lib/supabase/types'
import { format, parseISO } from 'date-fns'
import { addDaysToDate, daysBetween } from '@/lib/utils'

// Renewal cycle logic — pure functions, shared by the sync route (server)
// and the renewals board (client) so the two can never disagree about
// whether a cycle is late.
//
// The app TRACKS renewal email traffic; it never composes or sends any of
// it. Every leg below is a date somebody marks after doing the thing in
// Gmail.

// ── Defaults ─────────────────────────────────────────────────
// A property with no renewal_settings row uses these, so the generator
// produces cycles for a newly added property without any setup first.

// Days before the expiration month BEGINS that offers are due. The PMs'
// own stated standard was 90 ("we would like to have these reviewed and
// approved 90 days in advance"), but in practice offers land far later —
// Nick moved the house default to 60 (2026-09-01) so the tracker chases
// against a date the PMs can actually hit.
export const DEFAULT_LEAD_DAYS = 60

// How far ahead cycles are generated. Six months comfortably covers a
// 90-day lead plus the runway to see the next cycle coming.
export const HORIZON_MONTHS = 6

// How far back the sync and the board load cycles. Bounds growth — the
// backlog would otherwise be walked nightly forever (~100 rows/property-
// year). A cycle more than a year past its expiration month is history,
// not work; it stays in the table, just out of the working set.
export const FETCH_FLOOR_MONTHS = 12

export type RenewalSource = 'email' | 'sheet'

export type CadenceConfig = {
  enabled: boolean
  leadDays: number
  requiresPartnerApproval: boolean
  partnerLabel: string | null
  source: RenewalSource
  sourceUrl: string | null
}

export const DEFAULT_CADENCE: CadenceConfig = {
  enabled: true,
  leadDays: DEFAULT_LEAD_DAYS,
  requiresPartnerApproval: false,
  partnerLabel: null,
  source: 'email',
  sourceUrl: null,
}

// Settings row → config, defaulting every field individually so a
// half-filled row can't produce a nonsense cadence. lead_days is clamped:
// a 0 or negative value would make every cycle instantly overdue, and
// anything past a year is a typo.
export function cadenceOf(setting: RenewalSetting | null | undefined): CadenceConfig {
  if (!setting) return DEFAULT_CADENCE
  const lead = Number(setting.lead_days)
  return {
    enabled: setting.enabled ?? true,
    leadDays: Number.isFinite(lead) && lead >= 1 && lead <= 365 ? Math.round(lead) : DEFAULT_LEAD_DAYS,
    requiresPartnerApproval: setting.requires_partner_approval ?? false,
    partnerLabel: setting.partner_label?.trim() || null,
    source: setting.source === 'sheet' ? 'sheet' : 'email',
    sourceUrl: setting.source_url?.trim() || null,
  }
}

// ── Month arithmetic ─────────────────────────────────────────
// Dates are handled as YYYY-MM-DD strings throughout, matching the rest
// of the app — no Date objects, so no timezone can shift a month boundary.

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

export function addMonths(monthIso: string, n: number): string {
  const year = Number(monthIso.slice(0, 4))
  const month = Number(monthIso.slice(5, 7))
  const total = year * 12 + (month - 1) + n
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`
}

// The expiration months the generator should have rows for: the current
// month through HORIZON_MONTHS ahead. The current month is included so a
// cycle that was never tracked still shows up (already overdue) rather
// than silently falling off the front of the board.
export function horizonMonths(today: string, horizon = HORIZON_MONTHS): string[] {
  const start = monthStart(today)
  return Array.from({ length: horizon + 1 }, (_, i) => addMonths(start, i))
}

// Offers for a month are due leadDays before that month begins.
export function cycleDueDate(expirationMonth: string, leadDays: number): string {
  return addDaysToDate(expirationMonth, -leadDays)
}

// "October 2026" — the label everyone uses for a cycle. date-fns like the
// rest of the app's formatters (parseISO of a date-only string is local
// midnight, so the month can't shift).
export function monthLabel(monthIso: string): string {
  return format(parseISO(monthIso), 'MMMM yyyy')
}

// "Oct" — for compact month lists in chase task titles.
export function shortMonth(monthIso: string): string {
  return format(parseISO(monthIso), 'MMM')
}

// ── Stage ────────────────────────────────────────────────────
// Derived from the date columns, never stored. The order is the real
// sequence: the PM sends, we approve, and on Fox Hill the equity partner
// approves after us.

export type RenewalStage = 'awaiting_offer' | 'awaiting_approval' | 'awaiting_partner' | 'complete'

export const STAGE_LABELS: Record<RenewalStage, string> = {
  awaiting_offer: 'Awaiting offers',
  awaiting_approval: 'Awaiting your approval',
  awaiting_partner: 'Awaiting partner approval',
  complete: 'Complete',
}

export const STAGE_STYLES: Record<RenewalStage, string> = {
  awaiting_offer: 'text-slate-600 bg-slate-50 border-slate-200',
  awaiting_approval: 'text-blue-700 bg-blue-50 border-blue-200',
  awaiting_partner: 'text-violet-700 bg-violet-50 border-violet-200',
  complete: 'text-emerald-700 bg-emerald-50 border-emerald-200',
}

// The minimal shape the stage/overdue helpers need — satisfied by
// RenewalCycle and by the lighter rows the board selects.
export type StageableCycle = {
  offer_received_at: string | null
  approved_at: string | null
  partner_approved_at: string | null
  due_date: string
}

// An approval implies the offers existed, even when the received date was
// never recorded — the backfill deliberately ships such rows (approval
// evidenced in email, arrival date not found). Stage and overdue must
// both honor that, or an approved cycle reads as "awaiting offers" and
// gets chased forever.
export function cycleStage(cycle: StageableCycle, requiresPartner: boolean): RenewalStage {
  if (!cycle.offer_received_at && !cycle.approved_at) return 'awaiting_offer'
  if (!cycle.approved_at) return 'awaiting_approval'
  if (requiresPartner && !cycle.partner_approved_at) return 'awaiting_partner'
  return 'complete'
}

// Late means the PM owes us offers and the due date has passed. A cycle
// waiting on OUR approval is not "overdue" in this sense — that's our own
// queue, and the board shows it separately. Nothing chases us but us.
export function isOverdue(cycle: StageableCycle, today: string): boolean {
  return cycleStage(cycle, false) === 'awaiting_offer' && cycle.due_date < today
}

export function daysLate(cycle: StageableCycle, today: string): number {
  if (!isOverdue(cycle, today)) return 0
  return daysBetween(cycle.due_date, today)
}

// Turnaround on our own side: offers in hand → approval sent. Null while
// either end is missing. This is the number that answers "were we the
// hold-up", and the reason approved_at is worth a column at all.
export function approvalTurnaroundDays(cycle: StageableCycle): number | null {
  if (!cycle.offer_received_at || !cycle.approved_at) return null
  return daysBetween(cycle.offer_received_at, cycle.approved_at)
}

// ── Review tasks ─────────────────────────────────────────────
// ONE task per property — "Review {property} renewal offers — Oct + Nov
// 2026" — keyed (auto_source, source_record_id = property id). Nick's
// shape (2026-08-21, replacing the per-month chase tasks that stacked
// one per overdue month): the task is fundamentally a REVIEW. Offers in
// hand → review and approve them on the board. Not received → he
// snoozes the task, and when it resurfaces it IS the chase reminder.
// The app never auto-snoozes; snoozing is the human's call.
//
// A cycle rides on the review task while its month is still actionable
// and not yet approved — whether that's awaiting the offers (chase) or
// awaiting his review of offers in hand. Offers arriving EARLY put the
// month on the task before its due date: reviewable now is reviewable.

export type ReviewableCycle = {
  id: string
  expiration_month: string
  due_date: string
  offer_received_at: string | null
  approved_at: string | null
}

export function owedForReview(cycle: ReviewableCycle, today: string): boolean {
  // Months already begun can't get offers anymore — they show as gaps in
  // the history, not on the task (same floor the generator displays).
  if (cycle.expiration_month < monthStart(today)) return false
  if (cycle.approved_at) return false
  return cycle.due_date < today || cycle.offer_received_at != null
}

// "October 2026" for one month; compact for several, grouped by year so
// a Dec + Jan span can't read as one year: "Nov + Dec 2026, Jan 2027".
export function monthListLabel(months: string[]): string {
  const sorted = [...months].sort()
  if (sorted.length === 1) return monthLabel(sorted[0])
  const byYear = new Map<string, string[]>()
  for (const m of sorted) {
    const y = m.slice(0, 4)
    const list = byYear.get(y) ?? []
    list.push(shortMonth(m))
    byYear.set(y, list)
  }
  return Array.from(byYear.entries()).map(([y, ms]) => `${ms.join(' + ')} ${y}`).join(', ')
}

export function reviewTitle(propertyName: string, source: string, months: string[]): string {
  const label = monthListLabel(months)
  // A sheet property has no email traffic — the ask is to go look.
  return source === 'sheet'
    ? `Review ${propertyName} renewal sheet — ${label}`
    : `Review ${propertyName} renewal offers — ${label}`
}

export function reviewDescription(
  owed: ReviewableCycle[], today: string, source: string, sourceUrl: string | null,
): string {
  const lines = [...owed]
    .sort((a, b) => a.expiration_month.localeCompare(b.expiration_month))
    .map(cycle => {
      const label = monthLabel(cycle.expiration_month)
      if (cycle.offer_received_at) {
        return `${label} — offers in hand (received ${cycle.offer_received_at}); review and approve on the Renewals board.`
      }
      const late = daysBetween(cycle.due_date, today)
      return late > 0
        ? `${label} — offers due ${cycle.due_date} (${late}d late), not received.`
        : `${label} — offers due ${cycle.due_date}, not received.`
    })
  if (source === 'sheet') {
    lines.push('This property tracks renewals in a shared spreadsheet rather than by email.')
    // The link is the whole point of the task for a sheet property.
    if (sourceUrl) lines.push(sourceUrl)
  }
  lines.push('Not received yet? Chase the PM, then snooze this task until you expect the offers — when it resurfaces, it IS the chase.')
  lines.push('Auto-managed: months drop off as they are approved on the Renewals board, and the task closes itself once nothing is owed.')
  return lines.join('\n')
}

// The task is due when the oldest owed month's offers were due.
export function reviewDueDate(owed: ReviewableCycle[]): string {
  return owed.map(c => c.due_date).sort()[0]
}

// Escalates the longer a PM sits on missing offers. Months merely
// awaiting Nick's own review don't escalate — nothing chases us but us.
export function reviewPriority(owed: ReviewableCycle[], today: string): Task['priority'] {
  const late = owed
    .filter(c => !c.offer_received_at && c.due_date < today)
    .map(c => daysBetween(c.due_date, today))
  return chasePriority(late.length > 0 ? Math.max(...late) : 0)
}

// Deliberately starts at medium: a cycle one day late is a nudge, not an
// emergency.
export function chasePriority(daysOverdue: number): Task['priority'] {
  if (daysOverdue >= 30) return 'urgent'
  if (daysOverdue >= 14) return 'high'
  return 'medium'
}

// ── Renewal-rate entry tasks ─────────────────────────────────
// A month's rate is knowable once the month CLOSES (move-outs final).
// The sync creates one entry task per property for the most recent
// closed month with no rate — per property by Nick's explicit choice
// (2026-08-14): different PMs report at different times, and each task
// closes as that property's number lands.

// The most recent fully-closed month: last month.
export function lastClosedMonth(today: string): string {
  return addMonths(monthStart(today), -1)
}

// Due one week into the following month — enough time for the PM's
// month-end report to land, early enough that the number is entered
// while the month is still fresh.
export function rateTaskDueDate(expirationMonth: string): string {
  return `${addMonths(expirationMonth, 1).slice(0, 8)}07`
}

export function rateTaskTitle(expirationMonth: string, propertyName: string): string {
  return `Enter ${monthLabel(expirationMonth)} renewal rate — ${propertyName}`
}

export function rateTaskDescription(expirationMonth: string, propertyName: string): string {
  return [
    `Percent of leases expiring in ${monthLabel(expirationMonth)} at ${propertyName} that renewed.`,
    'Enter it in the rate table on the Renewals board.',
    'Auto-managed: resolves itself when the rate is entered.',
  ].join('\n')
}

// Simple mean of the entered rates — with hand-entered percentages there
// is no denominator to weight by. Unit-weighting arrives with rent-roll
// ingestion (phase 2), which carries the counts.
export function portfolioRate(rates: (number | null)[]): number | null {
  const entered = rates.filter((r): r is number => r != null)
  if (entered.length === 0) return null
  return Math.round(entered.reduce((s, r) => s + r, 0) / entered.length)
}

// The matrix's columns: the N most recent CLOSED months, oldest first —
// the current month is still accumulating outcomes and would read as a
// misleadingly low rate.
export function closedMonths(today: string, count: number): string[] {
  const last = lastClosedMonth(today)
  return Array.from({ length: count }, (_, i) => addMonths(last, -(count - 1 - i)))
}
