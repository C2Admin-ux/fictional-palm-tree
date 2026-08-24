'use client'

// Printable walk sheet — Nick's ask (2026-08-24): every OPEN flagged and
// watch finding for one property, on paper, so he can walk the site and
// check off what's actually been fixed. Grouped by section/unit (the
// order you walk), one checkbox per finding, a blank line under each for
// field notes. The toolbar and app shell hide under @media print (see
// the print: classes here and in the dashboard layout); everything else
// is deliberately black-on-white so a mono laser prints it legibly.
//
// Paper is the capture medium — resolving still happens in the app
// afterwards (triage on the inspection or the property findings list).

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cn, formatDate, todayISO } from '@/lib/utils'
import { instanceLabel } from '@/lib/inspections/sections'
import { normalizeDisposition } from '@/lib/inspections/dispositions'
import { ArrowLeft, Printer } from 'lucide-react'

type WalkRow = {
  id: string
  item_label: string
  section_name: string
  unit_number: string | null
  requires_action: boolean
  action_priority: string | null
  disposition: string
  disposition_note: string | null
  watch_count: number
  inspections: { property_id: string; inspection_date: string } | null
}

type Group = { key: string; label: string; rows: WalkRow[] }

// Section/unit walking order: sections alphabetically, unitless instance
// first within a section, then units in natural order (2 before 10).
function groupRows(rows: WalkRow[]): Group[] {
  const map = new Map<string, Group>()
  for (const r of rows) {
    const key = `${r.section_name}|${r.unit_number ?? ''}`
    let g = map.get(key)
    if (!g) {
      g = { key, label: instanceLabel({ name: r.section_name, unit: r.unit_number }), rows: [] }
      map.set(key, g)
    }
    g.rows.push(r)
  }
  const collator = new Intl.Collator(undefined, { numeric: true })
  return Array.from(map.values()).sort((a, b) => collator.compare(a.label, b.label))
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export default function WalkSheetPage() {
  const params = useParams<{ id: string }>()
  const supabase = createClient()
  const [propertyName, setPropertyName] = useState<string | null>(null)
  const [rows, setRows] = useState<WalkRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchAll() {
      const [propRes, itemsRes] = await Promise.all([
        supabase.from('properties').select('name').eq('id', params.id).single(),
        supabase.from('inspection_items')
          .select('id, item_label, section_name, unit_number, requires_action, action_priority, disposition, disposition_note, watch_count, inspections!inner(property_id, inspection_date)')
          .eq('inspections.property_id', params.id)
          .in('disposition', ['watch', 'flagged']),
      ])
      if (propRes.error) { setError(propRes.error.message); return }
      if (itemsRes.error) { setError(itemsRes.error.message); return }
      setPropertyName(propRes.data?.name ?? null)
      // Within a group: flagged before watch, then by priority, then oldest
      // inspection first (the longest-outstanding item leads).
      const sorted = ((itemsRes.data ?? []) as unknown as WalkRow[]).sort((a, b) =>
        (a.disposition === b.disposition ? 0 : a.disposition === 'flagged' ? -1 : 1) ||
        (PRIORITY_ORDER[a.action_priority ?? 'medium'] ?? 2) - (PRIORITY_ORDER[b.action_priority ?? 'medium'] ?? 2) ||
        (a.inspections?.inspection_date ?? '').localeCompare(b.inspections?.inspection_date ?? ''))
      setRows(sorted)
    }
    fetchAll()
  }, [params.id])

  const groups = rows ? groupRows(rows) : []
  const flaggedCount = rows?.filter(r => normalizeDisposition(r.disposition) === 'flagged').length ?? 0
  const watchCount = rows?.filter(r => normalizeDisposition(r.disposition) === 'watch').length ?? 0

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 print:p-0 print:max-w-none">
      {/* Screen-only toolbar */}
      <div className="flex items-center justify-between gap-2 mb-5 print:hidden">
        <Link href={`/properties/${params.id}`}
          className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1.5">
          <ArrowLeft size={14} />Back to property
        </Link>
        <button onClick={() => window.print()} className="btn-primary" disabled={!rows}>
          <Printer size={14} />Print
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 print:hidden">Couldn&apos;t load the walk sheet — {error}</p>
      )}
      {!error && rows == null && (
        <p className="text-sm text-slate-400 print:hidden">Loading…</p>
      )}

      {rows != null && (
        <div className="text-slate-900">
          {/* Sheet header */}
          <div className="border-b-2 border-slate-900 pb-3 mb-4">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-xl font-bold">{propertyName ?? 'Property'} — Walk Sheet</h1>
                <p className="text-sm mt-1">
                  {flaggedCount} flagged · {watchCount} watch · printed {formatDate(todayISO())}
                </p>
              </div>
              <div className="text-sm space-y-2 pb-0.5">
                <div>Walked by: <span className="inline-block w-40 border-b border-slate-400" /></div>
                <div>Date: <span className="inline-block w-40 border-b border-slate-400" /></div>
              </div>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-slate-500 italic">
              No open flagged or watch findings for this property — nothing to walk.
            </p>
          ) : (
            groups.map(g => (
              <div key={g.key} className="mb-5 break-inside-avoid-page">
                <h2 className="text-sm font-bold uppercase tracking-wide border-b border-slate-300 pb-1 mb-2">
                  {g.label}
                  <span className="ml-2 font-normal normal-case tracking-normal text-slate-500">
                    {g.rows.length} item{g.rows.length === 1 ? '' : 's'}
                  </span>
                </h2>
                {g.rows.map(r => (
                  <div key={r.id} className="flex gap-3 py-2 border-b border-slate-200 break-inside-avoid">
                    {/* The checkbox — the whole point of the sheet */}
                    <div className="w-5 h-5 border-2 border-slate-700 rounded-sm flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">
                        {r.item_label || <span className="italic text-slate-500">No description</span>}
                      </p>
                      {r.disposition_note && (
                        <p className="text-xs text-slate-600 mt-0.5">Note: {r.disposition_note}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-600 flex-wrap">
                        <span className={cn(
                          'border rounded px-1.5 py-px font-semibold uppercase tracking-wide',
                          normalizeDisposition(r.disposition) === 'flagged'
                            ? 'border-red-600 text-red-700'
                            : 'border-amber-600 text-amber-700',
                        )}>
                          {normalizeDisposition(r.disposition) === 'flagged' ? 'Flagged' : 'Watch'}
                        </span>
                        {r.requires_action && r.action_priority && (
                          <span className="border border-slate-400 rounded px-1.5 py-px uppercase tracking-wide">
                            {r.action_priority}
                          </span>
                        )}
                        {r.watch_count > 0 && <span>{r.watch_count}× carried</span>}
                        {r.inspections?.inspection_date && (
                          <span>noted {formatDate(r.inspections.inspection_date)}</span>
                        )}
                      </div>
                      {/* Field-notes line for handwriting */}
                      <div className="mt-3 border-b border-dotted border-slate-400 h-4" aria-hidden="true" />
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}

          {rows.length > 0 && (
            <p className="text-xs text-slate-500 mt-6">
              Checked items are still marked resolved in the app afterwards — triage them on the
              property&apos;s findings list or the source inspection.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
