'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InsurancePolicy, Property } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate, daysUntil } from '@/lib/utils'
import { Plus, X, Upload, Shield, AlertTriangle, ChevronDown, Download } from 'lucide-react'

const POLICY_TYPES = ['gl', 'property', 'umbrella', 'workers_comp', 'auto', 'other'] as const
const POLICY_TYPE_LABELS: Record<string, string> = {
  gl: 'General Liability', property: 'Property All-Risk',
  umbrella: 'Umbrella', workers_comp: "Workers' Comp",
  auto: 'Commercial Auto', other: 'Other',
}

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

  const fetchPolicies = useCallback(async () => {
    let q = (supabase.from('insurance_policies') as any)
      .select('*, properties(name)')
      .order('expiry_date', { ascending: true })
    if (filterProp) q = q.eq('property_id', filterProp)
    if (filterType) q = q.eq('policy_type', filterType)
    const { data } = await q
    setPolicies(data ?? [])
    setLoading(false)
  }, [filterProp, filterType])

  useEffect(() => { fetchPolicies() }, [fetchPolicies])
  useEffect(() => {
    supabase.from('properties').select('*').order('name').then(({ data }) => setProperties(data ?? []))
  }, [])

  const expiringSoon = policies.filter(p => {
    const d = daysUntil(p.expiry_date); return d != null && d <= 90
  })
  const totalPremium = policies.filter(p => p.status === 'active').reduce((s, p) => s + (p.annual_premium ?? 0), 0)

  function expiryLabel(days: number | null) {
    if (days == null) return ''
    if (days < 0) return 'EXPIRED'
    if (days === 0) return 'TODAY'
    return `${days}d`
  }

  function barPct(days: number | null) {
    return Math.max(5, Math.min(100, Math.round((days ?? 365) / 365 * 100)))
  }

  function barColor(days: number | null) {
    if (days == null) return 'bg-slate-200'
    if (days < 0) return 'bg-red-500'
    if (days <= 30) return 'bg-red-400'
    if (days <= 90) return 'bg-amber-400'
    return 'bg-emerald-400'
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Insurance Policies</h1>
          <p className="text-sm text-slate-500 mt-0.5">{policies.length} policies · {formatCurrency(totalPremium, true)}/yr total premium</p>
        </div>
        <button onClick={() => { setEditPolicy(null); setShowForm(true) }} className="btn-primary">
          <Plus size={14} />Add Policy
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Total Policies</div>
          <div className="text-2xl font-semibold text-slate-900">{policies.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Expiring ≤ 90d</div>
          <div className={`text-2xl font-semibold ${expiringSoon.length > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{expiringSoon.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Annual Premium</div>
          <div className="text-2xl font-semibold text-slate-900">{formatCurrency(totalPremium, true)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Properties Covered</div>
          <div className="text-2xl font-semibold text-slate-900">
            {new Set(policies.map(p => p.property_id).filter(Boolean)).size}
          </div>
        </div>
      </div>

      {/* Alert banner */}
      {expiringSoon.length > 0 && (
        <div className="p-4 border border-amber-200 bg-amber-50 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-amber-600" />
            <span className="text-sm font-semibold text-amber-800">
              {expiringSoon.length} polic{expiringSoon.length === 1 ? 'y' : 'ies'} expiring within 90 days
            </span>
          </div>
          {expiringSoon.map(p => {
            const days = daysUntil(p.expiry_date)
            return (
              <div key={p.id} className="flex items-center gap-2 text-xs text-amber-700 py-0.5">
                <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', (days ?? 0) <= 30 ? 'bg-red-500' : 'bg-amber-400')} />
                <span className="font-medium">{p.carrier}</span>
                <span className="text-amber-400">·</span>
                <span>{POLICY_TYPE_LABELS[p.policy_type] ?? p.policy_type}</span>
                <span className="text-amber-400">·</span>
                <span>{(p as any).properties?.name ?? 'Portfolio'}</span>
                <span className="ml-auto font-medium">{expiryLabel(days)}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Sel value={filterProp} onChange={setFilterProp}>
          <option value="">All properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Sel>
        <Sel value={filterType} onChange={setFilterType}>
          <option value="">All types</option>
          {POLICY_TYPES.map(t => <option key={t} value={t}>{POLICY_TYPE_LABELS[t]}</option>)}
        </Sel>
        {(filterProp || filterType) && (
          <button onClick={() => { setFilterProp(''); setFilterType('') }}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <X size={11} />Clear
          </button>
        )}
      </div>

      {/* Policy cards */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : policies.length === 0 ? (
        <div className="py-12 text-center card">
          <Shield size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No insurance policies found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {policies.map(policy => {
            const days = daysUntil(policy.expiry_date)
            const urgent = (days ?? 999) <= 30
            const warn = (days ?? 999) <= 90
            const pct = barPct(days)
            return (
              <div key={policy.id}
                className={cn('bg-white rounded-xl border overflow-hidden hover:shadow-md transition-shadow cursor-pointer',
                  urgent ? 'border-red-200' : warn ? 'border-amber-200' : 'border-slate-200'
                )}
                onClick={() => { setEditPolicy(policy); setShowForm(true) }}>
                {/* Expiry progress bar */}
                <div className="h-1 bg-slate-100">
                  <div className={cn('h-1 transition-all', barColor(days))} style={{ width: `${pct}%` }} />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        {POLICY_TYPE_LABELS[policy.policy_type] ?? policy.policy_type}
                      </span>
                      <div className="font-semibold text-slate-900 mt-0.5">{policy.carrier}</div>
                      <div className="text-xs text-slate-400">
                        {(policy as any).properties?.name ?? 'Portfolio-wide'}
                        {policy.policy_number && ` · ${policy.policy_number}`}
                      </div>
                    </div>
                    <span className={cn('text-sm font-bold flex-shrink-0 ml-2', urgent ? 'text-red-600' : warn ? 'text-amber-600' : 'text-slate-400')}>
                      {expiryLabel(days)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                    {policy.per_occurrence && (
                      <div>
                        <div className="text-slate-400">Per occurrence</div>
                        <div className="font-medium text-slate-700">{formatCurrency(policy.per_occurrence, true)}</div>
                      </div>
                    )}
                    {policy.aggregate_limit && (
                      <div>
                        <div className="text-slate-400">Aggregate</div>
                        <div className="font-medium text-slate-700">{formatCurrency(policy.aggregate_limit, true)}</div>
                      </div>
                    )}
                    {policy.annual_premium && (
                      <div>
                        <div className="text-slate-400">Annual premium</div>
                        <div className="font-medium text-slate-700">{formatCurrency(policy.annual_premium, true)}</div>
                      </div>
                    )}
                    <div>
                      <div className="text-slate-400">Expires</div>
                      <div className="font-medium text-slate-700">{formatDate(policy.expiry_date)}</div>
                    </div>
                  </div>

                  {policy.agent_name && (
                    <div className="text-xs text-slate-500 border-t border-slate-100 pt-2">
                      <span className="font-medium text-slate-700">{policy.agent_name}</span>
                      {policy.agent_phone && ` · ${policy.agent_phone}`}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <PolicyFormModal
          policy={editPolicy}
          properties={properties}
          onClose={() => { setShowForm(false); setEditPolicy(null) }}
          onSave={() => { setShowForm(false); setEditPolicy(null); fetchPolicies() }}
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

function PolicyFormModal({ policy, properties, onClose, onSave }: {
  policy: PolicyWithProp | null; properties: Property[]
  onClose: () => void; onSave: () => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({
    property_id:       policy?.property_id ?? '',
    policy_type:       policy?.policy_type ?? 'gl',
    carrier:           policy?.carrier ?? '',
    policy_number:     policy?.policy_number ?? '',
    agent_name:        policy?.agent_name ?? '',
    agent_phone:       policy?.agent_phone ?? '',
    agent_email:       policy?.agent_email ?? '',
    broker_agency:     policy?.broker_agency ?? '',
    per_occurrence:    policy?.per_occurrence?.toString() ?? '',
    aggregate_limit:   policy?.aggregate_limit?.toString() ?? '',
    building_coverage: policy?.building_coverage?.toString() ?? '',
    liability_coverage:policy?.liability_coverage?.toString() ?? '',
    deductible:        policy?.deductible?.toString() ?? '',
    annual_premium:    policy?.annual_premium?.toString() ?? '',
    effective_date:    policy?.effective_date ?? '',
    expiry_date:       policy?.expiry_date ?? '',
    certificate_holder:policy?.certificate_holder ?? 'C2 Capital Partners',
    mortgagee:         policy?.mortgagee ?? '',
    notes:             policy?.notes ?? '',
  })
  const [coiFile, setCoiFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const n = (v: string) => v !== '' ? parseFloat(v) : null

    let coi_file_path = policy?.coi_file_path ?? null
    let coi_file_name = policy?.coi_file_name ?? null
    if (coiFile) {
      const path = `policies/${Date.now()}-${coiFile.name}`
      await supabase.storage.from('c2-documents').upload(path, coiFile)
      coi_file_path = path
      coi_file_name = coiFile.name
    }

    const payload: any = {
      property_id: form.property_id || null,
      policy_type: form.policy_type,
      carrier: form.carrier,
      policy_number: form.policy_number || null,
      agent_name: form.agent_name || null,
      agent_phone: form.agent_phone || null,
      agent_email: form.agent_email || null,
      broker_agency: form.broker_agency || null,
      per_occurrence: n(form.per_occurrence),
      aggregate_limit: n(form.aggregate_limit),
      building_coverage: n(form.building_coverage),
      liability_coverage: n(form.liability_coverage),
      deductible: n(form.deductible),
      annual_premium: n(form.annual_premium),
      effective_date: form.effective_date || null,
      expiry_date: form.expiry_date,
      certificate_holder: form.certificate_holder || null,
      mortgagee: form.mortgagee || null,
      notes: form.notes || null,
      coi_file_path, coi_file_name,
      status: 'active',
    }

    if (policy) {
      await (supabase.from('insurance_policies') as any).update(payload).eq('id', policy.id)
    } else {
      await (supabase.from('insurance_policies') as any).insert(payload)
    }
    setSaving(false)
    onSave()
  }

  const F = (key: string, label: string, type = 'text', placeholder = '') => (
    <div>
      <label className="label">{label}</label>
      <input type={type} value={(form as any)[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="input" placeholder={placeholder} />
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-slate-900">{policy ? 'Edit Policy' : 'Add Insurance Policy'}</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Property</label>
              <select value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))} className="input">
                <option value="">Portfolio-wide</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Policy Type *</label>
              <select required value={form.policy_type} onChange={e => setForm(f => ({ ...f, policy_type: e.target.value }))} className="input">
                {POLICY_TYPES.map(t => <option key={t} value={t}>{POLICY_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Policy Info</div>
            <div className="grid grid-cols-2 gap-3">
              {F('carrier', 'Carrier *')}
              {F('policy_number', 'Policy Number')}
              {F('effective_date', 'Effective Date', 'date')}
              {F('expiry_date', 'Expiry Date *', 'date')}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Coverage Limits</div>
            <div className="grid grid-cols-2 gap-3">
              {F('per_occurrence', 'Per Occurrence ($)', 'number')}
              {F('aggregate_limit', 'Aggregate Limit ($)', 'number')}
              {F('building_coverage', 'Building Coverage ($)', 'number')}
              {F('liability_coverage', 'Liability Coverage ($)', 'number')}
              {F('deductible', 'Deductible ($)', 'number')}
              {F('annual_premium', 'Annual Premium ($)', 'number')}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Agent / Broker</div>
            <div className="grid grid-cols-2 gap-3">
              {F('agent_name', 'Agent Name')}
              {F('agent_phone', 'Agent Phone')}
              {F('agent_email', 'Agent Email')}
              {F('broker_agency', 'Broker Agency')}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {F('certificate_holder', 'Certificate Holder')}
            {F('mortgagee', 'Mortgagee / Lender')}
          </div>

          {/* COI upload */}
          <div>
            <label className="label">COI Document</label>
            <div
              onClick={() => document.getElementById('coi-input')?.click()}
              className="border border-dashed border-slate-200 rounded-lg p-3 text-center cursor-pointer hover:border-slate-300 transition-colors">
              {coiFile ? (
                <div className="text-sm text-slate-700">{coiFile.name}</div>
              ) : policy?.coi_file_name ? (
                <div className="text-sm text-slate-500">Current: {policy.coi_file_name} <span className="text-blue-500">(click to replace)</span></div>
              ) : (
                <div className="text-sm text-slate-400 flex items-center justify-center gap-2"><Upload size={14} />Drop COI PDF here or click to browse</div>
              )}
              <input id="coi-input" type="file" accept=".pdf,.jpg,.png" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) setCoiFile(f) }} />
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="input min-h-[60px] resize-none" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving || !form.carrier || !form.expiry_date} className="btn-primary">
              {saving ? 'Saving…' : policy ? 'Save changes' : 'Add policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
