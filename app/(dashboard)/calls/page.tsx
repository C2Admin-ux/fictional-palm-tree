'use client'

// PM check-in calls list: every weekly call with its PMC, extraction
// status, and item counts. "New Call" pastes a transcript, creates a
// draft, fires extraction, and lands on the review surface. "Prep
// agenda" jumps to the deterministic pre-call agenda for a PMC.

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatDate, todayISO } from '@/lib/utils'
import { CALL_SOURCE_LABELS, CALL_STATUS_LABELS, CALL_STATUS_STYLES } from '@/lib/calls/ui'
import { FilterSelect } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'
import { ActionError, ErrorState } from '@/components/ui/error-state'
import { toast } from '@/components/ui/toast'
import { useSort, Th } from '@/lib/utils/sort'
import { Phone, Plus, Trash2, ChevronRight, X, CalendarClock } from 'lucide-react'

type PmcOption = { id: string; name: string }

type CallRow = {
  id: string
  pmc_id: string | null
  title: string
  call_date: string
  source: 'paste' | 'email'
  summary: string | null
  status: 'draft' | 'processed'
  created_at: string
  pmcs: { name: string } | null
  call_items: { kind: string; resolved: boolean }[]
}

export default function CallsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [calls, setCalls] = useState<CallRow[]>([])
  const [pmcs, setPmcs] = useState<PmcOption[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [showAgenda, setShowAgenda] = useState(false)
  const [filterPmc, setFilterPmc] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const { sort, dir, toggle, sortFn } = useSort<string>('call_date', 'desc')

  const fetchCalls = useCallback(async () => {
    let q = supabase.from('calls')
      .select('id, pmc_id, title, call_date, source, summary, status, created_at, pmcs(name), call_items(kind, resolved)')
    if (filterPmc) q = q.eq('pmc_id', filterPmc)
    if (filterStatus) q = q.eq('status', filterStatus as CallRow['status'])
    const { data, error } = await q
    if (error) {
      // Never show the false "No calls yet" empty state on a failed
      // fetch — surface the error with a retry instead.
      setFetchError(error.message)
      setLoading(false)
      return
    }
    setFetchError(null)
    setCalls((data as unknown as CallRow[]) ?? [])
    setLoading(false)
  }, [filterPmc, filterStatus])

  useEffect(() => { fetchCalls() }, [fetchCalls])
  useEffect(() => {
    supabase.from('pmcs').select('id, name').order('name')
      .then(({ data }) => setPmcs(data ?? []))
  }, [])

  const displayed = useMemo(() => calls
    .map(c => ({
      ...c,
      pmc_name: c.pmcs?.name ?? '',
      action_count: c.call_items.filter(i => i.kind === 'action').length,
      open_count: c.call_items.filter(i => !i.resolved).length,
    }))
    .sort(sortFn),
    // sortFn is fully determined by sort + dir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calls, sort, dir])

  async function deleteCall(call: CallRow) {
    if (!confirm(`Delete this call${call.title ? ` (“${call.title}”)` : ''} and its extracted items? Tasks already created from it are kept. This cannot be undone.`)) return
    setActionError(null)
    const { error } = await supabase.from('calls').delete().eq('id', call.id)
    if (error) { setActionError(`Delete failed: ${error.message}`); return }
    setCalls(prev => prev.filter(c => c.id !== call.id))
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Calls</h1>
          <p className="text-sm text-slate-500 mt-0.5">Weekly PM check-ins — notes in, agendas and tasks out</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAgenda(true)} className="btn-secondary">
            <CalendarClock size={14} />Prep agenda
          </button>
          <button onClick={() => setShowNew(true)} className="btn-primary">
            <Plus size={14} />New Call
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <FilterSelect value={filterPmc} onChange={setFilterPmc} ariaLabel="Filter by PMC">
          <option value="">All PMCs</option>
          {pmcs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </FilterSelect>
        <FilterSelect value={filterStatus} onChange={setFilterStatus} ariaLabel="Filter by status">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="processed">Processed</option>
        </FilterSelect>
        {(filterPmc || filterStatus) && (
          <button onClick={() => { setFilterPmc(''); setFilterStatus('') }}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <X size={11} />Clear
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">{displayed.length} shown</span>
      </div>

      {/* Mutation errors surface inline — never silently pretend success */}
      {actionError && <ActionError message={actionError} onDismiss={() => setActionError(null)} />}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : fetchError ? (
        <ErrorState className="card py-10"
          message={`Could not load calls — ${fetchError}`}
          onRetry={() => { setLoading(true); setFetchError(null); fetchCalls() }} />
      ) : displayed.length === 0 ? (
        <EmptyState
          icon={<Phone size={32} />}
          title="No calls yet"
          hint="Paste the notes from your last PM check-in to get started"
          action={<button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={14} />New Call</button>}
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 sm:hidden">
            {displayed.map(call => (
              <Link key={call.id} href={`/calls/${call.id}`}
                className="card-hover p-3 flex items-center gap-3 block">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {call.title || call.pmc_name || 'Untitled call'}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                    <span>{formatDate(call.call_date)}</span>
                    {call.pmc_name && <><span>·</span><span>{call.pmc_name}</span></>}
                    <span>·</span>
                    <span>{call.action_count} action{call.action_count === 1 ? '' : 's'}</span>
                  </div>
                  {call.summary && (
                    <div className="text-xs text-slate-500 mt-1 line-clamp-2">{call.summary}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={cn('badge', CALL_STATUS_STYLES[call.status])}>
                    {CALL_STATUS_LABELS[call.status]}
                  </span>
                  <ChevronRight size={14} className="text-slate-300" />
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <div className="card overflow-x-auto hidden sm:block">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <Th label="Date" field="call_date" current={sort} dir={dir} onSort={toggle} className="pl-4" />
                  <Th label="PMC" field="pmc_name" current={sort} dir={dir} onSort={toggle} />
                  <Th label="Title" field="title" current={sort} dir={dir} onSort={toggle} />
                  <Th label="Status" field="status" current={sort} dir={dir} onSort={toggle} />
                  <Th label="Actions" field="action_count" current={sort} dir={dir} onSort={toggle} align="right" />
                  <Th label="Open" field="open_count" current={sort} dir={dir} onSort={toggle} align="right" />
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-400">Summary</th>
                  <th className="w-14" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {displayed.map(call => (
                  <tr key={call.id} className="hover:bg-slate-50 cursor-pointer group"
                    onClick={() => router.push(`/calls/${call.id}`)}>
                    <td className="pl-4 pr-3 py-3 text-slate-700 whitespace-nowrap">{formatDate(call.call_date)}</td>
                    <td className="px-3 py-3 text-slate-700">{call.pmc_name || '—'}</td>
                    <td className="px-3 py-3">
                      <span className="font-medium text-slate-900">{call.title || 'Untitled call'}</span>
                      <span className="ml-2 text-xs text-slate-400">{CALL_SOURCE_LABELS[call.source]}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn('badge', CALL_STATUS_STYLES[call.status])}>
                        {CALL_STATUS_LABELS[call.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-slate-700">{call.action_count}</td>
                    <td className="px-3 py-3 text-right text-slate-700">{call.open_count}</td>
                    <td className="px-3 py-3 max-w-[280px]">
                      <span className="text-xs text-slate-500 line-clamp-1">{call.summary ?? '—'}</span>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        onClick={e => { e.stopPropagation(); deleteCall(call) }}
                        title="Delete call"
                        className="text-slate-300 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showNew && <NewCallModal pmcs={pmcs} onClose={() => setShowNew(false)} />}
      {showAgenda && <AgendaPickerModal pmcs={pmcs} onClose={() => setShowAgenda(false)} />}
    </div>
  )
}

// ── New Call Modal ───────────────────────────────────────────
// Paste transcript → INSERT draft → fire extraction → land on review.
// Extraction failure still lands on the draft (the transcript is saved;
// "Re-run extraction" retries from the detail page).

function NewCallModal({ pmcs, onClose }: {
  pmcs: PmcOption[]
  onClose: () => void
}) {
  const supabase = createClient()
  const router = useRouter()
  const [pmcId, setPmcId] = useState(pmcs.length === 1 ? pmcs[0].id : '')
  const [date, setDate] = useState(todayISO())
  const [title, setTitle] = useState('')
  const [transcript, setTranscript] = useState('')
  const [phase, setPhase] = useState<'idle' | 'saving' | 'extracting'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function start(e: React.FormEvent) {
    e.preventDefault()
    if (!transcript.trim()) return
    setPhase('saving')
    setError(null)
    const { data: auth } = await supabase.auth.getUser()
    const { data, error: insertError } = await supabase.from('calls')
      .insert({
        pmc_id: pmcId || null,
        title: title.trim(),
        call_date: date || todayISO(),
        source: 'paste',
        transcript,
        status: 'draft',
        created_by: auth.user?.id ?? null,
      })
      .select('id')
      .single()
    if (insertError || !data) {
      setError(insertError?.message ?? 'Could not create call')
      setPhase('idle')
      return
    }

    // Call saved — extraction is best-effort on this path. A failure
    // still lands on the draft where "Re-run extraction" retries.
    setPhase('extracting')
    try {
      const res = await fetch('/api/calls/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: data.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        toast(`Extraction failed — ${body?.error ?? `HTTP ${res.status}`}. Re-run it from the call page.`, { tone: 'error' })
      }
    } catch {
      toast('Extraction failed — re-run it from the call page.', { tone: 'error' })
    }
    router.push(`/calls/${data.id}`)
  }

  return (
    <Modal title="New Call" onClose={onClose} maxWidth="2xl">
      <form onSubmit={start} className="px-6 py-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">PMC</label>
            <select value={pmcId} onChange={e => setPmcId(e.target.value)} className="input">
              <option value="">No PMC (assign later)</option>
              {pmcs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
          </div>
        </div>
        <div>
          <label className="label">Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className="input"
            placeholder="e.g. Weekly check-in — AMC" />
        </div>
        <div>
          <label className="label">Notes / transcript<span className="text-red-400"> *</span></label>
          <textarea
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            className="input min-h-[220px] font-mono text-xs"
            placeholder="Paste the Granola / Gemini notes here…"
            required
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost" disabled={phase !== 'idle'}>Cancel</button>
          <button type="submit" disabled={phase !== 'idle' || !transcript.trim()} className="btn-primary">
            {phase === 'saving' ? 'Saving…' : phase === 'extracting' ? 'Extracting items…' : 'Create & Extract'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Agenda Picker ────────────────────────────────────────────
// One button per PMC → /calls/agenda?pmc={id}.

function AgendaPickerModal({ pmcs, onClose }: {
  pmcs: PmcOption[]
  onClose: () => void
}) {
  const router = useRouter()
  return (
    <Modal title="Prep agenda" onClose={onClose} maxWidth="md">
      <div className="px-6 py-5 space-y-2">
        <p className="text-sm text-slate-500 mb-3">Pick the PMC you&apos;re about to call:</p>
        {pmcs.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No PMCs yet — add one in Settings first.</p>
        ) : pmcs.map(p => (
          <button key={p.id}
            onClick={() => router.push(`/calls/agenda?pmc=${p.id}`)}
            className="w-full flex items-center justify-between border border-slate-200 rounded-lg px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-blue-300 transition-colors">
            {p.name}
            <ChevronRight size={14} className="text-slate-300" />
          </button>
        ))}
      </div>
    </Modal>
  )
}
