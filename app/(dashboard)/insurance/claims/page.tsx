'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InsuranceClaim, Property } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { Plus, X, ChevronDown, AlertTriangle } from 'lucide-react'

const CLAIM_TYPES = ['property_damage', 'liability', 'loss_of_income', 'other'] as const
const CLAIM_TYPE_LABELS: Record<string, string> = {
  property_damage: 'Property Damage', liability: 'Liability',
  loss_of_income: 'Loss of Income', other: 'Other',
}
const STATUSES = ['reported', 'under_review', 'negotiating', 'settlement', 'closed', 'denied'] as const
const STATUS_STYLES: Record<string, string> = {
  reported:     'text-blue-700 bg-blue-50 border-blue-200',
  under_review: 'text-amber-700 bg-amber-50 border-amber-200',
  negotiating:  'text-purple-700 bg-purple-50 border-purple-200',
  settlement:   'text-emerald-700 bg-emerald-50 border-emerald-200',
  closed:       'text-slate-500 bg-slate-50 border-slate-200',
  denied:       'text-red-700 bg-red-50 border-red-200',
}
const STAGE_STEPS: Record<string, number> = {
  reported: 0, under_review: 1, negotiating: 2, settlement: 3, closed: 4, denied: -1,
}

type ClaimWithProp = InsuranceClaim & { properties?: { name: string } | null }

