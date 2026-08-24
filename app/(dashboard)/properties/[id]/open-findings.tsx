'use client'

// Property-level finding rollups, across ALL of the property's
// inspections:
//   OpenFindingsCard — Overview card: open findings per the canonical
//     rule (lib/inspections/dispositions.isOpenFinding), newest first,
//     capped at 8 with a count header and a "View all" into the
//     Inspections tab.
//   PropertyFindingsList — the Inspections tab's full list: every finding
//     regardless of disposition, with opt-in filter chips (All | Open |
//     Watch | Flagged | Settled) defaulting to All. Filtering is the
//     viewer's choice — nothing is hidden by default; findings stay
//     reviewable forever.
// Rows are lean server-fetched shapes (first photo path only); thumbnails
// sign client-side through the shared photo helper.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cn, formatDate, PRIORITY_DOT } from '@/lib/utils'
import { signedPhotoUrls, type SignedPhotoUrl } from '@/lib/inspections/photos'
import { instanceLabel } from '@/lib/inspections/sections'
import { isOpenFinding, isSettled, normalizeDisposition } from '@/lib/inspections/dispositions'
import { DispositionChip } from '@/components/inspections/disposition-chip'
import { Camera, ClipboardCheck, Printer } from 'lucide-react'

// Lean row the server page assembles — first photo only, minimal
// inspection join.
export type OpenFindingRow = {
  id: string
  inspection_id: string
  inspection_date: string
  item_label: string
  section_name: string
  unit_number: string | null
  requires_action: boolean
  action_priority: string | null
  disposition: string
  disposition_note: string | null
  disposition_at: string | null
  communicated_at: string | null
  watch_count: number
  capex_project_id: string | null
  thumb_path: string | null
}

// One signing pass over the rows' thumbs (private bucket). Best-effort:
// rows render with a placeholder until/unless their URL lands.
function useSignedThumbs(rows: OpenFindingRow[]): Record<string, SignedPhotoUrl> {
  const supabase = createClient()
  const [urls, setUrls] = useState<Record<string, SignedPhotoUrl>>({})
  const paths = useMemo(
    () => Array.from(new Set(rows.map(r => r.thumb_path).filter((p): p is string => !!p))),
    [rows])
  useEffect(() => {
    const missing = paths.filter(p => !urls[p])
    if (missing.length === 0) return
    let cancelled = false
    signedPhotoUrls(supabase, missing)
      .then(fresh => { if (!cancelled && Object.keys(fresh).length) setUrls(prev => ({ ...prev, ...fresh })) })
      .catch(() => { /* placeholders are fine */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths])
  return urls
}

function FindingRow({ row, thumbUrl }: { row: OpenFindingRow; thumbUrl: string | undefined }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-200/70 last:border-0">
      {row.thumb_path && thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbUrl} alt=""
          className="w-9 h-9 rounded object-cover border border-slate-200 flex-shrink-0" />
      ) : (
        <div className="w-9 h-9 rounded bg-slate-100 flex items-center justify-center flex-shrink-0">
          <Camera size={12} className="text-slate-300" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm truncate flex items-center gap-1.5',
          row.item_label ? 'text-slate-700' : 'text-slate-300 italic')}>
          {row.requires_action && (
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              title={`Priority: ${row.action_priority ?? 'medium'}`}
              style={{ background: PRIORITY_DOT[row.action_priority ?? 'medium'] ?? '#94a3b8' }} />
          )}
          <span className="truncate">{row.item_label || 'No description'}</span>
        </p>
        <p className="text-xs text-slate-400 truncate">
          {instanceLabel({ name: row.section_name, unit: row.unit_number })}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
        <DispositionChip item={row} />
        {normalizeDisposition(row.disposition) === 'watch' && row.watch_count > 0 && (
          <span className="badge text-amber-700 bg-amber-50 border-amber-200"
            title="Times carried forward from the watch list">
            {row.watch_count}× carried
          </span>
        )}
        <Link href={`/inspections/${row.inspection_id}`}
          title="Open the source inspection"
          className="text-xs text-slate-400 hover:text-blue-600 whitespace-nowrap flex items-center gap-1">
          <ClipboardCheck size={11} className="flex-shrink-0" />
          {formatDate(row.inspection_date)}
        </Link>
      </div>
    </div>
  )
}

// ── Overview card ────────────────────────────────────────────

export function OpenFindingsCard({ propertyId, count, rows }: {
  propertyId: string
  count: number
  rows: OpenFindingRow[]
}) {
  const thumbs = useSignedThumbs(rows)
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-700">Open findings ({count})</h3>
        <div className="flex items-center gap-3">
          {/* Printable checklist of the flagged + watch subset — for
              walking the site and checking off what's actually fixed. */}
          <Link href={`/properties/${propertyId}/walk-sheet`}
            className="text-xs text-blue-600 hover:underline flex items-center gap-1">
            <Printer size={11} />Walk sheet
          </Link>
          <Link href={`/properties/${propertyId}?tab=inspections`}
            className="text-xs text-blue-600 hover:underline">View all →</Link>
        </div>
      </div>
      {rows.length === 0
        ? <p className="text-xs text-slate-400 italic">No open findings</p>
        : rows.map(row => (
          <FindingRow key={row.id} row={row}
            thumbUrl={row.thumb_path ? thumbs[row.thumb_path]?.url : undefined} />
        ))}
    </div>
  )
}

// ── Full list (Inspections tab) ──────────────────────────────

type FilterId = 'all' | 'open' | 'watch' | 'flagged' | 'settled'
const FILTERS: { id: FilterId; label: string; match: (r: OpenFindingRow) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  // "Open" = the canonical open-finding rule, minus the verbs that get
  // their own chip (watch/flagged) so the chips partition cleanly. An
  // untriaged pure observation lands only under All.
  { id: 'open', label: 'Open', match: r => isOpenFinding(r) && ['open', 'task', 'capex'].includes(normalizeDisposition(r.disposition)) },
  { id: 'watch', label: 'Watch', match: r => normalizeDisposition(r.disposition) === 'watch' },
  { id: 'flagged', label: 'Flagged', match: r => normalizeDisposition(r.disposition) === 'flagged' },
  { id: 'settled', label: 'Settled', match: r => isSettled(r.disposition) },
]

export function PropertyFindingsList({ rows, propertyId }: { rows: OpenFindingRow[]; propertyId?: string }) {
  const [filter, setFilter] = useState<FilterId>('all')
  const thumbs = useSignedThumbs(rows)

  const active = FILTERS.find(f => f.id === filter) ?? FILTERS[0]
  const visible = rows.filter(active.match)

  if (rows.length === 0) return null

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-3">
          Findings ({rows.length})
          {propertyId && (
            <Link href={`/properties/${propertyId}/walk-sheet`}
              className="text-xs font-normal text-blue-600 hover:underline flex items-center gap-1">
              <Printer size={11} />Walk sheet
            </Link>
          )}
        </h3>
        {/* Opt-in narrowing — All is the default; nothing is ever hidden
            without the viewer asking. */}
        <div className="flex items-center gap-1 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={cn(
                'text-xs px-2.5 py-1 rounded-full border transition-colors',
                filter === f.id
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              )}>
              {f.label} ({rows.filter(f.match).length})
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0
        ? <p className="text-xs text-slate-400 italic">Nothing under this filter</p>
        : visible.map(row => (
          <FindingRow key={row.id} row={row}
            thumbUrl={row.thumb_path ? thumbs[row.thumb_path]?.url : undefined} />
        ))}
    </div>
  )
}
