'use client'

import {
  cn, STATUS_STYLES, STATUS_LABELS, PRIORITY_STYLES,
  CAPEX_STATUS_STYLES, CLAIM_STATUS_STYLES, TRAFFIC_LIGHT,
  type TrafficLight,
} from '@/lib/utils'

// ── StatusBadge ──────────────────────────────────────────────
// A pill driven by the shared style maps in lib/utils. Pick the
// map with `kind`; the value keys into that map for its colors.

const STYLE_MAPS = {
  status: STATUS_STYLES,
  priority: PRIORITY_STYLES,
  capex: CAPEX_STATUS_STYLES,
  claim: CLAIM_STATUS_STYLES,
} as const

export type BadgeKind = keyof typeof STYLE_MAPS

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function StatusBadge({
  value, kind = 'status', label, className = '',
}: {
  value: string | null | undefined
  kind?: BadgeKind
  label?: string
  className?: string
}) {
  if (!value) return <span className="text-slate-300 text-xs italic">—</span>

  const style = STYLE_MAPS[kind][value] ?? 'text-slate-500 bg-slate-50 border-slate-200'
  const text = label
    ?? (kind === 'status' ? STATUS_LABELS[value] : undefined)
    ?? humanize(value)

  return <span className={cn('badge', style, className)}>{text}</span>
}

// ── TrafficBadge ─────────────────────────────────────────────
// A pill coloured by a traffic-light value (green/yellow/red/gray).

export function TrafficBadge({
  light, children, className = '',
}: {
  light: TrafficLight
  children: React.ReactNode
  className?: string
}) {
  return <span className={cn('badge', TRAFFIC_LIGHT[light], className)}>{children}</span>
}
