// Small task-date helpers shared by the quick-add parser, the snooze
// preset menu, and the property Tasks tab grouping. All dates are
// local-calendar yyyy-MM-dd strings (matching <input type="date">).

import { todayISO, addDaysToDate } from '@/lib/utils'
import { addMonths, format, parseISO, getDay } from 'date-fns'

export function tomorrowISO(from: string = todayISO()): string {
  return addDaysToDate(from, 1)
}

// Next Monday strictly after `from` (a Monday maps to the following week).
export function nextMondayISO(from: string = todayISO()): string {
  return nextWeekdayISO(1, from)
}

// Same day next month (clamped to month end by date-fns).
export function nextMonthISO(from: string = todayISO()): string {
  return format(addMonths(parseISO(from), 1), 'yyyy-MM-dd')
}

// Next occurrence of a weekday (0 = Sunday … 6 = Saturday) strictly
// after `from` — typing the current weekday means next week.
export function nextWeekdayISO(weekday: number, from: string = todayISO()): string {
  const dow = getDay(parseISO(from))
  const days = ((weekday - dow + 7) % 7) || 7
  return addDaysToDate(from, days)
}

export const SNOOZE_PRESETS: { key: string; label: string; compute: (today: string) => string }[] = [
  { key: 'tomorrow',   label: 'Tomorrow',        compute: tomorrowISO },
  { key: 'next_week',  label: 'Next week (Mon)', compute: nextMondayISO },
  { key: 'next_month', label: 'Next month',      compute: nextMonthISO },
]

// ── Due-date presets (RTM-style quick set) ───────────────────
// Absolute targets for the due menu. Distinct from SNOOZE_PRESETS on
// purpose: snooze hides a task until a date without moving the deadline;
// these SET the deadline.

export const DUE_PRESETS: { key: string; label: string; compute: (today: string) => string }[] = [
  { key: 'today',      label: 'Today',           compute: t => t },
  { key: 'tomorrow',   label: 'Tomorrow',        compute: tomorrowISO },
  { key: 'next_week',  label: 'Next week (Mon)', compute: nextMondayISO },
  { key: 'next_month', label: 'Next month',      compute: nextMonthISO },
]

// Relative bumps for the same menu, and the `p` key. Postpone means
// "push it out of my face": from the due date when it's still ahead,
// from TODAY when the task is overdue or dateless — +1 day on a task
// five days overdue lands tomorrow, not four-days-overdue (which would
// change nothing the eye can see and make `p` feel broken).
export function postponeDate(due: string | null, days: number, today: string): string {
  const base = due != null && due > today ? due : today
  return addDaysToDate(base, days)
}

export const POSTPONE_STEPS: { key: string; label: string; days: number }[] = [
  { key: 'day',  label: '+1 day',  days: 1 },
  { key: 'week', label: '+1 week', days: 7 },
]

// ── Due-date grouping (tasks page agenda + property Tasks tab) ──
// One bucketing implementation: Overdue / Today / This week /
// Later (unbounded — nothing dated far out ever disappears) / No date.

export type DueGroupKey = 'overdue' | 'today' | 'week' | 'later' | 'nodate'

const DUE_GROUP_LABELS: Record<DueGroupKey, string> = {
  overdue: 'Overdue',
  today:   'Today',
  week:    'This week',
  later:   'Later',
  nodate:  'No date',
}

// ── My Work horizon (tasks page default view) ────────────────
// The Agenda used to render every open task — 'Later' and 'No date'
// fully expanded — so the day's real work (a dozen rows) sat under a
// wall of undated ideas. My Work keeps a two-week FOCUS horizon open
// and folds everything past it into collapsed, counted drawers:
//   Overdue / Today / This week (≤7d) / Next week (8–14d)   — open
//   Later (>14d) / Backlog (undated)                        — folded
export type WorkBucketKey = 'overdue' | 'today' | 'week' | 'next_week' | 'later' | 'backlog'

export const FOCUS_BUCKETS: WorkBucketKey[] = ['overdue', 'today', 'week', 'next_week']
export const FOLDED_BUCKETS: WorkBucketKey[] = ['later', 'backlog']

const WORK_BUCKET_LABELS: Record<WorkBucketKey, string> = {
  overdue:   'Overdue',
  today:     'Today',
  week:      'This week',
  next_week: 'Next week',
  later:     'Later',
  backlog:   'Backlog — no date',
}

export function workBucketOf(due: string | null, today: string = todayISO()): WorkBucketKey {
  if (!due) return 'backlog'
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  if (due <= addDaysToDate(today, 7)) return 'week'
  if (due <= addDaysToDate(today, 14)) return 'next_week'
  return 'later'
}

export function groupForWork<T extends { due_date: string | null }>(
  tasks: T[],
  today: string = todayISO()
): { key: WorkBucketKey; label: string; tone?: 'red'; tasks: T[] }[] {
  const keys: WorkBucketKey[] = [...FOCUS_BUCKETS, ...FOLDED_BUCKETS]
  const by = new Map<WorkBucketKey, T[]>(keys.map(k => [k, []]))
  for (const t of tasks) by.get(workBucketOf(t.due_date, today))!.push(t)
  return keys.map(k => ({
    key: k,
    label: WORK_BUCKET_LABELS[k],
    ...(k === 'overdue' ? { tone: 'red' as const } : {}),
    tasks: by.get(k)!,
  }))
}

// ── Start dates for recurring series ─────────────────────────
// A recurring task's next occurrence used to appear the moment the
// previous one closed — a monthly P&L review sat in the list for ~30
// days before it was relevant. Spawns now carry a start date
// (snoozed_until = "hidden until") a lead time ahead of the due date,
// scaled to the cadence. Null = visible immediately.
const LEAD_DAYS: Record<string, number> = {
  daily: 0, weekly: 2, biweekly: 4, monthly: 7, quarterly: 21, annually: 30,
}

export function recurrenceLeadDays(freq: string | null, interval?: number | null, unit?: string | null): number {
  if (!freq) return 0
  if (freq !== 'custom') return LEAD_DAYS[freq] ?? 0
  const n = Math.max(1, interval ?? 1)
  const periodDays = unit === 'months' ? n * 30 : unit === 'weeks' ? n * 7 : n
  // ~quarter of the period, capped at a month.
  return Math.min(30, Math.floor(periodDays / 4))
}

export function recurrenceStartDate(
  due: string, freq: string | null, today: string = todayISO(),
  interval?: number | null, unit?: string | null
): string | null {
  const lead = recurrenceLeadDays(freq, interval, unit)
  if (lead <= 0) return null
  const start = addDaysToDate(due, -lead)
  return start > today ? start : null
}

export function groupByDue<T extends { due_date: string | null }>(
  tasks: T[],
  today: string = todayISO(),
  labels: Partial<Record<DueGroupKey, string>> = {}
): { key: DueGroupKey; label: string; tone?: 'red'; tasks: T[] }[] {
  const in7 = addDaysToDate(today, 7)
  return [
    { key: 'overdue' as const, tone: 'red' as const, tasks: tasks.filter(t => t.due_date != null && t.due_date < today) },
    { key: 'today' as const,   tasks: tasks.filter(t => t.due_date === today) },
    { key: 'week' as const,    tasks: tasks.filter(t => t.due_date != null && t.due_date > today && t.due_date <= in7) },
    { key: 'later' as const,   tasks: tasks.filter(t => t.due_date != null && t.due_date > in7) },
    { key: 'nodate' as const,  tasks: tasks.filter(t => !t.due_date) },
  ].map(g => ({ ...g, label: labels[g.key] ?? DUE_GROUP_LABELS[g.key] }))
}
