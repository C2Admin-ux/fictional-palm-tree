'use client'

import { cn } from '@/lib/utils'

// ── TableHeader ──────────────────────────────────────────────
// A non-sortable <th> matching the styling of <Th> in lib/utils/sort.
// Use for columns that don't participate in sorting (e.g. actions).

export function TableHeader({
  label, align = 'left', className = '',
}: {
  label?: React.ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}) {
  return (
    <th
      className={cn(
        'px-3 py-2.5 text-xs font-medium text-slate-500 whitespace-nowrap select-none',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}>
      {label}
    </th>
  )
}
