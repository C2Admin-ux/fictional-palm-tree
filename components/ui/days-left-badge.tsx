'use client'

import { cn } from '@/lib/utils'
import { daysUntil, TRAFFIC_LIGHT, type TrafficLight } from '@/lib/utils'

// ── DaysLeftBadge ────────────────────────────────────────────
// Shows how many days remain until `date`, coloured by threshold.
// Defaults: <= red 30, <= yellow 60, <= green 90, else neutral.
// Overdue (negative) is always red.

function thresholdLight(
  days: number | null,
  red: number, yellow: number, green: number,
): TrafficLight {
  if (days == null) return 'gray'
  if (days < 0 || days <= red) return 'red'
  if (days <= yellow) return 'yellow'
  if (days <= green) return 'green'
  return 'gray'
}

export function DaysLeftBadge({
  date, red = 30, yellow = 60, green = 90,
  overdueLabel = 'Overdue', emptyLabel = '—', className = '',
}: {
  date: string | null | undefined
  red?: number
  yellow?: number
  green?: number
  overdueLabel?: string
  emptyLabel?: string
  className?: string
}) {
  const days = daysUntil(date)
  if (days == null) return <span className="text-slate-300 text-xs italic">{emptyLabel}</span>

  const light = thresholdLight(days, red, yellow, green)
  const text = days < 0 ? overdueLabel : days === 0 ? 'Today' : `${days}d`

  return <span className={cn('badge', TRAFFIC_LIGHT[light], className)}>{text}</span>
}
