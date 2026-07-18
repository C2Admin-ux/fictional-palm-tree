// Seasonal bid cycles — pure calendar/matching logic for the obligations
// engine (app/api/tasks/expiration/route.ts). Kept free of Supabase and
// Next imports so the season-window / year-keying / escalation / resolve
// rules are unit-testable in isolation.
//
// The cycle (Colorado + Casper WY properties — real winters), DEFAULTS:
//   • Snow removal bids:  task appears Sep 1, due Oct 15, each year.
//   • Landscaping bids:   task appears Feb 1, due Mar 15, each year.
// Windows are customizable per portfolio/property via alert_settings
// (migration 0007; Settings → Alerts) — thin markets like Casper start
// bidding earlier. The constants below stay the documented fallbacks.
// Tasks are keyed per (auto_source, property, season YEAR) — the year is
// carried by due_date, so the Sep 2026 task and the Sep 2027 task are
// distinct rows and completing one year never blocks the next.
// A season's task is only CREATED inside its window (start → seasonEnd);
// once the season is over, creating a task with a months-past due date is
// noise, so the engine skips it — but tasks that already exist keep
// escalating and can still auto-resolve year-round.

import { LANDSCAPING_BIDS_SOURCE, SNOW_BIDS_SOURCE } from '@/lib/tasks/vocab'

// Contract types whose signing concludes a bid cycle (and which the
// contract tracker treats as seasonal for supersede purposes — entering
// next year's contract archives last year's even under a new vendor).
export const SNOW_CONTRACT_TYPE = 'snow_removal'
export const LANDSCAPING_CONTRACT_TYPE = 'landscaping'
export const SEASONAL_CONTRACT_TYPES: string[] = [SNOW_CONTRACT_TYPE, LANDSCAPING_CONTRACT_TYPE]

// Priority escalates medium → high once the due date is this close.
export const SEASONAL_ESCALATE_DAYS = 21

export type MonthDay = { month: number; day: number } // month 1-12

/** Just the calendar window — what seasonDueDate needs. SeasonSpec and
 * resolved per-property configs (SeasonConfig) both satisfy it. */
export type SeasonWindow = {
  /** First day the task should exist. */
  start: MonthDay
  /** The task's due date. */
  due: MonthDay
  /** Last day the engine will still CREATE the task (season close guard). */
  seasonEnd: MonthDay
}

export type SeasonSpec = SeasonWindow & {
  auto_source: string
  /** Human label used in the task title: "Gather {label} bids — {property}". */
  label: string
  /** Signing a matching ACTIVE contract of this type auto-resolves the task. */
  contract_type: string
  /** alert_settings.setting_key that overrides this cycle's window. */
  setting_key: string
}

export const SNOW_BID_START: MonthDay = { month: 9, day: 1 }   // Sep 1
export const SNOW_BID_DUE: MonthDay = { month: 10, day: 15 }   // Oct 15
export const SNOW_BID_SEASON_END: MonthDay = { month: 11, day: 30 } // Nov 30

export const LANDSCAPING_BID_START: MonthDay = { month: 2, day: 1 }  // Feb 1
export const LANDSCAPING_BID_DUE: MonthDay = { month: 3, day: 15 }   // Mar 15
export const LANDSCAPING_BID_SEASON_END: MonthDay = { month: 5, day: 31 } // May 31

// alert_settings keys (see supabase/migrations/0007_alert_settings.sql).
export const SNOW_SETTING_KEY = 'seasonal_snow'
export const LANDSCAPING_SETTING_KEY = 'seasonal_landscaping'
export const OBLIGATION_LEAD_DAYS_KEY = 'obligation_lead_days'

export const SEASONS: SeasonSpec[] = [
  {
    auto_source: SNOW_BIDS_SOURCE,
    label: 'snow removal',
    contract_type: SNOW_CONTRACT_TYPE,
    setting_key: SNOW_SETTING_KEY,
    start: SNOW_BID_START,
    due: SNOW_BID_DUE,
    seasonEnd: SNOW_BID_SEASON_END,
  },
  {
    auto_source: LANDSCAPING_BIDS_SOURCE,
    label: 'landscaping',
    contract_type: LANDSCAPING_CONTRACT_TYPE,
    setting_key: LANDSCAPING_SETTING_KEY,
    start: LANDSCAPING_BID_START,
    due: LANDSCAPING_BID_DUE,
    seasonEnd: LANDSCAPING_BID_SEASON_END,
  },
]

// ── Customizable windows (alert_settings, migration 0007) ────
// A cycle's window can be overridden per property or globally; Casper WY's
// thin vendor market wants snow bids rolling well before the Sep 1 default.
// Resolution order: property row → global row → code constants above.
// All parsing is defensive: a malformed row degrades field-by-field to the
// next config in the chain — settings must never crash the nightly cron.

export type SeasonConfig = SeasonWindow & { enabled: boolean }

