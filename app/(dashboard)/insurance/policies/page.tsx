'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InsurancePolicy, Property } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate, daysUntil } from '@/lib/utils'
import { useSort, Th } from '@/lib/utils/sort'
import { Plus, X, Shield, AlertTriangle, ChevronDown, Search } from 'lucide-react'
import { InlineSelect } from '@/components/ui/inline-edit'

const POLICY_TYPES = ['gl','property','umbrella','workers_comp','auto','other'] as const
const POLICY_TYPE_LABELS: Record<string,string> = { gl:'General Liability', property:'Property', umbrella:'Umbrella', workers_comp:"Workers' Comp", auto:'Commercial Auto', other:'Other' }
type PolicyWithProp = InsurancePolicy & { properties?: { name: string } | null }

export default function InsurancePoliciesPage() {
  const supabase = createClient()
  const [policies, setPolicies] = useState<PolicyWithProp[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editPolicy, setEditPolicy] = useState<PolicyWithProp | null>(null)
  const [filterProp, setFilterProp] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('active')
  const [search, setSearch] = useState('')
  const { sort, dir, toggle, sortFn } = useSort<string>('expiry_date', 'asc')

  const fetchPolicies = useCallback(async () => {
    let q = (supabase.from('insurance_policies') as any).select('*, properties(name)')
    if (filterProp) q = q.eq('property_id', filterProp)
    if (filterType) q = q.eq('policy_type', filterType)
    if (filterStatus !== 'all') q = q.eq('status', filterStatus)
    const { data } = await q
    setPolicies(data ?? [])
    setLoading(false)
  }, [filterProp, filterType, filterStatus])

  useEffect(() => { fetchPolicies() }, [fetchPolicies])
  useEffect(() => { supabase.from('properties').select('*').order('name').then(({ data }) => setProperties(data ?? [])) }, [])

  const displayed = [...policies]
    .filter(p => { if (!search) return true; const s = search.toLowerCase(); return p.carrier.toLowerCase().includes(s) || (p.properties?.name ?? '').toLowerCase().includes(s) || p.policy_number?.toLowerCase().includes(s) })
    .sort(sortFn)

  const expiring = displayed.filter(p => { const d = daysUntil(p.expiry_date); return d != null && d <= 90 })
  const totalPremium = policies.filter(p => p.status === 'active').reduce((s, p) => s + (p.annual_premium ?? 0), 0)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="page-title">Insurance Policies</h1><p className="text-sm text-slate-500 mt-0.5">{displayed.length} policies · {formatCurrency(totalPremium, true)}/yr</p></div>
        <button onClick={() => { setEditPolicy(null); setShowForm(true) }} className="btn-primary"><Plus size={14} />Add Policy</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Policies', value: String(policies.length) },
          { label: 'Expiring ≤ 90d', value: String(expiring.length), warn: expiring.length > 0 },
          { label: 'Annual Premium', value: formatCurrency(totalPremium, true) },
          { label: 'Expired', value: String(policies.filter(p => p.status === 'expired').length), warn: policies.some(p => p.status === 'expired') },
        ].map(({ label, value, warn }) => (
          <div key={label} className="card p-4">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</div>
            <div className={cn('text-2xl font-semibold', warn ? 'text-red-600' : 'text-slate-900')}>{value}</div>
          </div>
        ))}
      </div>

      {expiring.length > 0 && (
        <div className="p-3 border border-amber-200 bg-amber-50 rounded-xl">
          <div className="flex items-center gap-2 mb-1.5"><AlertTriangle size={13} className="text-amber-600" /><span className="text-sm font-semibold text-amber-800">{expiring.length} polic{expiring.length === 1 ? 'y' : 'ies'} expiring within 90 days</span></div>
          {expiring.map(p => { const d = daysUntil(p.expiry_date); return (
            <div key={p.id} className="flex items-center gap-2 text-xs text-amber-700 py-0.5 ml-5 cursor-pointer hover:text-amber-900" onClick={() => { setEditPolicy(p); setShowForm(true) }}>
              <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', (d ?? 0) <= 0 ? 'bg-red-500' : (d ?? 999) <= 30 ? 'bg-red-400' : 'bg-amber-400')} />
              <span className="font-medium">{p.carrier}</span><span className="text-amber-400">·</span>
              <span>{POLICY_TYPE_LABELS[p.policy_type] ?? p.policy_type}</span><span className="text-amber-400">·</span>
              <span>{(p as any).properties?.name ?? 'Portfolio'}</span>
              <span className="ml-auto font-semibold">{(d ?? 0) <= 0 ? 'EXPIRED' : `${d}d`}</span>
            </div>
          )})}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative"><Search size={13} className="absolute left-2.5 top-2 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-44 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Search carrier…" /></div>
        <Sel value={filterProp} onChange={setFilterProp}><option value="">All properties</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
        <Sel value={filterType} onChange={setFilterType}><option value="">All types</option>{POLICY_TYPES.map(t => <option key={t} value={t}>{POLICY_TYPE_LABELS[t]}</option>)}</Sel>
        <Sel value={filterStatus} onChange={setFilterStatus}><option value="active">Active</option><option value="all">All</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></Sel>
        {(filterProp || filterType || filterStatus !== 'active' || search) && <button onClick={() => { setFilterProp(''); setFilterType(''); setFilterStatus('active'); setSearch('') }} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"><X size={11} />Clear</button>}
        <span className="ml-auto text-xs text-slate-400">{displayed.length} shown</span>
      </div>

      {/* Table */}
      {loading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : displayed.length === 0 ? (
        <div className="py-12 text-center card"><Shield size={32} className="text-slate-200 mx-auto mb-3" /><p className="text-sm text-slate-400">No policies found</p></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <Th label="Property" field="property_id" current={sort} dir={dir} onSort={toggle} className="pl-4" />
                <Th label="Type" field="policy_type" current={sort} dir={dir} onSort={toggle} />
                <Th label="Carrier" field="carrier" current={sort} dir={dir} onSort={toggle} />
                <Th label="Policy #" />
                <Th label="Effective" field="effective_date" current={sort} dir={dir} onSort={toggle} />
                <Th label="Expires" field="expiry_date" current={sort} dir={dir} onSort={toggle} />
                <Th label="Days Left" align="center" />
                <Th label="Per Occ" field="per_occurrence" current={sort} dir={dir} onSort={toggle} align="right" />
                <Th label="Aggregate" field="aggregate_limit" current={sort} dir={dir} onSort={toggle} align="right" />
                <Th label="Premium" field="annual_premium" current={sort} dir={dir} onSort={toggle} align="right" />
                <Th label="Status" field="status" current={sort} dir={dir} onSort={toggle} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayed.map(p => {
                const days = daysUntil(p.expiry_date)
                const urgent = (days ?? 999) <= 30
                const warn = (days ?? 999) <= 90
                const expired = p.status === 'expired' || (days ?? 999) <= 0
                return (
                  <tr key={p.id} className="hover:bg-slate-50 cursor-pointer group" onClick={() => { setEditPolicy(p); setShowForm(true) }}>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{(p as any).properties?.name ?? '—'}</td>
                    <td className="px-3 py-2.5"><span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{POLICY_TYPE_LABELS[p.policy_type] ?? p.policy_type}</span></td>
                    <td className="px-3 py-2.5 font-medium text-slate-800 text-xs">{p.carrier}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500 font-mono">{p.policy_number ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{formatDate(p.effective_date)}</td>
                    <td className={cn('px-3 py-2.5 text-xs font-medium', expired ? 'text-red-600' : warn ? 'text-amber-600' : 'text-slate-700')}>{formatDate(p.expiry_date)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', expired ? 'bg-red-50 text-red-600' : urgent ? 'bg-red-50 text-red-500' : warn ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-500')}>
                        {expired ? 'EXPIRED' : days != null ? `${days}d` : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-right text-slate-700">{formatCurrency(p.per_occurrence, true)}</td>
                    <td className="px-3 py-2.5 text-xs text-right text-slate-700">{formatCurrency(p.aggregate_limit, true)}</td>
                    <td className="px-3 py-2.5 text-xs text-right text-slate-700">{formatCurrency(p.annual_premium, true)}</td>
                    <td className="px-3 py-2.5">
                      <InlineSelect
                        value={p.status}
                        options={[
                          { value: 'active',    label: 'active',    className: 'text-emerald-700 bg-emerald-50 border border-emerald-200' },
                          { value: 'expired',   label: 'expired',   className: 'text-red-700 bg-red-50 border border-red-200' },
                          { value: 'cancelled', label: 'cancelled', className: 'text-slate-500 bg-slate-50 border border-slate-200' },
                        ]}
                        onSave={async v => {
                          await (supabase.from('insurance_policies') as any).update({ status: v }).eq('id', p.id)
                          fetchPolicies()
                        }}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <PolicyFormModal policy={editPolicy} properties={properties} onClose={() => { setShowForm(false); setEditPolicy(null) }} onSave={() => { setShowForm(false); setEditPolicy(null); fetchPolicies() }} />}
    </div>
  )
}

function Sel({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return <div className="relative"><select value={value} onChange={e => onChange(e.target.value)} className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-7 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">{children}</select><ChevronDown size={12} className="absolute right-2 top-2.5 text-slate-400 pointer-events-none" /></div>
}

function PolicyFormModal({ policy, properties, onClose, onSave }: { policy: PolicyWithProp | null; properties: Property[]; onClose: () => void; onSave: () => void }) {
  const supabase = createClient()
  const [form, setForm] = useState({ property_id: policy?.property_id ?? '', policy_type: policy?.policy_type ?? 'gl', carrier: policy?.carrier ?? '', policy_number: policy?.policy_number ?? '', agent_name: policy?.agent_name ?? '', agent_phone: policy?.agent_phone ?? '', agent_email: policy?.agent_email ?? '', broker_agency: policy?.broker_agency ?? '', per_occurrence: policy?.per_occurrence?.toString() ?? '', aggregate_limit: policy?.aggregate_limit?.toString() ?? '', building_coverage: policy?.building_coverage?.toString() ?? '', deductible: policy?.deductible?.toString() ?? '', annual_premium: policy?.annual_premium?.toString() ?? '', effective_date: policy?.effective_date ?? '', expiry_date: policy?.expiry_date ?? '', certificate_holder: policy?.certificate_holder ?? 'C2 Capital Partners', mortgagee: policy?.mortgagee ?? '', notes: policy?.notes ?? '' })
  const [saving, setSaving] = useState(false)
  const n = (v: string) => v !== '' ? parseFloat(v) : null
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const payload: any = { property_id: form.property_id || null, policy_type: form.policy_type, carrier: form.carrier, policy_number: form.policy_number || null, agent_name: form.agent_name || null, agent_phone: form.agent_phone || null, agent_email: form.agent_email || null, broker_agency: form.broker_agency || null, per_occurrence: n(form.per_occurrence), aggregate_limit: n(form.aggregate_limit), building_coverage: n(form.building_coverage), deductible: n(form.deductible), annual_premium: n(form.annual_premium), effective_date: form.effective_date || null, expiry_date: form.expiry_date, certificate_holder: form.certificate_holder || null, mortgagee: form.mortgagee || null, notes: form.notes || null, status: 'active' }
    if (policy) await (supabase.from('insurance_policies') as any).update(payload).eq('id', policy.id)
    else await (supabase.from('insurance_policies') as any).insert(payload)
    setSaving(false); onSave()
  }
  const F = (key: string, label: string, type = 'text') => <div><label className="label">{label}</label><input type={type} value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="input" /></div>
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white"><h2 className="font-semibold">{policy ? 'Edit Policy' : 'Add Policy'}</h2><button onClick={onClose}><X size={18} className="text-slate-400" /></button></div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Property</label><select value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))} className="input"><option value="">Portfolio-wide</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label">Policy Type *</label><select required value={form.policy_type} onChange={e => setForm(f => ({ ...f, policy_type: e.target.value }))} className="input">{POLICY_TYPES.map(t => <option key={t} value={t}>{POLICY_TYPE_LABELS[t]}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">{F('carrier', 'Carrier *')}{F('policy_number', 'Policy Number')}{F('effective_date', 'Effective Date', 'date')}{F('expiry_date', 'Expiry Date *', 'date')}</div>
          <div className="grid grid-cols-3 gap-3">{F('per_occurrence', 'Per Occurrence ($)', 'number')}{F('aggregate_limit', 'Aggregate ($)', 'number')}{F('annual_premium', 'Annual Premium ($)', 'number')}</div>
          <div className="grid grid-cols-2 gap-3">{F('agent_name', 'Agent')}{F('agent_phone', 'Agent Phone')}{F('agent_email', 'Agent Email')}{F('broker_agency', 'Broker Agency')}</div>
          <div className="grid grid-cols-2 gap-3">{F('certificate_holder', 'Certificate Holder')}{F('mortgagee', 'Mortgagee')}</div>
          <div><label className="label">Notes</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input min-h-[60px] resize-none" /></div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onClose} className="btn-ghost">Cancel</button><button type="submit" disabled={saving || !form.carrier || !form.expiry_date} className="btn-primary">{saving ? 'Saving…' : policy ? 'Save' : 'Add policy'}</button></div>
        </form>
      </div>
    </div>
  )
}
