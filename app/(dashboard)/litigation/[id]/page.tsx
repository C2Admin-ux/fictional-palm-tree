'use client'

// Full case view — everything about one matter: parties, dates, counsel,
// the insurance tie (policy, claim #, adjuster tap-to-contact), amounts,
// background notes, and the dated update log whose newest entry is the
// case's "last update". Edit opens the shared modal; delete confirms
// (the log cascades) and returns to the list.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { InsurancePolicy, LitigationUpdate, Property } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate, propertyColor } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import { ArrowLeft, Pencil, ShieldCheck, Trash2 } from 'lucide-react'
import {
  CaseFormModal, TYPE_LABEL, STATUS_META, daysUntilDate, type CaseWithJoins,
} from '../shared'

export default function LitigationCasePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const [row, setRow] = useState<CaseWithJoins | null>(null)
  const [log, setLog] = useState<LitigationUpdate[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [policies, setPolicies] = useState<InsurancePolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const fetchAll = useCallback(async () => {
    const [caseRes, updatesRes, propsRes, policiesRes] = await Promise.all([
      supabase.from('litigation_cases')
        .select('*, properties(name), insurance_policies(policy_number, policy_type, carrier)')
        .eq('id', params.id).single(),
      supabase.from('litigation_updates').select('*')
        .eq('case_id', params.id).order('created_at', { ascending: false }),
      supabase.from('properties').select('*').order('name'),
      supabase.from('insurance_policies').select('*').eq('status', 'active').order('policy_type'),
    ])
    if (caseRes.error) { setError(caseRes.error.message); setLoading(false); return }
    setRow(caseRes.data as CaseWithJoins)
    setLog((updatesRes.data ?? []) as LitigationUpdate[])
    setProperties(propsRes.data ?? [])
    setPolicies((policiesRes.data ?? []) as InsurancePolicy[])
    setLoading(false)
  }, [params.id])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function addUpdate() {
    const body = draft.trim()
    if (!body || !row) return
    const { error: e } = await supabase.from('litigation_updates').insert({ case_id: row.id, body })
    if (e) { toast(`Couldn't add update — ${e.message}`, { tone: 'error' }); return }
    setDraft('')
    fetchAll()
  }

  // House delete pattern for log entries: immediate + Undo (full restore).
  async function deleteUpdate(u: LitigationUpdate) {
    const { error: e } = await supabase.from('litigation_updates').delete().eq('id', u.id)
    if (e) { toast(`Couldn't delete update — ${e.message}`, { tone: 'error' }); return }
    fetchAll()
    toast('Update deleted', {
      action: {
        label: 'Undo',
        onClick: async () => {
          const { error: e2 } = await supabase.from('litigation_updates').insert(u)
          if (e2) toast(`Couldn't restore — ${e2.message}`, { tone: 'error' })
          fetchAll()
        },
      },
    })
  }

  async function deleteCase() {
    if (!row) return
    // The update log cascades with the case — confirm before losing it.
    if (!window.confirm(`Delete "${row.title}" and its tracking log?`)) return
    const { error: e } = await supabase.from('litigation_cases').delete().eq('id', row.id)
    if (e) { toast(`Couldn't delete — ${e.message}`, { tone: 'error' }); return }
    router.push('/litigation')
  }

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading…</div>
  if (error || !row) {
    return (
      <div className="p-6 space-y-3">
        <Link href="/litigation" className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1.5">
          <ArrowLeft size={14} />Back to litigation
        </Link>
        <p className="text-sm text-red-600">{error ?? 'Case not found'}</p>
      </div>
    )
  }

  const meta = STATUS_META[row.status]
  const deadlineDays = row.next_deadline ? daysUntilDate(row.next_deadline) : null
  const lastUpdate = log[0]?.created_at ?? row.updated_at

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Link href="/litigation" className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1.5">
          <ArrowLeft size={14} />Back to litigation
        </Link>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setEditing(true)} className="btn-secondary text-xs py-1.5">
            <Pencil size={12} />Edit
          </button>
          <button onClick={deleteCase} aria-label="Delete case"
            className="p-2 text-slate-300 hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
        </div>
      </div>

      <div>
        <div className="flex items-start gap-2 flex-wrap">
          <h1 className="text-xl font-semibold text-slate-900 flex-1 min-w-0">{row.title}</h1>
          <span className="badge text-slate-600 bg-slate-50 border-slate-200">{TYPE_LABEL[row.case_type]}</span>
          <span className={cn('badge', meta.style)}>{meta.label}</span>
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap text-sm text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: propertyColor(row.properties?.name) }} />
            {row.properties?.name ?? 'No property'}
          </span>
          {row.litigant && <span>· {row.litigant}</span>}
          {row.case_number && <span>· #{row.case_number}</span>}
          {row.court && <span>· {row.court}</span>}
        </div>
      </div>

      {row.next_deadline && (
        <div className={cn('rounded-lg border px-4 py-3 text-sm',
          deadlineDays != null && deadlineDays <= 14
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-slate-200 bg-slate-50 text-slate-700')}>
          <span className="font-medium">{row.next_deadline_label || 'Next deadline'}:</span>{' '}
          {formatDate(row.next_deadline)}
          {deadlineDays != null && (deadlineDays >= 0 ? ` — ${deadlineDays} day${deadlineDays === 1 ? '' : 's'} out` : ' — PAST')}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card p-4 space-y-2 text-sm">
          <h2 className="text-sm font-semibold text-slate-700">Key facts</h2>
          {[
            ['Date of notice', row.date_of_notice ? formatDate(row.date_of_notice) : '—'],
            ['Last update', formatDate(lastUpdate)],
            ['Demand', row.demand_amount != null ? formatCurrency(row.demand_amount) : '—'],
            ['Settlement', row.settlement_amount != null ? formatCurrency(row.settlement_amount) : '—'],
            ['Resolved', row.resolved_at ? formatDate(row.resolved_at) : '—'],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between gap-3">
              <span className="text-slate-400">{label}</span>
              <span className="text-slate-700 text-right">{value}</span>
            </div>
          ))}
          {row.our_counsel && (
            <p className="pt-1 border-t border-slate-200/70 text-xs">
              <span className="text-slate-400">Our counsel:</span> {row.our_counsel}
            </p>
          )}
          {row.opposing_counsel && (
            <p className="text-xs"><span className="text-slate-400">Opposing:</span> {row.opposing_counsel}</p>
          )}
        </div>

        <div className="card p-4 space-y-2 text-sm">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-emerald-600" />Insurance
          </h2>
          {!(row.insurance_policy_id || row.claim_number || row.adjuster_name) ? (
            <p className="text-xs text-slate-400 italic">Not tied to a policy or claim</p>
          ) : (
            <>
              {row.insurance_policies && (
                <p className="text-xs">
                  <span className="text-slate-400">Policy:</span>{' '}
                  <Link href="/insurance/policies" className="text-blue-600 hover:underline">
                    {row.insurance_policies.carrier} · {row.insurance_policies.policy_type} #{row.insurance_policies.policy_number}
                  </Link>
                </p>
              )}
              {row.claim_number && (
                <p className="text-xs"><span className="text-slate-400">Claim #:</span> {row.claim_number}</p>
              )}
              {(row.adjuster_name || row.adjuster_phone || row.adjuster_email) && (
                <div className="text-xs space-y-0.5">
                  <p className="text-slate-400">Adjuster</p>
                  {row.adjuster_name && <p className="text-slate-700">{row.adjuster_name}</p>}
                  <p className="space-x-2">
                    {row.adjuster_phone && <a className="text-blue-600 hover:underline" href={`tel:${row.adjuster_phone}`}>{row.adjuster_phone}</a>}
                    {row.adjuster_email && <a className="text-blue-600 hover:underline" href={`mailto:${row.adjuster_email}`}>{row.adjuster_email}</a>}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {row.notes && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Background</h2>
          <p className="text-sm text-slate-600 whitespace-pre-line">{row.notes}</p>
        </div>
      )}

      <div className="card p-4 space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Tracking log</h2>
        <div className="flex gap-1.5">
          <input value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUpdate() } }}
            placeholder="Add a dated update…" className="input-sm flex-1" aria-label="Add update" />
          <button onClick={addUpdate} disabled={!draft.trim()}
            className="btn-secondary text-xs py-1 px-2">Add</button>
        </div>
        {log.length === 0
          ? <p className="text-xs text-slate-400 italic">No updates yet</p>
          : log.map(u => (
            <div key={u.id} className="group/upd flex items-start gap-2 text-sm border-b border-slate-200/70 last:border-0 pb-2 last:pb-0">
              <span className="text-xs text-slate-400 whitespace-nowrap pt-0.5">{formatDate(u.created_at)}</span>
              <span className="text-slate-600 whitespace-pre-line flex-1 min-w-0">{u.body}</span>
              <button onClick={() => deleteUpdate(u)} aria-label="Delete update"
                className="p-0.5 text-slate-300 opacity-0 group-hover/upd:opacity-100 hover:text-red-400 transition-all">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
      </div>

      {editing && (
        <CaseFormModal row={row} properties={properties} policies={policies}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); fetchAll() }} />
      )}
    </div>
  )
}
