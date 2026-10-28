'use client'

// Property-level finding rollups, across ALL of the property's
// inspections:
//   OpenFindingsCard — Overview card: open findings per the canonical
//     rule (lib/inspections/dispositions.isOpenFinding), newest first,
//     capped at 8 with a count header and a "View all" into the
//     Inspections tab.
//   PropertyFindingsList — the Inspections tab's full list, with filter
//     chips (Active | Open | Watch | Flagged | To verify | Settled | All)
//     defaulting to Active: everything not yet settled. Resolved and
//     accepted findings are one chip away (Settled / All) — never gone,
//     just out of the working view so the list doesn't fill with things
//     that are already fixed (Nick, 2026-10-27).
// Rows are lean server-fetched shapes (first photo path only); thumbnails
// sign client-side through the shared photo helper.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cn, formatDate, PRIORITY_DOT } from '@/lib/utils'
import { signedPhotoUrls, type SignedPhotoUrl } from '@/lib/inspections/photos'
import { instanceLabel } from '@/lib/inspections/sections'
import { DISPOSITIONS, DISPOSITION_LABELS, isOpenFinding, isSettled, needsVerification, normalizeDisposition, type Disposition } from '@/lib/inspections/dispositions'
import { confirmFinding, undoConfirm } from '@/lib/inspections/confirm'
import { invalidateInspectionReports } from '@/lib/inspections/invalidate'
import { toast } from '@/components/ui/toast'
import { DispositionChip } from '@/components/inspections/disposition-chip'
import { Camera, ClipboardCheck, ClipboardList } from 'lucide-react'

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
// rows render with a placeholder until/unless their URL lands. Exported
// for the site-visit sheet, which renders its own finding rows.
export function useSignedThumbs(rows: { thumb_path: string | null }[]): Record<string, SignedPhotoUrl> {
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

// Status control on the property page: a plain select over the triage
// verbs. 'confirm' runs the shared confirm path (completes the linked
// task); everything else is a direct disposition write. Undo via toast.
function StatusSelect({ row, onChange }: { row: OpenFindingRow; onChange: (fields: Partial<OpenFindingRow>) => void }) {
  const supabase = createClient()
  const value = normalizeDisposition(row.disposition)
  async function set(next: Disposition) {
    if (next === value) return
    const prior = { disposition: value, disposition_note: row.disposition_note, disposition_at: row.disposition_at }
    if (next === 'confirm') {
      const res = await confirmFinding(supabase, row)
      if ('error' in res) { toast(`Couldn't update — ${res.error}`, { tone: 'error' }); return }
      onChange({ disposition: 'confirm', disposition_at: new Date().toISOString() })
      void invalidateInspectionReports(supabase, [row.inspection_id])
      toast(res.prior.task ? 'Confirm on site — linked task completed' : 'Confirm on site — will show on the next site visit', {
        action: { label: 'Undo', onClick: async () => {
          const err = await undoConfirm(supabase, row.id, res.prior)
          if (err) toast(`Couldn't undo — ${err}`, { tone: 'error' }); else onChange(prior)
        } },
      })
      return
    }
    const patch = { disposition: next, disposition_at: new Date().toISOString(), ...(next === 'flagged' ? { communicated_at: null } : {}) }
    const { error } = await supabase.from('inspection_items').update(patch).eq('id', row.id)
    if (error) { toast(`Couldn't update — ${error.message}`, { tone: 'error' }); return }
    onChange(patch)
    void invalidateInspectionReports(supabase, [row.inspection_id])
    toast(`Marked ${DISPOSITION_LABELS[next].toLowerCase()}`, {
      action: { label: 'Undo', onClick: async () => {
        const { error: e } = await supabase.from('inspection_items').update(prior).eq('id', row.id)
        if (e) toast(`Couldn't undo — ${e.message}`, { tone: 'error' }); else onChange(prior)
      } },
    })
  }
  return (
    <select value={value} onChange={e => set(e.target.value as Disposition)} aria-label="Finding status"
      className="text-xs border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-600">
      {DISPOSITIONS.map(d => <option key={d} value={d}>{DISPOSITION_LABELS[d]}</option>)}
    </select>
  )
}

function FindingRow({ row, thumbUrl, onChange }: { row: OpenFindingRow; thumbUrl: string | undefined; onChange: (fields: Partial<OpenFindingRow>) => void }) {
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
        <StatusSelect row={row} onChange={onChange} />
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
  // Local copy so a status change (e.g. Confirm on site) updates in place;
  // a row that is no longer open drops off the card on the next render.
  const [list, setList] = useState(rows)
  useEffect(() => { setList(rows) }, [rows])
  const shown = list.filter(isOpenFinding)
  const thumbs = useSignedThumbs(shown)
  const patch = (id: string, fields: Partial<OpenFindingRow>) =>
    setList(prev => prev.map(r => r.id === id ? { ...r, ...fields } : r))
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-700">Open findings ({Math.max(0, count - (rows.length - shown.length))})</h3>
        <div className="flex items-center gap-3">
          {/* The site-visit working sheet — due tasks + every unsettled
              finding + capex/PM/litigation context, printable. */}
          <Link href={`/properties/${propertyId}/site-visit`}
            className="text-xs text-blue-600 hover:underline flex items-center gap-1">
            <ClipboardList size={11} />Site visit
          </Link>
          <Link href={`/properties/${propertyId}?tab=inspections`}
            className="text-xs text-blue-600 hover:underline">View all →</Link>
        </div>
      </div>
      {shown.length === 0
        ? <p className="text-xs text-slate-400 italic">No open findings</p>
        : shown.map(row => (
          <FindingRow key={row.id} row={row} onChange={f => patch(row.id, f)}
            thumbUrl={row.thumb_path ? thumbs[row.thumb_path]?.url : undefined} />
        ))}
    </div>
  )
}

