'use client'

// Full-text search across every call's title, summary and notes
// (search_calls RPC, migration 0021). Optional seriesId narrows it to one
// recurring call. Results link to the call detail page.

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { Search } from 'lucide-react'

type Hit = { call_id: string; title: string; call_date: string; snippet: string }

// ts_headline wraps matches in <b>…</b>; everything else is escaped so
// call notes can never inject markup.
function snippetHtml(raw: string): string {
  const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>')
}

export function CallSearch({ seriesId, placeholder }: { seriesId?: string; placeholder?: string }) {
  const supabase = createClient()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(e: React.FormEvent) {
    e.preventDefault()
    const term = q.trim()
    if (!term) { setHits(null); return }
    setBusy(true); setError(null)
    const { data, error } = await supabase.rpc('search_calls', { q: term, p_series: seriesId ?? null, lim: 25 })
    setBusy(false)
    if (error) { setError(error.message); return }
    setHits(data ?? [])
  }

  return (
    <div className="space-y-2">
      <form onSubmit={run} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} className="input pl-9"
            placeholder={placeholder ?? 'Search every call — e.g. sheriff Pikes unit 20'} />
        </div>
        <button className="btn-secondary" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {error && <p className="text-xs text-red-600">Search failed — {error}</p>}
      {hits && (
        <div className="card divide-y divide-slate-100">
          <div className="px-4 py-2 text-xs text-slate-400 flex justify-between">
            <span>{hits.length} result{hits.length === 1 ? '' : 's'} for “{q.trim()}”</span>
            <button onClick={() => { setHits(null); setQ('') }} className="hover:text-slate-600">Clear</button>
          </div>
          {hits.map(h => (
            <Link key={h.call_id} href={`/calls/${h.call_id}`} className="block px-4 py-3 hover:bg-slate-50">
              <div className="text-sm font-medium text-slate-900">{h.title} <span className="text-slate-400 font-normal">· {formatDate(h.call_date)}</span></div>
              <p className="text-xs text-slate-500 mt-1 [&_b]:text-slate-900 [&_b]:font-semibold"
                dangerouslySetInnerHTML={{ __html: snippetHtml(h.snippet) }} />
            </Link>
          ))}
          {hits.length === 0 && <p className="px-4 py-6 text-sm text-slate-400 text-center">No calls match that.</p>}
        </div>
      )}
    </div>
  )
}
