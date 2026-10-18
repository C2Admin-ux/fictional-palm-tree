// Property → Calls: the running "where things stand" summary for the
// recurring call(s) that cover this property, then the call records
// newest first. Server-rendered (the property page is a server
// component); the summary comes from call_rollups, which the ingestion
// task rebuilds from the four most recent calls.

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import { CALL_STATUS_LABELS, CALL_STATUS_STYLES } from '@/lib/calls/ui'
import { cn } from '@/lib/utils'
import { Phone, ChevronRight } from 'lucide-react'

type OpenItem = { text: string; owner?: string; since?: string }

export async function loadPropertyCalls(propertyId: string) {
  const supabase = await createClient()
  const { data: series } = await supabase.from('call_series')
    .select('id, display_name, cadence_days').contains('property_ids', [propertyId]).eq('active', true)
  const ids = (series ?? []).map(s => s.id)
  if (!ids.length) return { series: [], rollups: [], calls: [] }
  const [{ data: rollups }, { data: calls }] = await Promise.all([
    supabase.from('call_rollups').select('*').in('series_id', ids),
    supabase.from('calls').select('id, series_id, title, call_date, summary, status, transcript_kind')
      .in('series_id', ids).order('call_date', { ascending: false }).limit(60),
  ])
  return { series: series ?? [], rollups: rollups ?? [], calls: calls ?? [] }
}

type Loaded = Awaited<ReturnType<typeof loadPropertyCalls>>

/** Overview card: summary paragraph + last three calls. */
export function CallsOverviewCard({ data, propertyId }: { data: Loaded; propertyId: string }) {
  if (!data.series.length) return null
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700">Recent Calls</h3>
        <Link href={`/properties/${propertyId}?tab=calls`} className="text-xs text-blue-600 hover:underline">View all →</Link>
      </div>
      {data.series.map(s => {
        const r = data.rollups.find(x => x.series_id === s.id)
        return (
          <div key={s.id} className="mb-3 last:mb-0">
            {data.series.length > 1 && <div className="text-xs font-medium text-slate-500 mb-1">{s.display_name}</div>}
            <p className="text-sm text-slate-700">{r?.summary || 'No summary yet.'}</p>
          </div>
        )
      })}
      <div className="mt-3 border-t border-slate-200/70 pt-2">
        {data.calls.slice(0, 3).map(c => (
          <Link key={c.id} href={`/calls/${c.id}`} className="flex items-center gap-2 py-1.5 text-sm hover:text-blue-600">
            <Phone size={12} className="text-slate-300" />
            <span className="text-slate-700">{formatDate(c.call_date)}</span>
            <span className="text-xs text-slate-400 truncate flex-1">{c.summary}</span>
            <ChevronRight size={12} className="text-slate-300" />
          </Link>
        ))}
      </div>
    </div>
  )
}

/** Calls tab: full summary with open items and decisions, then every call. */
export function CallsTab({ data }: { data: Loaded }) {
  if (!data.series.length) {
    return <div className="card p-8 text-center text-sm text-slate-400">No recurring call covers this property yet.</div>
  }
  return (
    <div className="max-w-5xl space-y-5">
      {data.series.map(s => {
        const r = data.rollups.find(x => x.series_id === s.id)
        const open = (Array.isArray(r?.open_items) ? r!.open_items : []) as unknown as OpenItem[]
        const decisions = (Array.isArray(r?.recent_decisions) ? r!.recent_decisions : []) as unknown as { text: string; date?: string }[]
        return (
          <div key={s.id} className="card p-4 space-y-4">
            <div>
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-slate-700">{s.display_name} — where things stand</h2>
                {r && <span className="text-xs text-slate-400">updated {formatDate(r.updated_at)} · last 4 calls</span>}
              </div>
              <p className="text-sm text-slate-700 mt-2 whitespace-pre-line">{r?.summary || 'No summary yet.'}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="section-title mb-1.5">Open items ({open.length})</h3>
                {open.length === 0 ? <p className="text-xs text-slate-400 italic">Nothing open</p> : (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {open.map((o, i) => (
                      <li key={i}>{o.text}<span className="text-xs text-slate-400">{o.owner ? ` — ${o.owner.toUpperCase()}` : ''}{o.since ? `, since ${formatDate(o.since)}` : ''}</span></li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="section-title mb-1.5">Recent decisions</h3>
                {decisions.length === 0 ? <p className="text-xs text-slate-400 italic">None recorded</p> : (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {decisions.map((d, i) => <li key={i}>{d.text}{d.date && <span className="text-xs text-slate-400"> ({formatDate(d.date)})</span>}</li>)}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )
      })}

      <div className="card divide-y divide-slate-200/70">
        <div className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Call records ({data.calls.length})</div>
        {data.calls.map(c => (
          <Link key={c.id} href={`/calls/${c.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900">{formatDate(c.call_date)} <span className="font-normal text-slate-400">· {c.title}</span></div>
              {c.summary && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{c.summary}</p>}
            </div>
            <span className={cn('badge', CALL_STATUS_STYLES[c.status])}>{CALL_STATUS_LABELS[c.status]}</span>
            <ChevronRight size={14} className="text-slate-300 mt-1" />
          </Link>
        ))}
      </div>
    </div>
  )
}
