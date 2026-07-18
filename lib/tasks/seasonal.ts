// Seasonal bid cycles — pure calendar/matching logic for the obligations
// engine (app/api/tasks/expiration/route.ts). Kept free of Supabase and
// Next imports so the season-window / year-keying / escalation / resolve
// rules are unit-testable in isolation.
//
// The cycle (Colorado + Casper WY properties — real winters):
//   • Snow removal bids:  task appears Sep 1, due Oct 15, each year.
//   • Landscaping bids:   task appears Feb 1, due Mar 15, each year.
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

export type SeasonSpec = {
  auto_source: string
  /** Human label used in the task title: "Gather {label} bids — {property}". */
  label: string
  /** Signing a matching ACTIVE contract of this type auto-resolves the task. */
  contract_type: string
  /** First day the task should exist. */
  start: MonthDay
  /** The task's due date. */
  due: MonthDay
  /** Last day the engine will still CREATE the task (season close guard). */
  seasonEnd: MonthDay
}

export const SNOW_BID_START: MonthDay = { month: 9, day: 1 }   // Sep 1
export const SNOW_BID_DUE: MonthDay = { month: 10, day: 15 }   // Oct 15
export const SNOW_BID_SEASON_END: MonthDay = { month: 11, day: 30 } // Nov 30

export const LANDSCAPING_BID_START: MonthDay = { month: 2, day: 1 }  // Feb 1
export const LANDSCAPING_BID_DUE: MonthDay = { month: 3, day: 15 }   // Mar 15
export const LANDSCAPING_BID_SEASON_END: MonthDay = { month: 5, day: 31 } // May 31

export const SEASONS: SeasonSpec[] = [
  {
    auto_source: SNOW_BIDS_SOURCE,
    label: 'snow removal',
    contract_type: SNOW_CONTRACT_TYPE,
    start: SNOW_BID_START,
    due: SNOW_BID_DUE,
    seasonEnd: SNOW_BID_SEASON_END,
  },
  {
    auto_source: LANDSCAPING_BIDS_SOURCE,
    label: 'landscaping',
    contract_type: LANDSCAPING_CONTRACT_TYPE,
    start: LANDSCAPING_BID_START,
    due: LANDSCAPING_BID_DUE,
    seasonEnd: LANDSCAPING_BID_SEASON_END,
  },
]

/** YYYY-MM-DD for a month/day in a given year. */
function md(year: number, { month, day }: MonthDay): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * If `today` (YYYY-MM-DD) falls inside the season's creation window
 * (start..seasonEnd, both windows sit inside one calendar year), returns
 * the season's due date; otherwise null. The due date's year IS the
 * season year used for dedupe.
 */
export function seasonDueDate(spec: SeasonSpec, today: string): string | null {
  const year = Number(today.slice(0, 4))
  if (today < md(year, spec.start)) return null
  if (today > md(year, spec.seasonEnd)) return null
  return md(year, spec.due)
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
