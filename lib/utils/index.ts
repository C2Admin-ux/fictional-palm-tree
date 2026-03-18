import { clsx, type ClassValue } from 'clsx'
import { format, formatDistanceToNow, parseISO, differenceInDays, addDays } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

// ── Formatters ──────────────────────────────────────────────

export function formatCurrency(value: number | null | undefined, compact = false): string {
  if (value == null) return '—'
  if (compact && Math.abs(value) >= 1_000_000)
    return `$${(value / 1_000_000).toFixed(1)}M`
  if (compact && Math.abs(value) >= 1_000)
    return `$${(value / 1_000).toFixed(0)}K`
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(value)
}

export function formatPct(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '—'
  return `${value.toFixed(decimals)}%`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  try { return format(parseISO(value), 'MMM d, yyyy') } catch { return value }
}

export function formatDateShort(value: string | null | undefined): string {
  if (!value) return '—'
  try { return format(parseISO(value), 'MMM d') } catch { return value }
}

export function formatMonthYear(value: string | null | undefined): string {
  if (!value) return '—'
  try { return format(parseISO(value), 'MMM yy') } catch { return value }
}

export function firstOfMonth(date?: Date): string {
  const d = date ?? new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null
  return differenceInDays(parseISO(date), new Date())
}

export function isOverdue(date: string | null | undefined): boolean {
  const d = daysUntil(date)
  return d != null && d < 0
}

export function isSoon(date: string | null | undefined, days = 7): boolean {
  const d = daysUntil(date)
  return d != null && d >= 0 && d <= days
}

export function dueDateState(date: string | null | undefined): 'over' | 'soon' | 'ok' {
  if (!date) return 'ok'
  if (isOverdue(date)) return 'over'
  if (isSoon(date, 7)) return 'soon'
  return 'ok'
}

export function addDaysToDate(date: string, days: number): string {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd')
}

// ── Traffic light thresholds ────────────────────────────────

export type TrafficLight = 'green' | 'yellow' | 'red' | 'gray'

export function occupancyColor(pct: number | null | undefined): TrafficLight {
  if (pct == null) return 'gray'
  if (pct >= 94) return 'green'
  if (pct >= 90) return 'yellow'
  return 'red'
}

export function delinquencyColor(pct: number | null | undefined): TrafficLight {
  if (pct == null) return 'gray'
  if (pct <= 2) return 'green'
  if (pct <= 5) return 'yellow'
  return 'red'
}

export function noiVarianceColor(
  actual: number | null, budget: number | null
): TrafficLight {
  if (actual == null || budget == null || budget === 0) return 'gray'
  const variance = (actual - budget) / Math.abs(budget)
  if (variance >= -0.05) return 'green'
  if (variance >= -0.15) return 'yellow'
  return 'red'
}

export function workOrderCloseRateColor(opened: number | null | undefined, closed: number | null | undefined): TrafficLight {
  if (opened == null || closed == null || opened === 0) return 'gray'
  const rate = closed / opened
  if (rate >= 0.9) return 'green'
  if (rate >= 0.75) return 'yellow'
  return 'red'
}

export function expiryColor(daysLeft: number | null): TrafficLight {
  if (daysLeft == null) return 'gray'
  if (daysLeft < 0) return 'red'
  if (daysLeft <= 30) return 'red'
  if (daysLeft <= 60) return 'yellow'
  return 'green'
}

// ── Style maps ───────────────────────────────────────────────

export const TRAFFIC_LIGHT: Record<TrafficLight, string> = {
  green:  'text-emerald-700 bg-emerald-50 border-emerald-200',
  yellow: 'text-amber-700 bg-amber-50 border-amber-200',
  red:    'text-red-700 bg-red-50 border-red-200',
  gray:   'text-slate-500 bg-slate-50 border-slate-200',
}

export const TRAFFIC_DOT: Record<TrafficLight, string> = {
  green:  'bg-emerald-500',
  yellow: 'bg-amber-400',
  red:    'bg-red-500',
  gray:   'bg-slate-300',
}

export const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'text-red-700 bg-red-50 border-red-200',
  high:   'text-orange-700 bg-orange-50 border-orange-200',
  medium: 'text-blue-700 bg-blue-50 border-blue-200',
  low:    'text-slate-500 bg-slate-50 border-slate-200',
}

export const PRIORITY_DOT: Record<string, string> = {
  urgent: '#ef4444',
  high:   '#f97316',
  medium: '#3b82f6',
  low:    '#94a3b8',
}

export const STATUS_STYLES: Record<string, string> = {
  inbox:       'text-indigo-700 bg-indigo-50 border-indigo-200',
  next_action: 'text-blue-700 bg-blue-50 border-blue-200',
  waiting:     'text-purple-700 bg-purple-50 border-purple-200',
  blocked:     'text-amber-700 bg-amber-50 border-amber-200',
  done:        'text-slate-500 bg-slate-50 border-slate-200',
}

export const STATUS_LABELS: Record<string, string> = {
  inbox:       'Inbox',
  next_action: 'Next action',
  waiting:     'Waiting',
  blocked:     'Blocked',
  done:        'Done',
}

export const CAPEX_STATUS_STYLES: Record<string, string> = {
  planning:    'text-slate-600 bg-slate-50 border-slate-200',
  approved:    'text-blue-700 bg-blue-50 border-blue-200',
  in_progress: 'text-amber-700 bg-amber-50 border-amber-200',
  complete:    'text-emerald-700 bg-emerald-50 border-emerald-200',
  on_hold:     'text-orange-700 bg-orange-50 border-orange-200',
}

export const CAPEX_STATUS_DOT: Record<string, string> = {
  planning:    '#94a3b8',
  approved:    '#3b82f6',
  in_progress: '#f97316',
  complete:    '#16a34a',
  on_hold:     '#ef4444',
}

export const CLAIM_STATUS_STYLES: Record<string, string> = {
  reported:     'text-blue-700 bg-blue-50 border-blue-200',
  under_review: 'text-amber-700 bg-amber-50 border-amber-200',
  negotiating:  'text-purple-700 bg-purple-50 border-purple-200',
  settlement:   'text-emerald-700 bg-emerald-50 border-emerald-200',
  closed:       'text-slate-500 bg-slate-50 border-slate-200',
  denied:       'text-red-700 bg-red-50 border-red-200',
}

export const PROPERTY_COLORS: Record<string, string> = {
  'Fox Hill Apartments':       '#1D9E75',
  'Pikes Place on San Miguel': '#D85A30',
  'Cottages on Vance':         '#7F77DD',
  'Main Street Apartments':    '#BA7517',
}

export function propertyColor(name: string | null | undefined): string {
  if (!name) return '#64748b'
  return PROPERTY_COLORS[name] ?? '#64748b'
}

// ── Recurrence helpers ───────────────────────────────────────

export const RECUR_LABELS: Record<string, string> = {
  daily:     'Daily',
  weekly:    'Weekly',
  biweekly:  'Every 2 weeks',
  monthly:   'Monthly',
  quarterly: 'Quarterly',
  annually:  'Annually',
  custom:    'Custom',
}

export const RECUR_DAYS: Record<string, number> = {
  daily: 1, weekly: 7, biweekly: 14,
  monthly: 30, quarterly: 91, annually: 365,
}
