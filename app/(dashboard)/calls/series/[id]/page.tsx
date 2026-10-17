'use client'

// One recurring call: running summary, open items, recent decisions, the
// generated next-call agenda (editable), a search scoped to this call,
// and the full call history. Data comes from call_rollups / call_agendas
// (kept current as each call is processed) and the existing calls table.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { CALL_STATUS_LABELS, CALL_STATUS_STYLES } from '@/lib/calls/ui'
import { CallSearch } from '@/components/calls/call-search'
import { ErrorState } from '@/components/ui/error-state'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { ArrowLeft, CalendarClock, ChevronRight } from 'lucide-react'
import type { CallAgenda, CallRollup, CallSeries } from '@/lib/supabase/types'

type CallRow = { id: string; call_date: string; title: string; summary: string | null; status: 'draft' | 'processed' }
type OpenItem = { text: string; owner?: string; since?: string; property?: string }
type Decision = { text: string; date?: string }

export default function CallSeriesPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = createClient()
  const [series, setSeries] = useState<CallSeries | null>(null)
  const [rollup, setRollup] = useState<CallRollup | null>(null)
  const [agenda, setAgenda] = useState<CallAgenda | null>(null)
  const [body, setBody] = useState('')
  const [calls, setCalls] = useState<CallRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [s, r, a, c] = await Promise.all([
      supabase.from('call_series').select('*').eq('id', id).single(),
      supabase.from('call_rollups').select('*').eq('series_id', id).maybeSingle(),
      supabase.from('call_agendas').select('*').eq('series_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('calls').select('id, call_date, title, summary, status').eq('series_id', id)
        .order('call_date', { ascending: false }).limit(60),
    ])
    const failure = s.error ?? r.error ?? a.error ?? c.error
    if (failure) { setError(failure.message); setLoading(false); return }
    setError(null)
    setSeries(s.data); setRollup(r.data); setAgenda(a.data); setBody(a.data?.body ?? '')
    setCalls((c.data as CallRow[]) ?? [])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => { load() }, [load])

  async function saveAgenda(status: 'draft' | 'final') {
    if (!agenda) return
    const { error } = await supabase.from('call_agendas').update({ body, status }).eq('id', agenda.id)
    if (error) { toast(`Save failed — ${error.message}`); return }
    setAgenda({ ...agenda, body, status })
    toast(status === 'final' ? 'Agenda marked final' : 'Agenda saved')
  }

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading…</div>
  if (error || !series) {
    return <div className="p-6"><ErrorState className="card py-10" message={`Could not load this call — ${error ?? 'not found'}`}
      onRetry={() => { setLoading(true); load() }} /></div>
  }

  const open = (Array.isArray(rollup?.open_items) ? rollup!.open_items : []) as unknown as OpenItem[]
  const decisions = (Array.isArray(rollup?.recent_decisions) ? rollup!.recent_decisions : []) as unknown as Decision[]

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <Link href="/calls" className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-1">
          <ArrowLeft size={12} />All calls
        </Link>
        <h1 className="page-title">{series.display_name}</h1>
        {rollup && <p className="text-xs text-slate-400 mt-0.5">Summary updated {formatDate(rollup.updated_at)}</p>}
      </div>

      <div className="card p-4">
        <h2 className="section-title mb-2">Where things stand</h2>
        <p className="text-sm text-slate-700 whitespace-pre-line">{rollup?.summary || 'No summary yet.'}</p>
        {decisions.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-slate-600 list-disc pl-5">
            {decisions.map((d, i) => <li key={i}>{d.text}{d.date && <span className="text-slate-400"> ({formatDate(d.date)})</span>}</li>)}
          </ul>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="section-title mb-2">Open items ({open.length})</h2>
          {open.length === 0 ? <p className="text-sm text-slate-400">Nothing open.</p> : (
            <ul className="space-y-2">
              {open.map((o, i) => (
                <li key={i} className="text-sm text-slate-700">
                  {o.text}
                  <span className="text-xs text-slate-400">
                    {o.owner ? ` — ${o.owner === 'pm' ? 'PM' : o.owner === 'c2' ? 'C2' : o.owner}` : ''}
                    {o.since ? `, since ${formatDate(o.since)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="section-title flex items-center gap-1.5">
              <CalendarClock size={14} />Next agenda{agenda?.for_date ? ` — ${formatDate(agenda.for_date)}` : ''}
            </h2>
            {agenda && <span className="text-xs text-slate-400">{agenda.status}</span>}
          </div>
          {agenda ? (
            <>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={14}
                className="input font-mono text-xs leading-relaxed" />
              <div className="flex flex-wrap gap-2 mt-2">
                <button className="btn-secondary" onClick={() => saveAgenda('draft')}>Save</button>
                <button className="btn-secondary" onClick={() => saveAgenda('final')}>Mark final</button>
                <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(body).then(() => toast('Copied'))}>Copy</button>
                <Link href="/calls/agenda" className="btn-ghost ml-auto">Full prep agenda →</Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">An agenda is drafted automatically after the next call is processed.</p>
          )}
        </div>
      </div>

      <CallSearch seriesId={series.id} placeholder={`Search ${series.display_name} history`} />

      <div className="card divide-y divide-slate-100">
        <div className="px-4 py-2 section-title">History ({calls.length})</div>
        {calls.map(c => (
          <Link key={c.id} href={`/calls/${c.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900">{formatDate(c.call_date)}</div>
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
