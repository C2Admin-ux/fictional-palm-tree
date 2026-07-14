'use client'

import { cn } from '@/lib/utils'

// ── EmptyState ───────────────────────────────────────────────
// Centered icon + title + optional hint, for empty tables/lists.
// Matches the "No X yet" placeholders used across pages.

export function EmptyState({
  icon, title, hint, action, className = '',
}: {
  icon?: React.ReactNode
  title: string
  hint?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('py-16 text-center card', className)}>
      {icon && <div className="text-slate-200 mx-auto mb-3 flex justify-center">{icon}</div>}
      <p className="text-sm text-slate-400 mb-1">{title}</p>
      {hint && <p className="text-xs text-slate-300">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
