'use client'

// Litigation tracker — Nick's ask (2026-08-24): one place for every
// legal matter (lawsuits, eviction/FED appeals, fair-housing
// complaints, insurance claims in settlement, inbound demands).
// One card per case: litigant, property, dates, counsel, the insurance
// tie (policy + claim # + adjuster contact), amounts, and a dated
// tracking log — whose newest entry IS the "last update" date on the
// card. The app tracks; all the lawyering happens outside it.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { InsurancePolicy, LitigationCase, LitigationUpdate, Property } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate, propertyColor } from '@/lib/utils'
import { FilterSelect } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'
import { SchemaGapNotice } from '@/components/ui/schema-gap-notice'
import { isSchemaGapError } from '@/lib/supabase/schema-errors'
import { toast } from '@/components/ui/toast'
import { Plus, Pencil, Scale, ShieldCheck, Trash2, X } from 'lucide-react'

type CaseWithJoins = LitigationCase & {
  properties?: { name: string } | null
  insurance_policies?: Pick<InsurancePolicy, 'policy_number' | 'policy_type' | 'carrier'> | null
}

const CASE_TYPES: { value: LitigationCase['case_type']; label: string }[] = [
  { value: 'lawsuit',         label: 'Lawsuit' },
  { value: 'eviction',        label: 'Eviction / FED' },
  { value: 'appeal',          label: 'Appeal' },
  { value: 'fair_housing',    label: 'Fair Housing' },
  { value: 'insurance_claim', label: 'Insurance Claim' },
  { value: 'demand',          label: 'Demand' },
  { value: 'other',           label: 'Other' },
]
const TYPE_LABEL = Object.fromEntries(CASE_TYPES.map(t => [t.value, t.label]))

const STATUSES: { value: LitigationCase['status']; label: string; style: string }[] = [
  { value: 'active',     label: 'Active',                style: 'text-red-700 bg-red-50 border-red-200' },
  { value: 'stayed',     label: 'Stayed',                style: 'text-amber-700 bg-amber-50 border-amber-200' },
  { value: 'settlement', label: 'Settlement talks',      style: 'text-violet-700 bg-violet-50 border-violet-200' },
  { value: 'closed',     label: 'Closed',                style: 'text-slate-500 bg-slate-50 border-slate-200' },
]
const STATUS_META = Object.fromEntries(STATUSES.map(s => [s.value, s]))
const STATUS_ORDER: Record<LitigationCase['status'], number> = { active: 0, settlement: 1, stayed: 2, closed: 3 }

function daysUntilDate(iso: string): number {
  return Math.ceil((new Date(iso + 'T00:00:00').getTime() - Date.now()) / 86400000)
}

