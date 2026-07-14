'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'

// ── StatTile ─────────────────────────────────────────────────
// Label + big number + optional sub-line / icon, optionally a link.
// Mirrors the dashboard KpiCard.

export function StatTile({
  label, value, sub, icon, alert, href, className = '',
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  icon?: React.ReactNode
  alert?: boolean
  href?: string
  className?: string
}) {
  const inner = (
    <div className={cn('card p-4 h-full', className)}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
        {icon && <span className={alert ? 'text-red-400' : 'text-slate-300'}>{icon}</span>}
      </div>
      <div className={cn('text-2xl font-semibold mt-1', alert ? 'text-red-600' : 'text-slate-900')}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block hover:shadow-md transition-shadow rounded-xl h-full">
        {inner}
      </Link>
    )
  }
  return inner
}
