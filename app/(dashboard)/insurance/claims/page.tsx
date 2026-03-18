'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InsuranceClaim, Property } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useSort, Th } from '@/lib/utils/sort'
import { Plus, X, ChevronDown, AlertTriangle, Search } from 'lucide-react'

const CLAIM_TYPES = ['property_damage','liability','loss_of_income','other'] as const
const CLAIM_TYPE_LABELS: Record<string,string> = { property_damage:'Property Damage', liability:'Liability', loss_of_income:'Loss of Income', other:'Other' }
const STATUSES = ['reported','under_review','negotiating','settlement','closed','denied'] as const
const STATUS_STYLES: Record<string,string> = { reported:'text-blue-700 bg-blue-50 border-blue-200', under_review:'text-amber-700 bg-amber-50 border-amber-200', negotiating:'text-purple-700 bg-purple-50 border-purple-200', settlement:'text-emerald-700 bg-emerald-50 border-emerald-200', closed:'text-slate-500 bg-slate-50 border-slate-200', denied:'text-red-700 bg-red-50 border-red-200' }
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
  const [filterType, setFilterType] = useState('')
  const [search, setSearch] = useState('')
  const { sort, dir, toggle, sortFn } = useSort<string>('date_reported', 'desc')

  const fetchClaims = useCallback(async () => {
    let q = (supabase.from('insurance_claims') as any).select('*, properties(name)')
    if (filterStatus === 'open') q = q.not('status', 'in', '("closed","denied")')
    else if (filterStatus !== 'all') q = q.eq('status', filterStatus)
    if (filterProp) q = q.eq('property_id', filterProp)
    if (filterType) q = q.eq('claim_type', filterType)
    const { data } = await q
    setClaims(data ?? [])
    setLoading(false)
  }, [filterStatus, filterProp, filterType])

  useEffect(() => { fetchClaims() }, [fetchClaims])
  useEffect(() => { supabase.from('properties').select('*').order('name').then(({ data }) => setProperties(data ?? [])) }, [])

  const displayed = [...claims]
    .filter(c => { if (!search) return true; const s = search.toLowerCase(); return (c.description ?? '').toLowerCase().includes(s) || (c.claim_id ?? '').toLowerCase().includes(s) || (c.properties?.name ?? '').toLowerCase().includes(s) })
    .sort(sortFn)

  const totalClaimed = claims.filter(c => !['closed','denied'].includes(c.status)).reduce((s, c) => s + (c.amount_claimed ?? 0), 0)
  const totalOutstanding = claims.filter(c => !['closed','denied'].includes(c.status)).reduce((s, c) => s + ((c.amount_approved ?? 0) - (c.amount_paid ?? 0)), 0)

  function daysOpen(c: InsuranceClaim) {
    const start = c.date_reported ? new Date(c.date_reported) : new Date(c.created_at)
    return Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24))
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="page-title">Insurance Claims</h1><p className="text-sm text-slate-500 mt-0.5">{displayed.length} claims shown</p></div>
        <button onClick={() => { setEditClaim(null); setShowForm(true) }} className="btn-primary"><Plus size={14} />New Claim</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Open Claims', value: String(claims.filter(c => !['closed','denied'].includes(c.status)).length) },
          { label: 'Total Claimed', value: formatCurrency(totalClaimed, true) },
          { label: 'Outstanding', value: formatCurrency(totalOutstanding, true), warn: totalOutstanding > 0 },
          { label: 'Follow-up Today', value: String(claims.filter(c => c.follow_up_date && new Date(c.follow_up_date) <= new Date()).length), warn: claims.some(c => c.follow_up_date && new Date(c.follow_up_date) <= new Date()) },
        ].map(({ label, value, warn }) => (
          <div key={label} className="card p-4">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</div>
            <div className={cn('text-2xl font-semibold', warn ? 'text-amber-600' : 'text-slate-900')}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative"><Search size={13} className="absolute left-2.5 top-2 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-44 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Search…" /></div>
        <Sel value={filterStatus} onChange={setFilterStatus}><option value="open">Open</option><option value="all">All</option>{STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Sel>
        <Sel value={filterProp} onChange={setFilterProp}><option value="">All properties</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
        <Sel value={filterType} onChange={setFilterType}><option value="">All types</option>{CLAIM_TYPES.map(t => <option key={t} value={t}>{CLAIM_TYPE_LABELS[t]}</option>)}</Sel>
        {(filterStatus !== 'open' || filterProp || filterType || search) && <button onClick={() => { setFilterStatus('open'); setFilterProp(''); setFilterType(''); setSearch('') }} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"><X size={11} />Clear</button>}
        <span className="ml-auto text-xs text-slate-400">{displayed.length} shown</span>
      </div>

      {/* Table */}
      {loading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : displayed.length === 0 ? (
        <div className="py-12 text-center card"><p className="text-sm text-slate-400">No claims match this filter</p></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[950px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <Th label="Claim ID" className="pl-4" />
                <Th label="Property" field="property_id" current={sort} dir={dir} onSort={toggle} />
                <Th label="Type" field="claim_type" current={sort} dir={dir} onSort={toggle} />
                <Th label="Status" field="status" current={sort} dir={dir} onSort={toggle} />
                <Th label="Date Reported" field="date_reported" current={sort} dir={dir} onSort={toggle} />
                <Th label="Days Open" align="center" />
                <Th label="Claimed" field="amount_claimed" current={sort} dir={dir} onSort={toggle} align="right" />
                <Th label="Approved" field="amount_approved" current={sort} dir={dir} onSort={toggle} align="right" />
                <Th label="Paid" field="amount_paid" current={sort} dir={dir} onSort={toggle} align="right" />
                <Th label="Outstanding" align="right" />
                <Th label="Follow-up" field="follow_up_date" current={sort} dir={dir} onSort={toggle} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayed.map(c => {
                const days = daysOpen(c)
                const outstanding = (c.amount_approved ?? 0) - (c.amount_paid ?? 0)
                const overdue = c.follow_up_date && new Date(c.follow_up_date) < new Date()
                return (
                  <tr key={c.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => { setEditClaim(c); setShowForm(true) }}>
                    <td className="px-4 py-2.5 text-xs font-mono text-slate-500">{c.claim_id ?? c.id.slice(0, 8)}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{(c as any).properties?.name ?? '—'}</td>
                    <td className="px-3 py-2.5"><span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{CLAIM_TYPE_LABELS[c.claim_type] ?? c.claim_type}</span></td>
                    <td className="px-3 py-2.5"><span className={cn('badge text-xs', STATUS_STYLES[c.status])}>{c.status.replace('_', ' ')}</span></td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{formatDate(c.date_reported)}</td>
                    <td className="px-3 py-2.5 text-center"><span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', days > 60 ? 'bg-red-50 text-red-600' : days > 30 ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-500')}>{days}d</span></td>
                    <td className="px-3 py-2.5 text-xs text-right text-slate-700">{formatCurrency(c.amount_claimed)}</td>
                    <td className="px-3 py-2.5 text-xs text-right text-slate-700">{formatCurrency(c.amount_approved)}</td>
                    <td className="px-3 py-2.5 text-xs text-right text-slate-700">{formatCurrency(c.amount_paid)}</td>
                    <td className={cn('px-3 py-2.5 text-xs text-right font-medium', outstanding > 0 ? 'text-amber-600' : 'text-slate-400')}>{outstanding > 0 ? formatCurrency(outstanding) : '—'}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {c.follow_up_date ? <span className={cn('font-medium', overdue ? 'text-red-600' : 'text-slate-600')}>{overdue && <AlertTriangle size={10} className="inline mr-1" />}{formatDate(c.follow_up_date)}</span> : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <ClaimFormModal claim={editClaim} properties={properties} onClose={() => { setShowForm(false); setEditClaim(null) }} onSave={() => { setShowForm(false); setEditClaim(null); fetchClaims() }} />}
    </div>
  )
}

function Sel({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return <div className="relative"><select value={value} onChange={e => onChange(e.target.value)} className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-7 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">{children}</select><ChevronDown size={12} className="absolute right-2 top-2.5 text-slate-400 pointer-events-none" /></div>
}

function ClaimFormModal({ claim, properties, onClose, onSave }: { claim: ClaimWithProp | null; properties: Property[]; onClose: () => void; onSave: () => void }) {
  const supabase = createClient()
  const [form, setForm] = useState({ property_id: claim?.property_id ?? '', claim_id: claim?.claim_id ?? '', claim_type: claim?.claim_type ?? 'property_damage', status: claim?.status ?? 'reported', priority: claim?.priority ?? 'high', unit_number: claim?.unit_number ?? '', description: claim?.description ?? '', date_of_loss: claim?.date_of_loss ?? '', date_reported: claim?.date_reported ?? '', amount_claimed: claim?.amount_claimed?.toString() ?? '', amount_approved: claim?.amount_approved?.toString() ?? '', amount_paid: claim?.amount_paid?.toString() ?? '', adjuster_name: claim?.adjuster_name ?? '', adjuster_phone: claim?.adjuster_phone ?? '', adjuster_email: claim?.adjuster_email ?? '', next_action: claim?.next_action ?? '', follow_up_date: claim?.follow_up_date ?? '', notes: claim?.notes ?? '' })
  const [saving, setSaving] = useState(false)
  const n = (v: string) => v !== '' ? parseFloat(v) : null
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const payload: any = { property_id: form.property_id || null, claim_id: form.claim_id || null, claim_type: form.claim_type, status: form.status, priority: form.priority, unit_number: form.unit_number || null, description: form.description || null, date_of_loss: form.date_of_loss || null, date_reported: form.date_reported || null, amount_claimed: n(form.amount_claimed), amount_approved: n(form.amount_approved), amount_paid: n(form.amount_paid), adjuster_name: form.adjuster_name || null, adjuster_phone: form.adjuster_phone || null, adjuster_email: form.adjuster_email || null, next_action: form.next_action || null, follow_up_date: form.follow_up_date || null, notes: form.notes || null }
    if (claim) await (supabase.from('insurance_claims') as any).update(payload).eq('id', claim.id)
    else await (supabase.from('insurance_claims') as any).insert(payload)
    setSaving(false); onSave()
  }
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white"><h2 className="font-semibold">{claim ? 'Edit Claim' : 'New Claim'}</h2><button onClick={onClose}><X size={18} className="text-slate-400" /></button></div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Property</label><select value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))} className="input"><option value="">Select</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label">Claim ID</label><input value={form.claim_id} onChange={e => setForm(f => ({ ...f, claim_id: e.target.value }))} className="input" placeholder="e.g. 2026-001" /></div>
            <div><label className="label">Type *</label><select required value={form.claim_type} onChange={e => setForm(f => ({ ...f, claim_type: e.target.value }))} className="input">{CLAIM_TYPES.map(t => <option key={t} value={t}>{CLAIM_TYPE_LABELS[t]}</option>)}</select></div>
            <div><label className="label">Status</label><select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="input">{STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
          </div>
          <div><label className="label">Description</label><textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input min-h-[60px] resize-none" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Date of Loss</label><input type="date" value={form.date_of_loss} onChange={e => setForm(f => ({ ...f, date_of_loss: e.target.value }))} className="input" /></div>
            <div><label className="label">Date Reported</label><input type="date" value={form.date_reported} onChange={e => setForm(f => ({ ...f, date_reported: e.target.value }))} className="input" /></div>
            <div><label className="label">Unit</label><input value={form.unit_number} onChange={e => setForm(f => ({ ...f, unit_number: e.target.value }))} className="input" placeholder="e.g. 205" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Claimed ($)</label><input type="number" value={form.amount_claimed} onChange={e => setForm(f => ({ ...f, amount_claimed: e.target.value }))} className="input" /></div>
            <div><label className="label">Approved ($)</label><input type="number" value={form.amount_approved} onChange={e => setForm(f => ({ ...f, amount_approved: e.target.value }))} className="input" /></div>
            <div><label className="label">Paid ($)</label><input type="number" value={form.amount_paid} onChange={e => setForm(f => ({ ...f, amount_paid: e.target.value }))} className="input" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Next Action</label><input value={form.next_action} onChange={e => setForm(f => ({ ...f, next_action: e.target.value }))} className="input" /></div>
            <div><label className="label">Follow-up Date</label><input type="date" value={form.follow_up_date} onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))} className="input" /></div>
          </div>
          <div><label className="label">Notes</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input min-h-[60px] resize-none" /></div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className="btn-ghost">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : claim ? 'Save' : 'Create'}</button></div>
        </form>
      </div>
    </div>
  )
}
