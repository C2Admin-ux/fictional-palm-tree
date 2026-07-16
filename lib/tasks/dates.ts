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
  const dow = getDay(parseISO(from)) // 0 = Sunday … 6 = Saturday
  const days = ((1 - dow + 7) % 7) || 7
  return addDaysToDate(from, days)
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

// ── Due-date grouping (property Tasks tab) ───────────────────

export type DueGroupKey = 'overdue' | 'today' | 'week' | 'later' | 'nodate'

const DUE_GROUP_LABELS: Record<DueGroupKey, string> = {
  overdue: 'Overdue',
  today:   'Today',
  week:    'This week',
  later:   'Later',
  nodate:  'No date',
}

export function groupByDue<T extends { due_date: string | null }>(
  tasks: T[], today: string = todayISO()
): { key: DueGroupKey; label: string; tone?: 'red'; tasks: T[] }[] {
  const in7 = addDaysToDate(today, 7)
  return [
    { key: 'overdue' as const, tone: 'red' as const, tasks: tasks.filter(t => t.due_date != null && t.due_date < today) },
    { key: 'today' as const,   tasks: tasks.filter(t => t.due_date === today) },
    { key: 'week' as const,    tasks: tasks.filter(t => t.due_date != null && t.due_date > today && t.due_date <= in7) },
    { key: 'later' as const,   tasks: tasks.filter(t => t.due_date != null && t.due_date > in7) },
    { key: 'nodate' as const,  tasks: tasks.filter(t => !t.due_date) },
  ].map(g => ({ ...g, label: DUE_GROUP_LABELS[g.key] }))
}
