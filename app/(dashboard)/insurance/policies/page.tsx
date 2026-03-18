'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InsurancePolicy, Property } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate, daysUntil } from '@/lib/utils'
import { Plus, X, AlertTriangle, Download, Trash2 } from 'lucide-react'

const POLICY_TYPES = ['gl','property','umbrella','workers_comp','auto','other'] as const
const TYPE_LABELS: Record<string,string> = { gl:'General Liability', property:'Property All-Risk', umbrella:'Umbrella', workers_comp:"Workers' Comp", auto:'Commercial Auto', other:'Other' }
const TYPE_STYLES: Record<string,string> = { gl:'text-blue-700 bg-blue-50 border-blue-200', property:'text-emerald-700 bg-emerald-50 border-emerald-200', umbrella:'text-purple-700 bg-purple-50 border-purple-200', workers_comp:'text-amber-700 bg-amber-50 border-amber-200', auto:'text-teal-700 bg-teal-50 border-teal-200', other:'text-slate-600 bg-slate-50 border-slate-200' }

type PolicyWithProp = InsurancePolicy & { properties?: { name: string } | null }

export default function InsurancePoliciesPage() {
  const supabase = createClient()
  const [policies, setPolicies] = useState<PolicyWithProp[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editPolicy, setEditPolicy] = useState<PolicyWithProp | null>(null)
  const [filterProp, setFilterProp] = useState('')

  const fetchPolicies = useCallback(async () => {
    let q = (supabase.from('insurance_policies') as any).select('*, properties(name)').order('expiry_date', { ascending: true })
    if (filterProp) q = q.eq('property_id', filterProp)
    const { data } = await q
    setPolicies((data as PolicyWithProp[]) ?? [])
    setLoading(false)
  }, [filterProp])

  useEffect(() => { fetchPolicies() }, [fetchPolicies])
  useEffect(() => { supabase.from('properties').select('*').order('name').then(({ data }) => setProperties(data ?? [])) }, [])

  async function downloadCoi(policy: PolicyWithProp) {
    if (!policy.coi_file_path) return
    const { data } = await supabase.storage.from('c2-documents').createSignedUrl(policy.coi_file_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deletePolicy(id: string) {
    if (!confirm('Delete this policy?')) return
    await supabase.from('insurance_policies').delete().eq('id', id)
    fetchPolicies()
  }

  const expiring90 = policies.filter(p => { const d = daysUntil(p.expiry_date); return d != null && d <= 90 })
  const totalPremium = policies.filter(p => p.status === 'active').reduce((s, p) => s + (p.annual_premium ?? 0), 0)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Insurance Policies</h1>
          <p className="text-sm text-slate-500 mt-0.5">{policies.length} policies · {formatCurrency(totalPremium, true)}/yr</p>
        </div>
        <button onClick={() => { setEditPolicy(null); setShowForm(true) }} className="btn-primary"><Plus size={14} />Add Policy</button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4"><div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Active</div><div className="text-2xl font-semibold">{policies.filter(p => p.status === 'active').length}</div></div>
        <div className="card p-4"><div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Expiring ≤90 Days</div><div className={cn('text-2xl font-semibold', expiring90.length > 0 ? 'text-amber-600' : 'text-slate-900')}>{expiring90.length}</div></div>
        <div className="card p-4"><div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Annual Premium</div><div className="text-2xl font-semibold">{formatCurrency(totalPremium, true)}</div></div>
      </div>

      {expiring90.length > 0 && (
        <div className="p-4 border border-amber-200 bg-amber-50 rounded-xl">
          <div className="flex items-center gap-2 mb-2"><AlertTriangle size={14} className="text-amber-600" /><span className="text-sm font-semibold text-amber-800">{expiring90.length} polic{expiring90.length === 1 ? 'y' : 'ies'} expiring within 90 days</span></div>
          {expiring90.map(p => { const d = daysUntil(p.expiry_date)!; return (<div key={p.id} className="flex items-center gap-2 text-xs text-amber-700 py-0.5"><span className={cn('w-1.5 h-1.5 rounded-full', d <= 30 ? 'bg-red-500' : 'bg-amber-400')} /><span className="font-medium">{p.carrier}</span><span>·</span><span>{TYPE_LABELS[p.policy_type]}</span><span>·</span><span>{p.properties?.name ?? 'Portfolio'}</span><span className="ml-auto font-medium">{d <= 0 ? 'EXPIRED' : `${d}d`}</span></div>) })}
        </div>
      )}

      <div>
        <select value={filterProp} onChange={e => setFilterProp(e.target.value)} className="input-sm w-auto">
          <option value="">All properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {loading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {policies.map(policy => {
            const days = daysUntil(policy.expiry_date)
            const urgent = (days ?? 999) <= 30
            const warn = (days ?? 999) <= 90
            return (
              <div key={policy.id} className={cn('card overflow-hidden hover:shadow-md transition-shadow group', urgent ? 'border-red-200' : warn ? 'border-amber-200' : '')}>
                <div className={cn('h-1', urgent ? 'bg-red-400' : warn ? 'bg-amber-400' : 'bg-emerald-400')} style={{ width: `${Math.max(5, Math.min(100, Math.round(((days ?? 0) / 365) * 100)))}%` }} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn('badge text-xs', TYPE_STYLES[policy.policy_type] ?? TYPE_STYLES.other)}>{TYPE_LABELS[policy.policy_type]}</span>
                        {(urgent || warn) && <span className={cn('text-xs font-semibold', urgent ? 'text-red-600' : 'text-amber-600')}>{(days ?? 0) <= 0 ? 'EXPIRED' : `${days}d left`}</span>}
                      </div>
                      <div className="font-semibold text-slate-900 text-sm">{policy.carrier}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{policy.properties?.name ?? 'Portfolio'}{policy.policy_number ? ` · ${policy.policy_number}` : ''}</div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {policy.coi_file_path && <button onClick={() => downloadCoi(policy)} className="text-slate-300 hover:text-blue-500 p-1"><Download size={13} /></button>}
                      <button onClick={() => { setEditPolicy(policy); setShowForm(true) }} className="text-slate-300 hover:text-blue-500 p-1 text-xs font-medium">Edit</button>
                      <button onClick={() => deletePolicy(policy.id)} className="text-slate-300 hover:text-red-400 p-1"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
                    {[['Per occurrence', formatCurrency(policy.per_occurrence, true)], ['Aggregate', formatCurrency(policy.aggregate_limit, true)], ['Premium', formatCurrency(policy.annual_premium, true) + '/yr'], ['Expiry', formatDate(policy.expiry_date)]].map(([l,v]) => (
                      <div key={l as string} className="flex justify-between"><span className="text-slate-400">{l}</span><span className="text-slate-700 font-medium">{v}</span></div>
                    ))}
                  </div>
                  {policy.agent_name && <div className="pt-2 border-t border-slate-100 text-xs text-slate-500"><span className="font-medium text-slate-700">{policy.agent_name}</span>{policy.agent_phone ? ` · ${policy.agent_phone}` : ''}</div>}
                  {policy.coi_file_name && <div className="mt-1.5 text-xs text-blue-500 truncate cursor-pointer" onClick={() => downloadCoi(policy)}>{policy.coi_file_name}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <PolicyForm policy={editPolicy} properties={properties}
          onClose={() => { setShowForm(false); setEditPolicy(null) }}
          onSave={() => { setShowForm(false); setEditPolicy(null); fetchPolicies() }} />
      )}
    </div>
  )
}

function PolicyForm({ policy, properties, onClose, onSave }: { policy: PolicyWithProp | null; properties: Property[]; onClose: () => void; onSave: () => void }) {
  const supabase = createClient()
  const [form, setForm] = useState({ property_id: policy?.property_id ?? '', policy_type: policy?.policy_type ?? 'gl', carrier: policy?.carrier ?? '', policy_number: policy?.policy_number ?? '', agent_name: policy?.agent_name ?? '', agent_phone: policy?.agent_phone ?? '', agent_email: policy?.agent_email ?? '', broker_agency: policy?.broker_agency ?? '', per_occurrence: policy?.per_occurrence?.toString() ?? '', aggregate_limit: policy?.aggregate_limit?.toString() ?? '', building_coverage: policy?.building_coverage?.toString() ?? '', annual_premium: policy?.annual_premium?.toString() ?? '', effective_date: policy?.effective_date ?? '', expiry_date: policy?.expiry_date ?? '', deductible: policy?.deductible?.toString() ?? '', certificate_holder: policy?.certificate_holder ?? 'C2 Capital Partners', mortgagee: policy?.mortgagee ?? '', notes: policy?.notes ?? '' })
  const [coiFile, setCoiFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    let coiPath = policy?.coi_file_path ?? null
    let coiName = policy?.coi_file_name ?? null
    if (coiFile) {
      const path = `policies/${Date.now()}-${coiFile.name}`
      await supabase.storage.from('c2-documents').upload(path, coiFile)
      coiPath = path; coiName = coiFile.name
    }
    const n = (v: string) => v !== '' ? parseFloat(v) : null
    const payload = { property_id: form.property_id || null, policy_type: form.policy_type, carrier: form.carrier, policy_number: form.policy_number || null, agent_name: form.agent_name || null, agent_phone: form.agent_phone || null, agent_email: form.agent_email || null, broker_agency: form.broker_agency || null, per_occurrence: n(form.per_occurrence), aggregate_limit: n(form.aggregate_limit), building_coverage: n(form.building_coverage), annual_premium: n(form.annual_premium), effective_date: form.effective_date || null, expiry_date: form.expiry_date, deductible: n(form.deductible), certificate_holder: form.certificate_holder || null, mortgagee: form.mortgagee || null, notes: form.notes || null, coi_file_path: coiPath, coi_file_name: coiName, status: 'active' }
    if (policy) { await (supabase.from('insurance_policies') as any).update(payload).eq('id', policy.id) }
    else { await (supabase.from('insurance_policies') as any).insert(payload) }
    setSaving(false); onSave()
  }

  const F = (key: string, label: string, type = 'text') => (
    <div><label className="label">{label}</label><input type={type} value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="input" /></div>
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white">
          <h2 className="font-semibold">{policy ? 'Edit Policy' : 'Add Insurance Policy'}</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Property</label><select value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))} className="input"><option value="">Portfolio-wide</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label">Policy Type *</label><select required value={form.policy_type} onChange={e => setForm(f => ({ ...f, policy_type: e.target.value }))} className="input">{POLICY_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">{F('carrier','Carrier *')}{F('policy_number','Policy Number')}</div>
          <div className="grid grid-cols-2 gap-3">{F('per_occurrence','Per Occurrence ($)','number')}{F('aggregate_limit','Aggregate ($)','number')}{F('annual_premium','Annual Premium ($)','number')}{F('deductible','Deductible ($)','number')}</div>
          <div className="grid grid-cols-2 gap-3">{F('effective_date','Effective Date','date')}{F('expiry_date','Expiry Date *','date')}</div>
          <div className="grid grid-cols-2 gap-3">{F('agent_name','Agent Name')}{F('agent_phone','Agent Phone')}{F('broker_agency','Broker Agency')}{F('certificate_holder','Certificate Holder')}{F('mortgagee','Mortgagee')}</div>
          <div><label className="label">COI Document</label><input type="file" accept=".pdf,.jpg,.png" onChange={e => setCoiFile(e.target.files?.[0] ?? null)} className="input-sm" /></div>
          <div>{F('notes','Notes')}</div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving || !form.carrier || !form.expiry_date} className="btn-primary">{saving ? 'Saving…' : policy ? 'Save' : 'Add policy'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