// ── Full list (Inspections tab) ──────────────────────────────

type FilterId = 'active' | 'open' | 'watch' | 'flagged' | 'verify' | 'settled' | 'all'
const FILTERS: { id: FilterId; label: string; match: (r: OpenFindingRow) => boolean }[] = [
  // Default: anything still outstanding — unsettled verbs plus "confirm"
  // (PM says fixed, not yet seen in person). Resolved/accepted drop out.
  { id: 'active', label: 'Active', match: r => !isSettled(r.disposition) || needsVerification(r.disposition) },
  // "Open" = the canonical open-finding rule, minus the verbs that get
  // their own chip (watch/flagged) so the chips partition cleanly. An
  // untriaged pure observation lands only under All.
  { id: 'open', label: 'Open', match: r => isOpenFinding(r) && ['open', 'task', 'capex'].includes(normalizeDisposition(r.disposition)) },
  { id: 'watch', label: 'Watch', match: r => normalizeDisposition(r.disposition) === 'watch' },
  { id: 'flagged', label: 'Flagged', match: r => normalizeDisposition(r.disposition) === 'flagged' },
  { id: 'verify', label: 'To verify', match: r => needsVerification(r.disposition) },
  { id: 'settled', label: 'Settled', match: r => isSettled(r.disposition) && !needsVerification(r.disposition) },
  { id: 'all', label: 'All', match: () => true },
]

export function PropertyFindingsList({ rows: initialRows, propertyId }: { rows: OpenFindingRow[]; propertyId?: string }) {
  const [filter, setFilter] = useState<FilterId>('active')
  const [rows, setRows] = useState(initialRows)
  useEffect(() => { setRows(initialRows) }, [initialRows])
  const thumbs = useSignedThumbs(rows)
  const patch = (id: string, fields: Partial<OpenFindingRow>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...fields } : r))

  const active = FILTERS.find(f => f.id === filter) ?? FILTERS[0]
  const visible = rows.filter(active.match)

  if (rows.length === 0) return null

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-3">
          Findings ({filter === 'all' ? rows.length : `${visible.length} of ${rows.length}`})
          {propertyId && (
            <Link href={`/properties/${propertyId}/site-visit`}
              className="text-xs font-normal text-blue-600 hover:underline flex items-center gap-1">
              <ClipboardList size={11} />Site visit
            </Link>
          )}
        </h3>
        {/* Active is the default; Settled / All bring the rest back. */}
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
        ? <p className="text-xs text-slate-400 italic">
            {filter === 'active' ? 'Nothing outstanding — all findings are settled.' : 'Nothing under this filter'}
          </p>
        : visible.map(row => (
          <FindingRow key={row.id} row={row} onChange={f => patch(row.id, f)}
            thumbUrl={row.thumb_path ? thumbs[row.thumb_path]?.url : undefined} />
        ))}
    </div>
  )
}