export default function InsuranceClaimsPage() {
  const supabase = createClient()
  const [claims, setClaims] = useState<ClaimWithProp[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editClaim, setEditClaim] = useState<ClaimWithProp | null>(null)
  const [filterStatus, setFilterStatus] = useState('open')
  const [filterProp, setFilterProp] = useState('')

  const fetchClaims = useCallback(async () => {
    let q = (supabase.from('insurance_claims') as any)
      .select('*, properties(name)')
      .order('date_reported', { ascending: false })
    if (filterStatus === 'open') q = q.not('status', 'in', '("closed","denied")')
    else if (filterStatus !== 'all') q = q.eq('status', filterStatus)
    if (filterProp) q = q.eq('property_id', filterProp)
    const { data } = await q
    setClaims(data ?? [])
    setLoading(false)
  }, [filterStatus, filterProp])

  useEffect(() => { fetchClaims() }, [fetchClaims])
  useEffect(() => {
    supabase.from('properties').select('*').order('name').then(({ data }) => setProperties(data ?? []))
  }, [])

  const openClaims = claims.filter(c => !['closed', 'denied'].includes(c.status))
  const totalClaimed = openClaims.reduce((s, c) => s + (c.amount_claimed ?? 0), 0)
  const totalApproved = openClaims.reduce((s, c) => s + (c.amount_approved ?? 0), 0)
  const outstanding = openClaims.reduce((s, c) => s + ((c.amount_approved ?? 0) - (c.amount_paid ?? 0)), 0)

  const PIPELINE_STAGES = ['reported', 'under_review', 'negotiating', 'settlement', 'closed']
  const stageCounts = PIPELINE_STAGES.reduce((acc, s) => {
    acc[s] = claims.filter(c => c.status === s).length
    return acc
  }, {} as Record<string, number>)

  function daysOpen(claim: InsuranceClaim) {
    const start = claim.date_reported ? new Date(claim.date_reported) : new Date(claim.created_at)
    return Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24))
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Insurance Claims</h1>
          <p className="text-sm text-slate-500 mt-0.5">{openClaims.length} open claims</p>
        </div>
        <button onClick={() => { setEditClaim(null); setShowForm(true) }} className="btn-primary">
          <Plus size={14} />New Claim
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Open Claims</div>
          <div className="text-2xl font-semibold text-slate-900">{openClaims.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Total Claimed</div>
          <div className="text-2xl font-semibold text-slate-900">{formatCurrency(totalClaimed, true)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Approved</div>
          <div className="text-2xl font-semibold text-slate-900">{formatCurrency(totalApproved, true)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Outstanding</div>
          <div className={`text-2xl font-semibold ${outstanding > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
            {formatCurrency(outstanding, true)}
          </div>
        </div>
      </div>

      {/* Pipeline */}
      <div className="card p-4">
        <div className="flex items-center gap-0">
          {PIPELINE_STAGES.map((stage, i) => (
            <button key={stage}
              onClick={() => setFilterStatus(stage)}
              className={cn('flex-1 text-center py-2 text-xs font-medium transition-colors',
                i === 0 ? 'rounded-l-lg' : '',
                i === PIPELINE_STAGES.length - 1 ? 'rounded-r-lg' : '',
                filterStatus === stage ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50 border border-slate-200',
                i > 0 ? '-ml-px' : ''
              )}>
              <div className="text-lg font-semibold">{stageCounts[stage] ?? 0}</div>
              <div className="capitalize">{stage.replace('_', ' ')}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <Sel value={filterStatus} onChange={setFilterStatus}>
          <option value="open">Open claims</option>
          <option value="all">All claims</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Sel>
        <Sel value={filterProp} onChange={setFilterProp}>
          <option value="">All properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Sel>
        {(filterStatus !== 'open' || filterProp) && (
          <button onClick={() => { setFilterStatus('open'); setFilterProp('') }}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <X size={11} />Reset
          </button>
        )}
      </div>

      {/* Claims list */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : claims.length === 0 ? (
        <div className="py-12 text-center card">
          <p className="text-sm text-slate-400">No claims match this filter</p>
        </div>
      ) : (
        <div className="space-y-4">
          {claims.map(claim => {
            const days = daysOpen(claim)
            const outstanding = (claim.amount_approved ?? 0) - (claim.amount_paid ?? 0)
            const stage = STAGE_STEPS[claim.status] ?? 0
            const stages = ['Reported', 'Review', 'Negotiating', 'Settlement', 'Closed']
            const overdue = claim.follow_up_date && new Date(claim.follow_up_date) < new Date()

            return (
              <div key={claim.id}
                className="card overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => { setEditClaim(claim); setShowForm(true) }}>
                {/* Header */}
                <div className="flex items-start justify-between gap-3 p-4 pb-3 border-b border-slate-100">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-xs font-mono text-slate-400">{claim.claim_id ?? `#${claim.id.slice(0, 6)}`}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500">{CLAIM_TYPE_LABELS[claim.claim_type] ?? claim.claim_type}</span>
                      {claim.unit_number && <span className="text-xs text-slate-400">· Unit {claim.unit_number}</span>}
                    </div>
                    <div className="font-semibold text-slate-900 text-sm leading-snug">{claim.description ?? 'No description'}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {(claim as any).properties?.name ?? 'Portfolio'}
                      {claim.date_of_loss && ` · Loss: ${formatDate(claim.date_of_loss)}`}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className={cn('badge text-xs', STATUS_STYLES[claim.status])}>
                      {claim.status.replace('_', ' ')}
                    </span>
                    <span className={cn('text-xs', days > 60 ? 'text-red-500 font-medium' : 'text-slate-400')}>
                      {days}d open
                    </span>
                  </div>
                </div>

                {/* Body: financials */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-slate-100 border-b border-slate-100">
                  {[
                    { label: 'Claimed', value: formatCurrency(claim.amount_claimed) },
                    { label: 'Approved', value: formatCurrency(claim.amount_approved) },
                    { label: 'Paid', value: formatCurrency(claim.amount_paid) },
                    { label: 'Outstanding', value: formatCurrency(outstanding > 0 ? outstanding : 0), warn: outstanding > 0 },
                  ].map(({ label, value, warn }) => (
                    <div key={label} className="px-4 py-2.5 text-center">
                      <div className="text-xs text-slate-400 mb-0.5">{label}</div>
                      <div className={cn('text-sm font-semibold', warn ? 'text-amber-600' : 'text-slate-900')}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Stage progress */}
                <div className="px-4 py-3 flex items-center gap-2">
                  <div className="flex items-center gap-1 flex-1 min-w-0">
                    {stages.map((s, i) => (
                      <div key={s} className="flex items-center gap-1 min-w-0">
                        <span className={cn(
                          'text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap',
                          i < stage ? 'bg-emerald-50 text-emerald-700' :
                          i === stage ? 'bg-blue-600 text-white' :
                          'bg-slate-50 text-slate-400'
                        )}>{s}</span>
                        {i < stages.length - 1 && <span className="text-slate-200 text-xs">›</span>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Next action */}
                {claim.next_action && (
                  <div className={cn(
                    'flex items-center gap-2 px-4 py-2 text-xs border-t',
                    overdue ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'
                  )}>
                    {overdue && <AlertTriangle size={11} className="text-red-500 flex-shrink-0" />}
                    <span className={cn('font-semibold flex-shrink-0', overdue ? 'text-red-700' : 'text-amber-700')}>
                      Next action:
                    </span>
                    <span className={overdue ? 'text-red-700' : 'text-amber-700'}>{claim.next_action}</span>
                    {claim.follow_up_date && (
                      <span className={cn('ml-auto flex-shrink-0 font-medium', overdue ? 'text-red-600' : 'text-amber-600')}>
                        {overdue ? 'OVERDUE · ' : ''}{formatDate(claim.follow_up_date)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <ClaimFormModal
          claim={editClaim}
          properties={properties}
          onClose={() => { setShowForm(false); setEditClaim(null) }}
          onSave={() => { setShowForm(false); setEditClaim(null); fetchClaims() }}
        />
      )}
    </div>
  )
}

function Sel({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-7 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">
        {children}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-2.5 text-slate-400 pointer-events-none" />
    </div>
  )
}

function ClaimFormModal({ claim, properties, onClose, onSave }: {
  claim: ClaimWithProp | null; properties: Property[]
  onClose: () => void; onSave: () => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({
    property_id:     claim?.property_id ?? '',
    claim_id:        claim?.claim_id ?? '',
    claim_type:      claim?.claim_type ?? 'property_damage',
    status:          claim?.status ?? 'reported',
    priority:        claim?.priority ?? 'high',
    unit_number:     claim?.unit_number ?? '',
    description:     claim?.description ?? '',
    date_of_loss:    claim?.date_of_loss ?? '',
    date_reported:   claim?.date_reported ?? '',
    amount_claimed:  claim?.amount_claimed?.toString() ?? '',
    amount_approved: claim?.amount_approved?.toString() ?? '',
    amount_paid:     claim?.amount_paid?.toString() ?? '',
    adjuster_name:   claim?.adjuster_name ?? '',
    adjuster_phone:  claim?.adjuster_phone ?? '',
    adjuster_email:  claim?.adjuster_email ?? '',
    next_action:     claim?.next_action ?? '',
    follow_up_date:  claim?.follow_up_date ?? '',
    notes:           claim?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const n = (v: string) => v !== '' ? parseFloat(v) : null
    const payload: any = {
      property_id: form.property_id || null,
      claim_id: form.claim_id || null,
      claim_type: form.claim_type,
      status: form.status,
      priority: form.priority,
      unit_number: form.unit_number || null,
      description: form.description || null,
      date_of_loss: form.date_of_loss || null,
      date_reported: form.date_reported || null,
      amount_claimed: n(form.amount_claimed),
      amount_approved: n(form.amount_approved),
      amount_paid: n(form.amount_paid),
      adjuster_name: form.adjuster_name || null,
      adjuster_phone: form.adjuster_phone || null,
      adjuster_email: form.adjuster_email || null,
      next_action: form.next_action || null,
      follow_up_date: form.follow_up_date || null,
      notes: form.notes || null,
    }
    if (claim) {
      await (supabase.from('insurance_claims') as any).update(payload).eq('id', claim.id)
    } else {
      await (supabase.from('insurance_claims') as any).insert(payload)
    }
    setSaving(false)
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-slate-900">{claim ? 'Edit Claim' : 'New Insurance Claim'}</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Property</label>
              <select value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))} className="input">
                <option value="">Select property</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Claim ID</label>
              <input value={form.claim_id} onChange={e => setForm(f => ({ ...f, claim_id: e.target.value }))} className="input" placeholder="e.g. 2025-001" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Claim Type *</label>
              <select required value={form.claim_type} onChange={e => setForm(f => ({ ...f, claim_type: e.target.value }))} className="input">
                {CLAIM_TYPES.map(t => <option key={t} value={t}>{CLAIM_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="input">
                {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="input">
                {['low', 'medium', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input min-h-[60px] resize-none" placeholder="Brief description of the claim…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Unit Number</label><input value={form.unit_number} onChange={e => setForm(f => ({ ...f, unit_number: e.target.value }))} className="input" placeholder="e.g. 205" /></div>
            <div><label className="label">Date of Loss</label><input type="date" value={form.date_of_loss} onChange={e => setForm(f => ({ ...f, date_of_loss: e.target.value }))} className="input" /></div>
            <div><label className="label">Date Reported</label><input type="date" value={form.date_reported} onChange={e => setForm(f => ({ ...f, date_reported: e.target.value }))} className="input" /></div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Financials</div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Amount Claimed ($)</label><input type="number" value={form.amount_claimed} onChange={e => setForm(f => ({ ...f, amount_claimed: e.target.value }))} className="input" /></div>
              <div><label className="label">Amount Approved ($)</label><input type="number" value={form.amount_approved} onChange={e => setForm(f => ({ ...f, amount_approved: e.target.value }))} className="input" /></div>
              <div><label className="label">Amount Paid ($)</label><input type="number" value={form.amount_paid} onChange={e => setForm(f => ({ ...f, amount_paid: e.target.value }))} className="input" /></div>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Adjuster</div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Name</label><input value={form.adjuster_name} onChange={e => setForm(f => ({ ...f, adjuster_name: e.target.value }))} className="input" /></div>
              <div><label className="label">Phone</label><input value={form.adjuster_phone} onChange={e => setForm(f => ({ ...f, adjuster_phone: e.target.value }))} className="input" /></div>
              <div><label className="label">Email</label><input value={form.adjuster_email} onChange={e => setForm(f => ({ ...f, adjuster_email: e.target.value }))} className="input" /></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Next Action Required</label>
              <input value={form.next_action} onChange={e => setForm(f => ({ ...f, next_action: e.target.value }))} className="input" placeholder="e.g. Awaiting adjuster site visit" />
            </div>
            <div>
              <label className="label">Follow-up Date</label>
              <input type="date" value={form.follow_up_date} onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))} className="input" />
            </div>
          </div>

          <div><label className="label">Notes</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input min-h-[60px] resize-none" /></div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : claim ? 'Save changes' : 'Create claim'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
