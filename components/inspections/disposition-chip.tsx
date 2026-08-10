'use client'

// Disposition chip for a finding — one renderer for every surface that
// shows a finding's triage verb (inspection detail cards, the triage
// sweep, the property page's open-findings rollup). 'open' (untriaged)
// renders nothing: the absence of a verb is the triage queue's signal.

import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  DISPOSITION_CHIP_STYLES, daysSince, normalizeDisposition,
} from '@/lib/inspections/dispositions'
import { Eye, Flag, CheckSquare, HardHat, Check, CircleSlash } from 'lucide-react'

// Minimal field set — satisfied by InspectionItem and the lighter rollup
// selects.
export type DispositionChipFields = {
  disposition: string | null
  disposition_note?: string | null
  disposition_at?: string | null
  communicated_at?: string | null
  capex_project_id?: string | null
}

export function DispositionChip({ item, capexName, className }: {
  item: DispositionChipFields
  /** Linked capex project title, when the caller has it resolved. */
  capexName?: string | null
  className?: string
}) {
  const d = normalizeDisposition(item.disposition)
  if (d === 'open') return null
  const base = cn('badge', DISPOSITION_CHIP_STYLES[d], className)
  const note = item.disposition_note?.trim() || undefined

  switch (d) {
    case 'task':
      return (
        <Link href="/tasks" className={cn(base, 'hover:bg-blue-100 transition-colors')}>
          <CheckSquare size={9} className="mr-1" />Task
        </Link>
      )
    case 'capex': {
      const inner = (
        <>
          <HardHat size={9} className="mr-1" />
          CapEx{capexName ? <span className="font-normal">&nbsp;· {capexName}</span> : null}
        </>
      )
      return item.capex_project_id ? (
        <Link href={`/capex/${item.capex_project_id}`}
          className={cn(base, 'hover:bg-orange-100 transition-colors max-w-[220px] truncate')}>
          {inner}
        </Link>
      ) : <span className={cn(base, 'max-w-[220px] truncate')}>{inner}</span>
    }
    case 'flagged': {
      // Aging keeps flagged honest: how long it's been flagged, and how
      // long since it last went out in a PM email.
      const flaggedDays = daysSince(item.disposition_at)
      const commDays = daysSince(item.communicated_at)
      return (
        <>
          <span className={base} title={note}>
            <Flag size={9} className="mr-1" />Flagged{flaggedDays != null ? ` ${flaggedDays}d` : ''}
          </span>
          {commDays != null && (
            <span className={cn('badge text-slate-500 bg-slate-50 border-slate-200', className)}>
              communicated {commDays}d ago
            </span>
          )}
        </>
      )
    }
    case 'watch':
      return <span className={base} title={note}><Eye size={9} className="mr-1" />Watch</span>
    case 'accepted':
      // Quiet, struck-through tone — a settled decision, with the why on
      // hover.
      return (
        <span className={cn(base, 'line-through decoration-slate-400')}
          title={note ? `Accepted — ${note}` : 'Accepted'}>
          <CircleSlash size={9} className="mr-1" />Accepted
        </span>
      )
    case 'resolved':
      return <span className={base} title={note}><Check size={9} className="mr-1" />Resolved</span>
  }
}
