'use client'

import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── FilterSelect ─────────────────────────────────────────────
// Compact native <select> styled with a chevron, for filter bars.
// Wraps the `.input-sm` component class. Options are supplied
// either as children (<option>) or via the `options` prop.

export type SelectOption = { value: string; label: string }

export function FilterSelect({
  value, onChange, options, children, className = '', ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options?: SelectOption[]
  children?: React.ReactNode
  className?: string
  ariaLabel?: string
}) {
  return (
    <div className="relative inline-block">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={cn('input-sm appearance-none pr-7 cursor-pointer', className)}>
        {options
          ? options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
          : children}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  )
}
