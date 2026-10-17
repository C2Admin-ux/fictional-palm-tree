'use client'

// "Where things stand" strip: one card per recurring call with its
// running summary, open-item count and last-call date. Click through to
// the series page for open items, decisions, the next agenda and history.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import type { CallRollup, CallSeries } from '@/lib/supabase/types'

type Row = { series: CallSeries; rollup: CallRollup | null; lastDate: string | null }

export function SeriesGlance() {
  const supabase = createClient()
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    (async () => {
      const [{ data: series }, { data: rollups }, { data: calls }] = await Promise.all([
        supabase.from('call_series').select('*').eq('active', true).order('display_name'),
        supabase.from('call_rollups').select('*'),
        supabase.from('calls').select('series_id, call_date').not('series_id', 'is', null)
          .order('call_date', { ascending: false }).limit(300),
      ])
      const out: Row[] = (series ?? []).map(s => ({
        series: s,
        rollup: (rollups ?? []).find(r => r.series_id === s.id) ?? null,
        lastDate: (calls ?? []).find(c => c.series_id === s.id)?.call_date ?? null,
      }))
      // Calls with something to show first, newest first.
      out.sort((a, b) => (b.lastDate ?? '').localeCompare(a.lastDate ?? ''))
      setRows(out.filter(r => r.lastDate))
      setLoaded(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!loaded || rows.length === 0) return null

  return (
    <div className="space-y-2">
      <h2 className="section-title">At a glance</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map(({ series, rollup, lastDate }) => {
          const open = Array.isArray(rollup?.open_items) ? rollup!.open_items.length : 0
          return (
            <Link key={series.id} href={`/calls/series/${series.id}`} className="card-hover p-4 block">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">{series.display_name}</div>
                <ChevronRight size={14} className="text-slate-300 mt-0.5 flex-shrink-0" />
              </div>
              <p className="text-xs text-slate-600 mt-1.5 line-clamp-4">
                {rollup?.summary || 'Summary will appear after the next call is processed.'}
              </p>
              <div className="text-xs text-slate-400 mt-2.5 flex gap-2">
                <span>Last call {formatDate(lastDate)}</span>
                <span>·</span>
                <span>{open} open item{open === 1 ? '' : 's'}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
