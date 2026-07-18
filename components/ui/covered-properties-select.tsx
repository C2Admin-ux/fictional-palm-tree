'use client'

// Affirmative multi-property coverage picker + list chip (shared by the
// policy and contract modals). A record covers extra properties only when
// they're explicitly checked here — property_id null alone is "unassigned",
// never blanket coverage (owner rule, Sprint 11 correction). Hidden behind
// a "Covers multiple properties?" link so the common single-property case
// stays clean.

import { useState } from 'react'
import type { Property } from '@/lib/supabase/types'

export function CoveredPropertiesSelect({ properties, primaryId, value, onChange }: {
  /** Active properties offered for selection. */
  properties: Property[]
  /** Current single Property select value ('' when none) — excluded from the list. */
  primaryId: string
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(value.length > 0)
  const options = properties.filter(p => p.id !== primaryId)
  const selectable = options.map(p => p.id)
  const allSelected = selectable.length > 0 && selectable.every(id => value.includes(id))

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-blue-600 hover:underline">
        Covers multiple properties?
      </button>
    )
  }

  function toggleId(id: string) {
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id])
  }

  return (
    <div className="border border-slate-200 rounded-lg p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="label mb-0">Also covers</span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => onChange(allSelected ? [] : selectable)}
            className="text-xs text-blue-600 hover:underline">
            {allSelected ? 'Clear all' : 'Select all (portfolio)'}
          </button>
          <button type="button" onClick={() => { onChange([]); setOpen(false) }}
            className="text-xs text-slate-400 hover:text-slate-600">
            Hide
          </button>
        </div>
      </div>
      <div className="max-h-36 overflow-y-auto space-y-0.5">
        {options.length === 0
          ? <p className="text-xs text-slate-400 italic">No other active properties.</p>
          : options.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-sm text-slate-700 py-0.5 cursor-pointer">
              <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggleId(p.id)} className="w-3.5 h-3.5" />
              {p.name}
            </label>
          ))}
      </div>
    </div>
  )
}

/** "Portfolio" / "+N properties" chip for list rows with affirmative multi-property coverage. */
export function CoveredCountChip({ coveredIds, propertyId, activePropertyIds }: {
  coveredIds: string[] | null
  propertyId: string | null
  activePropertyIds: string[]
}) {
  if (!coveredIds?.length) return null
  const covered = new Set(coveredIds)
  if (propertyId) covered.add(propertyId)
  const portfolio = activePropertyIds.length > 0 && activePropertyIds.every(id => covered.has(id))
  return (
    <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
      {portfolio ? 'Portfolio' : `+${coveredIds.length} propert${coveredIds.length === 1 ? 'y' : 'ies'}`}
    </span>
  )
}