export default function LitigationPage() {
  const supabase = createClient()
  const [cases, setCases] = useState<CaseWithJoins[]>([])
  const [updates, setUpdates] = useState<Record<string, LitigationUpdate[]>>({})
  const [properties, setProperties] = useState<Property[]>([])
  const [policies, setPolicies] = useState<InsurancePolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [schemaGap, setSchemaGap] = useState<{ code?: string | null; message?: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<{ row?: CaseWithJoins } | null>(null)
  const [filterProp, setFilterProp] = useState('')
  const [filterStatus, setFilterStatus] = useState('open')
  const [filterType, setFilterType] = useState('')
  const [draft, setDraft] = useState<Record<string, string>>({})

  const fetchAll = useCallback(async () => {
    const [casesRes, updatesRes, propsRes, policiesRes] = await Promise.all([
      supabase.from('litigation_cases')
        .select('*, properties(name), insurance_policies(policy_number, policy_type, carrier)')
        .order('created_at', { ascending: false }),
      supabase.from('litigation_updates').select('*').order('created_at', { ascending: false }),
      supabase.from('properties').select('*').order('name'),
      supabase.from('insurance_policies').select('*').eq('status', 'active').order('policy_type'),
    ])
    if (casesRes.error) {
      if (isSchemaGapError(casesRes.error)) setSchemaGap(casesRes.error)
      else setError(casesRes.error.message)
      setLoading(false)
      return
    }
    setSchemaGap(null)
    setError(null)
    setCases((casesRes.data ?? []) as CaseWithJoins[])
    const grouped: Record<string, LitigationUpdate[]> = {}
    for (const u of (updatesRes.data ?? []) as LitigationUpdate[]) (grouped[u.case_id] ??= []).push(u)
    setUpdates(grouped)
    setProperties(propsRes.data ?? [])
    setPolicies((policiesRes.data ?? []) as InsurancePolicy[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const visible = useMemo(() => cases
    .filter(c => {
      if (filterProp && c.property_id !== filterProp) return false
      if (filterStatus === 'open' && c.status === 'closed') return false
      if (filterStatus !== 'open' && filterStatus !== 'all' && c.status !== filterStatus) return false
      if (filterType && c.case_type !== filterType) return false
      return true
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.next_deadline ?? '9999').localeCompare(b.next_deadline ?? '9999')),
    [cases, filterProp, filterStatus, filterType])

  const openCount = cases.filter(c => c.status !== 'closed').length

  async function addUpdate(caseId: string) {
    const body = (draft[caseId] ?? '').trim()
    if (!body) return
    const { error: e } = await supabase.from('litigation_updates').insert({ case_id: caseId, body })
    if (e) { toast(`Couldn't add update — ${e.message}`, { tone: 'error' }); return }
    setDraft(d => ({ ...d, [caseId]: '' }))
    fetchAll()
  }

  // House delete pattern: act immediately, offer Undo (full row restore).
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

  async function deleteCase(row: CaseWithJoins) {
    // Updates cascade — deletion loses the log, so this one confirms.
    if (!window.confirm(`Delete "${row.title}" and its tracking log?`)) return
    const { error: e } = await supabase.from('litigation_cases').delete().eq('id', row.id)
    if (e) { toast(`Couldn't delete — ${e.message}`, { tone: 'error' }); return }
    fetchAll()
  }

  const filtersActive = filterProp || filterType || filterStatus !== 'open'

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Litigation</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {openCount} open matter{openCount === 1 ? '' : 's'}
          </p>
        </div>
        <button onClick={() => setForm({})} className="btn-primary"><Plus size={14} />New Case</button>
      </div>

      {schemaGap && (
        <SchemaGapNotice error={schemaGap}
          detail="The litigation tracker needs migration 0017 (litigation_cases + litigation_updates) — run it in the Supabase SQL Editor. Nothing has been lost." />
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!schemaGap && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <FilterSelect value={filterProp} onChange={setFilterProp}>
              <option value="">All properties</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </FilterSelect>
            <FilterSelect value={filterStatus} onChange={setFilterStatus}>
              <option value="open">Open (not closed)</option>
              <option value="all">All statuses</option>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </FilterSelect>
            <FilterSelect value={filterType} onChange={setFilterType}>
              <option value="">All types</option>
              {CASE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </FilterSelect>
            {filtersActive && (
              <button onClick={() => { setFilterProp(''); setFilterStatus('open'); setFilterType('') }}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                <X size={11} />Clear
              </button>
            )}
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
          ) : visible.length === 0 ? (
            <EmptyState icon={<Scale size={32} />} title="No matters match your filters" />
          ) : (
            <div className="space-y-4">
              {visible.map(c => {
                const log = updates[c.id] ?? []
                const lastUpdate = log[0]?.created_at ?? c.updated_at
                const deadlineDays = c.next_deadline ? daysUntilDate(c.next_deadline) : null
                const meta = STATUS_META[c.status]
                return (
                  <div key={c.id} className="card p-5 space-y-3">
                    <div className="flex items-start gap-2 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <h2 className="text-sm font-semibold text-slate-900">{c.title}</h2>
                        <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-slate-500">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ background: propertyColor(c.properties?.name) }} />
                            {c.properties?.name ?? 'No property'}
                          </span>
                          {c.litigant && <span>· {c.litigant}</span>}
                          {c.case_number && <span>· #{c.case_number}</span>}
                          {c.court && <span>· {c.court}</span>}
                        </div>
                      </div>
                      <span className="badge text-slate-600 bg-slate-50 border-slate-200">{TYPE_LABEL[c.case_type]}</span>
                      <span className={cn('badge', meta.style)}>{meta.label}</span>
                      <span className="flex items-center gap-0.5">
                        <button onClick={() => setForm({ row: c })} aria-label="Edit case"
                          className="p-1.5 text-slate-300 hover:text-slate-600 transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => deleteCase(c)} aria-label="Delete case"
                          className="p-1.5 text-slate-300 hover:text-red-400 transition-colors"><Trash2 size={13} /></button>
                      </span>
                    </div>

                    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-slate-500">
                      {c.date_of_notice && <span>Notice {formatDate(c.date_of_notice)}</span>}
                      <span>Last update {formatDate(lastUpdate)}</span>
                      {c.next_deadline && (
                        <span className={cn('font-medium',
                          deadlineDays != null && deadlineDays <= 14 ? 'text-red-600' : 'text-slate-600')}>
                          {c.next_deadline_label || 'Deadline'} {formatDate(c.next_deadline)}
                          {deadlineDays != null && deadlineDays >= 0 && ` (${deadlineDays}d)`}
                          {deadlineDays != null && deadlineDays < 0 && ' (past)'}
                        </span>
                      )}
                      {c.demand_amount != null && <span>Demand {formatCurrency(c.demand_amount)}</span>}
                      {c.settlement_amount != null && <span>Settlement {formatCurrency(c.settlement_amount)}</span>}
                      {c.resolved_at && <span>Resolved {formatDate(c.resolved_at)}</span>}
                    </div>

                    {(c.our_counsel || c.opposing_counsel) && (
                      <div className="text-xs text-slate-600 space-y-0.5">
                        {c.our_counsel && <p><span className="text-slate-400">Our counsel:</span> {c.our_counsel}</p>}
                        {c.opposing_counsel && <p><span className="text-slate-400">Opposing:</span> {c.opposing_counsel}</p>}
                      </div>
                    )}

                    {(c.insurance_policy_id || c.claim_number || c.adjuster_name) && (
                      <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-0.5">
                        <p className="flex items-center gap-1.5 font-medium text-slate-700">
                          <ShieldCheck size={12} className="text-emerald-600" />Insurance
                          {c.insurance_policies && (
                            <Link href="/insurance/policies" className="font-normal text-blue-600 hover:underline">
                              {c.insurance_policies.carrier} · {c.insurance_policies.policy_type} #{c.insurance_policies.policy_number}
                            </Link>
                          )}
                        </p>
                        {c.claim_number && <p>Claim #{c.claim_number}</p>}
                        {(c.adjuster_name || c.adjuster_email || c.adjuster_phone) && (
                          <p>
                            Adjuster: {c.adjuster_name}
                            {c.adjuster_phone && <> · <a className="text-blue-600 hover:underline" href={`tel:${c.adjuster_phone}`}>{c.adjuster_phone}</a></>}
                            {c.adjuster_email && <> · <a className="text-blue-600 hover:underline" href={`mailto:${c.adjuster_email}`}>{c.adjuster_email}</a></>}
                          </p>
                        )}
                      </div>
                    )}

                    {c.notes && <p className="text-xs text-slate-600 whitespace-pre-line">{c.notes}</p>}

                    {/* Dated tracking log — newest first; the top entry is
                        the card's "last update" date. */}
                    <div className="border-t border-slate-200/70 pt-2.5 space-y-1.5">
                      <div className="flex gap-1.5">
                        <input value={draft[c.id] ?? ''}
                          onChange={e => setDraft(d => ({ ...d, [c.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUpdate(c.id) } }}
                          placeholder="Add a dated update…" className="input-sm flex-1"
                          aria-label={`Add update for ${c.title}`} />
                        <button onClick={() => addUpdate(c.id)} disabled={!(draft[c.id] ?? '').trim()}
                          className="btn-secondary text-xs py-1 px-2">Add</button>
                      </div>
                      {log.map(u => (
                        <div key={u.id} className="group/upd flex items-start gap-2 text-xs">
                          <span className="text-slate-400 whitespace-nowrap pt-px">{formatDate(u.created_at)}</span>
                          <span className="text-slate-600 whitespace-pre-line flex-1 min-w-0">{u.body}</span>
                          <button onClick={() => deleteUpdate(u)} aria-label="Delete update"
                            className="p-0.5 text-slate-300 opacity-0 group-hover/upd:opacity-100 hover:text-red-400 transition-all">
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {form && (
        <CaseFormModal row={form.row} properties={properties} policies={policies}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); fetchAll() }} />
      )}
    </div>
  )
}

// ── Add / edit modal ─────────────────────────────────────────

function CaseFormModal({ row, properties, policies, onClose, onSaved }: {
  row?: CaseWithJoins
  properties: Property[]
  policies: InsurancePolicy[]
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [f, setF] = useState({
    title: row?.title ?? '',
    property_id: row?.property_id ?? '',
    litigant: row?.litigant ?? '',
    case_type: row?.case_type ?? 'lawsuit',
    status: row?.status ?? 'active',
    case_number: row?.case_number ?? '',
    court: row?.court ?? '',
    date_of_notice: row?.date_of_notice ?? '',
    next_deadline: row?.next_deadline ?? '',
    next_deadline_label: row?.next_deadline_label ?? '',
    our_counsel: row?.our_counsel ?? '',
    opposing_counsel: row?.opposing_counsel ?? '',
    insurance_policy_id: row?.insurance_policy_id ?? '',
    claim_number: row?.claim_number ?? '',
    adjuster_name: row?.adjuster_name ?? '',
    adjuster_email: row?.adjuster_email ?? '',
    adjuster_phone: row?.adjuster_phone ?? '',
    demand_amount: row?.demand_amount?.toString() ?? '',
    settlement_amount: row?.settlement_amount?.toString() ?? '',
    resolved_at: row?.resolved_at ?? '',
    notes: row?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF(v => ({ ...v, [k]: e.target.value }))

  // Policies for the picked property (portfolio policies have null
  // property_id and are offered everywhere).
  const propertyPolicies = policies.filter(p => !f.property_id || p.property_id === f.property_id || p.property_id == null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!f.title.trim()) return
    setSaving(true)
    const fields = {
      title: f.title.trim(),
      property_id: f.property_id || null,
      litigant: f.litigant.trim() || null,
      case_type: f.case_type as LitigationCase['case_type'],
      status: f.status as LitigationCase['status'],
      case_number: f.case_number.trim() || null,
      court: f.court.trim() || null,
      date_of_notice: f.date_of_notice || null,
      next_deadline: f.next_deadline || null,
      next_deadline_label: f.next_deadline_label.trim() || null,
      our_counsel: f.our_counsel.trim() || null,
      opposing_counsel: f.opposing_counsel.trim() || null,
      insurance_policy_id: f.insurance_policy_id || null,
      claim_number: f.claim_number.trim() || null,
      adjuster_name: f.adjuster_name.trim() || null,
      adjuster_email: f.adjuster_email.trim() || null,
      adjuster_phone: f.adjuster_phone.trim() || null,
      demand_amount: f.demand_amount !== '' ? parseFloat(f.demand_amount) : null,
      settlement_amount: f.settlement_amount !== '' ? parseFloat(f.settlement_amount) : null,
      resolved_at: f.resolved_at || null,
      notes: f.notes.trim() || null,
    }
    const { error } = row
      ? await supabase.from('litigation_cases')
          .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', row.id)
      : await supabase.from('litigation_cases').insert(fields)
    setSaving(false)
    if (error) { toast(`Couldn't save — ${error.message}`, { tone: 'error' }); return }
    onSaved()
  }

  return (
    <Modal title={row ? 'Edit Case' : 'New Case'} onClose={onClose} maxWidth="xl">
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
        <div><label className="label">Title *</label>
          <input required value={f.title} onChange={set('title')} className="input"
            placeholder="e.g. Singleton v. C2 Main Street (habitability)" /></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="label">Property</label>
            <select value={f.property_id} onChange={set('property_id')} className="input">
              <option value="">None / portfolio</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div><label className="label">Litigant</label>
            <input value={f.litigant} onChange={set('litigant')} className="input" placeholder="Opposing party" /></div>
          <div><label className="label">Type</label>
            <select value={f.case_type} onChange={set('case_type')} className="input">
              {CASE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select></div>
          <div><label className="label">Status</label>
            <select value={f.status} onChange={set('status')} className="input">
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select></div>
          <div><label className="label">Case #</label>
            <input value={f.case_number} onChange={set('case_number')} className="input" /></div>
          <div><label className="label">Court / venue</label>
            <input value={f.court} onChange={set('court')} className="input" /></div>
          <div><label className="label">Date of notice</label>
            <input type="date" value={f.date_of_notice} onChange={set('date_of_notice')} className="input" /></div>
          <div><label className="label">Next deadline</label>
            <input type="date" value={f.next_deadline} onChange={set('next_deadline')} className="input" /></div>
          <div><label className="label">Deadline label</label>
            <input value={f.next_deadline_label} onChange={set('next_deadline_label')} className="input"
              placeholder="e.g. Settlement offer expires" /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="label">Our counsel</label>
            <input value={f.our_counsel} onChange={set('our_counsel')} className="input"
              placeholder="Name, firm, phone/email" /></div>
          <div><label className="label">Opposing counsel</label>
            <input value={f.opposing_counsel} onChange={set('opposing_counsel')} className="input"
              placeholder="Or pro se" /></div>
        </div>
        <fieldset className="border border-slate-200 rounded-lg px-3 pb-3 pt-1">
          <legend className="text-xs font-medium text-slate-500 px-1">Insurance</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label">Policy</label>
              <select value={f.insurance_policy_id} onChange={set('insurance_policy_id')} className="input">
                <option value="">Not tied to a policy</option>
                {propertyPolicies.map(p => (
                  <option key={p.id} value={p.id}>{p.policy_type} — {p.carrier} #{p.policy_number}</option>
                ))}
              </select></div>
            <div><label className="label">Claim #</label>
              <input value={f.claim_number} onChange={set('claim_number')} className="input" /></div>
            <div><label className="label">Adjuster name</label>
              <input value={f.adjuster_name} onChange={set('adjuster_name')} className="input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Adjuster phone</label>
                <input value={f.adjuster_phone} onChange={set('adjuster_phone')} className="input" /></div>
              <div><label className="label">Adjuster email</label>
                <input type="email" value={f.adjuster_email} onChange={set('adjuster_email')} className="input" /></div>
            </div>
          </div>
        </fieldset>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="label">Demand ($)</label>
            <input type="number" step="any" value={f.demand_amount} onChange={set('demand_amount')} className="input" /></div>
          <div><label className="label">Settlement ($)</label>
            <input type="number" step="any" value={f.settlement_amount} onChange={set('settlement_amount')} className="input" /></div>
          <div><label className="label">Resolved</label>
            <input type="date" value={f.resolved_at} onChange={set('resolved_at')} className="input" /></div>
        </div>
        <div><label className="label">Background notes</label>
          <textarea value={f.notes} onChange={set('notes')} className="input min-h-[80px] resize-none"
            placeholder="Summary and context — the dated log on the card tracks ongoing developments" /></div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving || !f.title.trim()} className="btn-primary">
            {saving ? 'Saving…' : row ? 'Save' : 'Create case'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
