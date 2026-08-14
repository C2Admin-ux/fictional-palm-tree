import type { RenewalSetting, Task } from '@/lib/supabase/types'
import { addDaysToDate } from '@/lib/utils'

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

// Days before the expiration month BEGINS that offers are due. 90 is the
// standard the PMs stated themselves ("we would like to have these
// reviewed and approved 90 days in advance").
export const DEFAULT_LEAD_DAYS = 90

// How far ahead cycles are generated. Six months comfortably covers a
// 90-day lead plus the runway to see the next cycle coming.
export const HORIZON_MONTHS = 6

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

// "October 2026" — the label everyone uses for a cycle.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function monthLabel(monthIso: string): string {
  const m = Number(monthIso.slice(5, 7))
  return `${MONTH_NAMES[m - 1] ?? monthIso.slice(5, 7)} ${monthIso.slice(0, 4)}`
}

export function shortMonthLabel(monthIso: string): string {
  const m = Number(monthIso.slice(5, 7))
  return `${(MONTH_NAMES[m - 1] ?? '???').slice(0, 3)} ${monthIso.slice(2, 4)}`
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

export function cycleStage(cycle: StageableCycle, requiresPartner: boolean): RenewalStage {
  if (!cycle.offer_received_at) return 'awaiting_offer'
  if (!cycle.approved_at) return 'awaiting_approval'
  if (requiresPartner && !cycle.partner_approved_at) return 'awaiting_partner'
  return 'complete'
}

// Late means the PM owes us offers and the due date has passed. A cycle
// waiting on OUR approval is not "overdue" in this sense — that's our own
// queue, and the board shows it separately. Nothing chases us but us.
export function isOverdue(cycle: StageableCycle, today: string): boolean {
  return !cycle.offer_received_at && cycle.due_date < today
}

export function daysLate(cycle: StageableCycle, today: string): number {
  if (!isOverdue(cycle, today)) return 0
  return daysBetween(cycle.due_date, today)
}

function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

// Turnaround on our own side: offers in hand → approval sent. Null while
// either end is missing. This is the number that answers "were we the
// hold-up", and the reason approved_at is worth a column at all.
export function approvalTurnaroundDays(cycle: StageableCycle): number | null {
  if (!cycle.offer_received_at || !cycle.approved_at) return null
  return daysBetween(cycle.offer_received_at, cycle.approved_at)
}

// ── Chase tasks ──────────────────────────────────────────────
// One task per overdue cycle, keyed (auto_source, source_record_id =
// cycle id) exactly like the obligations engine, so the same
// create/update/auto-resolve reconciliation applies.

export function chaseTitle(cycle: { expiration_month: string; source: string }, propertyName: string): string {
  const month = monthLabel(cycle.expiration_month)
  // A sheet property has no email to chase — the ask is to go look.
  return cycle.source === 'sheet'
    ? `Review ${propertyName} renewal sheet for ${month}`
    : `Chase ${propertyName} ${month} renewal offers`
}

export function chaseDescription(
  cycle: { expiration_month: string; source: string; source_url: string | null; due_date: string },
): string {
  const lines = [
    `Renewal offers for ${monthLabel(cycle.expiration_month)} were due ${cycle.due_date}.`,
  ]
  if (cycle.source === 'sheet') {
    lines.push('This property tracks renewals in a shared spreadsheet rather than by email.')
    // The link is the whole point of the task for a sheet property.
    if (cycle.source_url) lines.push(cycle.source_url)
  }
  return lines.join('\n')
}

// Escalates the longer a PM sits on it. Deliberately starts at medium:
// a cycle one day late is a nudge, not an emergency.
export function chasePriority(daysOverdue: number): Task['priority'] {
  if (daysOverdue >= 30) return 'urgent'
  if (daysOverdue >= 14) return 'high'
  return 'medium'
}