export function defaultSeasonConfig(spec: SeasonSpec): SeasonConfig {
  return { enabled: true, start: spec.start, due: spec.due, seasonEnd: spec.seasonEnd }
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] // Feb 29 allowed

/** "MM-DD" → MonthDay, or null if it isn't a real calendar day. */
export function parseMonthDay(value: unknown): MonthDay | null {
  if (typeof value !== 'string' || !/^\d{2}-\d{2}$/.test(value)) return null
  const month = Number(value.slice(0, 2))
  const day = Number(value.slice(3, 5))
  if (month < 1 || month > 12) return null
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return null
  return { month, day }
}

export function formatMonthDay({ month, day }: MonthDay): string {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Parse one alert_settings value ({ enabled, start, due, end } with MM-DD
 * strings) on top of `base` (the next config in the resolution chain).
 * Returns null when there's nothing usable (no row / not an object) so the
 * caller falls through to `base` itself. Malformed fields inherit base's.
 *
 * The window must be in calendar order (start ≤ due ≤ end) — windows sit
 * inside ONE calendar year, which is what keeps the season-year dedupe key
 * (= due date's year = window start's year) stable. An out-of-order or
 * cross-year-looking override keeps base's dates (enabled still applies).
 */
export function parseSeasonSetting(value: unknown, base: SeasonConfig): SeasonConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const enabled = typeof v.enabled === 'boolean' ? v.enabled : base.enabled
  const start = parseMonthDay(v.start) ?? base.start
  const due = parseMonthDay(v.due) ?? base.due
  const seasonEnd = parseMonthDay(v.end) ?? base.seasonEnd
  const s = formatMonthDay(start), d = formatMonthDay(due), e = formatMonthDay(seasonEnd)
  if (!(s <= d && d <= e)) return { enabled, start: base.start, due: base.due, seasonEnd: base.seasonEnd }
  return { enabled, start, due, seasonEnd }
}

/**
 * Resolve a cycle's config for one property: property row → global row →
 * code constants, each layer parsed on top of the next.
 */
export function resolveSeasonConfig(
  spec: SeasonSpec,
  globalValue: unknown | undefined,
  propertyValue: unknown | undefined
): SeasonConfig {
  const defaults = defaultSeasonConfig(spec)
  const globalCfg = parseSeasonSetting(globalValue, defaults) ?? defaults
  return parseSeasonSetting(propertyValue, globalCfg) ?? globalCfg
}

/** { days: n } → n (whole days, 1–365), or null → caller keeps its default. */
export function parseLeadDaysSetting(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const days = (value as Record<string, unknown>).days
  if (typeof days !== 'number' || !Number.isInteger(days)) return null
  if (days < 1 || days > 365) return null
  return days
}

/** YYYY-MM-DD for a month/day in a given year. */
function md(year: number, { month, day }: MonthDay): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * If `today` (YYYY-MM-DD) falls inside the season's creation window
 * (start..seasonEnd — windows always sit inside one calendar year, which
 * parseSeasonSetting enforces for overrides), returns the season's due
 * date; otherwise null. The due date's year IS the season year used for
 * dedupe, and it always equals the window start's year.
 */
export function seasonDueDate(window: SeasonWindow, today: string): string | null {
  const year = Number(today.slice(0, 4))
  if (today < md(year, window.start)) return null
  if (today > md(year, window.seasonEnd)) return null
  return md(year, window.due)
}

/** Season year of an existing task = the year of its due date. */
export function seasonYearOf(dueDate: string): number {
  return Number(dueDate.slice(0, 4))
}

export function seasonalTitle(spec: SeasonSpec, propertyName: string): string {
  return `Gather ${spec.label} bids — ${propertyName}`
}

/** Medium until 21 days out, then high (stays high once past due). */
export function seasonalPriority(today: string, dueDate: string): 'medium' | 'high' {
  const days = Math.round((Date.parse(dueDate) - Date.parse(today)) / (24 * 60 * 60 * 1000))
  return days <= SEASONAL_ESCALATE_DAYS ? 'high' : 'medium'
}

/**
 * Does this ACTIVE contract conclude the bid cycle for this task?
 * True when it's the matching type on the task's property AND it postdates
 * the task: entered after the task appeared (created_at timestamps) or
 * commencing after it (a backdated entry whose service starts this season).
 * Callers pass only status='active' contracts.
 */
export function contractResolvesSeasonalTask(
  contract: { contract_type: string; property_id: string | null; created_at: string; commencement_date: string | null },
  task: { property_id: string | null; created_at: string },
  spec: SeasonSpec
): boolean {
  if (contract.contract_type !== spec.contract_type) return false
  if (contract.property_id == null || contract.property_id !== task.property_id) return false
  return (
    contract.created_at > task.created_at ||
    (contract.commencement_date != null && contract.commencement_date > task.created_at.slice(0, 10))
  )
}
