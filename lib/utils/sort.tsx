import { useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SortDir = 'asc' | 'desc'

export function useSort<T extends string>(defaultField: T, defaultDir: SortDir = 'asc') {
  const [sort, setSort] = useState<T>(defaultField)
  const [dir, setDir] = useState<SortDir>(defaultDir)

  function toggle(field: T) {
    if (sort === field) setDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSort(field); setDir('asc') }
  }

  function sortFn<R extends Record<string, any>>(a: R, b: R): number {
    const av = a[sort as string]
    const bv = b[sort as string]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const cmp = typeof av === 'string'
      ? av.localeCompare(bv)
      : av < bv ? -1 : av > bv ? 1 : 0
    return dir === 'asc' ? cmp : -cmp
  }

  return { sort, dir, toggle, sortFn }
}

export function Th({
  label, field, current, dir, onSort, className = '', align = 'left',
}: {
  label: string
  field?: string
  current?: string
  dir?: SortDir
  onSort?: (f: string) => void
  className?: string
  align?: 'left' | 'right' | 'center'
}) {
  const active = field && current === field
  return (
    <th
      onClick={field && onSort ? () => onSort(field) : undefined}
      className={cn(
        'px-3 py-2.5 text-xs font-medium text-slate-500 whitespace-nowrap select-none',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        field && 'cursor-pointer hover:text-slate-700',
        className
      )}>
      <span className="inline-flex items-center gap-1">
        {label}
        {field && (
          active
            ? dir === 'asc'
              ? <ChevronUp size={11} className="text-blue-500" />
              : <ChevronDown size={11} className="text-blue-500" />
            : <ChevronDown size={11} className="text-slate-300" />
        )}
      </span>
    </th>
  )
}
