'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InsurancePolicy, Property } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate, daysUntil } from '@/lib/utils'
import { useSort, Th } from '@/lib/utils/sort'
import { Plus, X, Shield, AlertTriangle, Search, Upload, Sparkles, FileText, Check, Loader2, Download, Pencil, Archive, Trash2 } from 'lucide-react'
import { InlineSelect } from '@/components/ui/inline-edit'
import { FilterSelect } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { DaysLeftBadge } from '@/components/ui/days-left-badge'
import { EmptyState } from '@/components/ui/empty-state'
import { exportToExcel, fmtDate, titleCase } from '@/lib/utils/export'

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

  // OCR / drag-drop state
  const [dragOver, setDragOver] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractStatus, setExtractStatus] = useState('')
  const [extractedPolicies, setExtractedPolicies] = useState<any[] | null>(null)
  const [extractedFile, setExtractedFile] = useState<{ name: string; base64: string } | null>(null)

  const fetchPolicies = useCallback(async () => {
    let q = supabase.from('insurance_policies').select('*, properties(name)')
    if (filterProp) q = q.eq('property_id', filterProp)
    if (filterType) q = q.eq('policy_type', filterType)
    if (filterStatus !== 'all') q = q.eq('status', filterStatus as InsurancePolicy['status'])
    const { data } = await q
    setPolicies(data ?? [])
    setLoading(false)
  }, [filterProp, filterType, filterStatus])

  useEffect(() => { fetchPolicies() }, [fetchPolicies])
  useEffect(() => { supabase.from('properties').select('*').order('name').then(({ data }) => setProperties(data ?? [])) }, [])

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function handlePdfDrop(files: FileList | File[]) {
    const file = Array.from(files).find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (!file) { alert('Please drop a PDF file'); return }

    setExtracting(true)
    setExtractStatus('Reading document…')
    try {
      const base64 = await fileToBase64(file)
      setExtractStatus('Extracting policy details with AI…')

      const res = await fetch('/api/insurance/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: base64, filename: file.name }),
      })
      const data = await res.json()

      if (data.error === 'not_an_insurance_document') {
        alert("That doesn't look like an insurance document. Try a COI or policy declaration page.")
        setExtracting(false)
        return
      }
      if (!data.success) {
        const reason = data.detail
          ? `${data.error}: ${typeof data.detail === 'string' ? data.detail.slice(0, 200) : JSON.stringify(data.detail).slice(0, 200)}`
          : (data.error ?? 'unknown error')
        alert('Extraction failed — ' + reason)
        setExtracting(false)
        return
      }

      setExtractedPolicies(data.policies)
      setExtractedFile({ name: file.name, base64 })
    } catch (err: any) {
      alert('Something went wrong: ' + err.message)
    }
    setExtracting(false)
    setExtractStatus('')
  }

  const displayed = [...policies]
    .filter(p => { if (!search) return true; const s = search.toLowerCase(); return p.carrier.toLowerCase().includes(s) || (p.properties?.name ?? '').toLowerCase().includes(s) || p.policy_number?.toLowerCase().includes(s) })
    .sort(sortFn)

  const expiring = displayed.filter(p => { const d = daysUntil(p.expiry_date); return d != null && d <= 90 })
  const totalPremium = policies.filter(p => p.status === 'active').reduce((s, p) => s + (p.annual_premium ?? 0), 0)

  function exportPolicies() {
    const rows = displayed.map(p => ({
      'Property': (p as any).properties?.name ?? 'Portfolio-wide',
      'Type': titleCase(p.policy_type),
      'Carrier': p.carrier,
      'Policy #': p.policy_number ?? '',
      'Effective': fmtDate(p.effective_date),
      'Expiry': fmtDate(p.expiry_date),
      'Per Occurrence': p.per_occurrence ?? '',
      'Aggregate': p.aggregate_limit ?? '',
      'Building Coverage': (p as any).building_coverage ?? '',
      'Deductible': (p as any).deductible ?? '',
      'Annual Premium': p.annual_premium ?? '',
      'Agent': (p as any).agent_name ?? '',
      'Agent Phone': (p as any).agent_phone ?? '',
      'Agent Email': (p as any).agent_email ?? '',
      'Broker': (p as any).broker_agency ?? '',
      'Certificate Holder': (p as any).certificate_holder ?? '',
      'Mortgagee': (p as any).mortgagee ?? '',
      'Status': titleCase(p.status),
      'Notes': (p as any).notes ?? '',
    }))
    exportToExcel(rows, 'C2_Insurance_Policies', 'Policies')
  }

  async function archivePolicy(p: PolicyWithProp) {
    const next = p.status === 'archived' ? 'active' : 'archived'
    await supabase.from('insurance_policies').update({ status: next }).eq('id', p.id)
    fetchPolicies()
  }

  async function deletePolicy(p: PolicyWithProp) {
    if (!confirm(`Permanently delete the ${p.carrier} ${p.policy_type.toUpperCase()} policy? This cannot be undone.`)) return
    // Remove the stored COI file too, if any
    const coiPath = (p as any).coi_file_path
    if (coiPath) {
      try { await supabase.storage.from('c2-documents').remove([coiPath]) } catch { /* non-fatal */ }
    }
    await supabase.from('insurance_policies').delete().eq('id', p.id)
    fetchPolicies()
  }

  return (
    <div
      className="p-6 max-w-7xl mx-auto space-y-5"
      onDragOver={e => { e.preventDefault(); if (!extracting) setDragOver(true) }}
      onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
      onDrop={e => { e.preventDefault(); setDragOver(false); if (!extracting) handlePdfDrop(e.dataTransfer.files) }}>

      {/* Drag overlay */}
      {dragOver && (
        <div className="fixed inset-0 bg-blue-500/10 border-2 border-blue-400 border-dashed z-40 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl px-8 py-6 shadow-xl text-center">
            <Sparkles size={32} className="text-blue-500 mx-auto mb-2" />
            <div className="text-lg font-semibold text-blue-700">Drop COI or policy PDF</div>
            <div className="text-sm text-slate-500 mt-1">AI will extract and fill in the details</div>
          </div>
        </div>
      )}

      {/* Extracting overlay */}
      {extracting && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl px-8 py-6 shadow-xl text-center max-w-sm">
            <Loader2 size={32} className="text-blue-500 mx-auto mb-3 animate-spin" />
            <div className="text-base font-semibold text-slate-800">Reading your document</div>
            <div className="text-sm text-slate-500 mt-1">{extractStatus}</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div><h1 className="page-title">Insurance Policies</h1><p className="text-sm text-slate-500 mt-0.5">{displayed.length} policies · {formatCurrency(totalPremium, true)}/yr</p></div>
        <div className="flex items-center gap-2">
          <button onClick={exportPolicies} className="btn-secondary" disabled={displayed.length === 0}>
            <Download size={14} />Export
          </button>
          <label className="btn-secondary cursor-pointer">
            <Sparkles size={14} />Scan PDF
            <input type="file" accept=".pdf" className="hidden"
              onChange={e => { if (e.target.files?.length) handlePdfDrop(e.target.files); e.target.value = '' }} />
          </label>
          <button onClick={() => { setEditPolicy(null); setShowForm(true) }} className="btn-primary"><Plus size={14} />Add Policy</button>
        </div>
      </div>

      {/* Hint banner */}
      <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <Sparkles size={13} className="text-blue-500 flex-shrink-0" />
        <span>Drag a COI or policy PDF anywhere on this page to auto-extract carrier, limits, dates, and agent info.</span>
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
        <FilterSelect value={filterProp} onChange={setFilterProp}><option value="">All properties</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</FilterSelect>
        <FilterSelect value={filterType} onChange={setFilterType}><option value="">All types</option>{POLICY_TYPES.map(t => <option key={t} value={t}>{POLICY_TYPE_LABELS[t]}</option>)}</FilterSelect>
        <FilterSelect value={filterStatus} onChange={setFilterStatus}><option value="active">Active</option><option value="all">All</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option><option value="archived">Archived</option></FilterSelect>
        {(filterProp || filterType || filterStatus !== 'active' || search) && <button onClick={() => { setFilterProp(''); setFilterType(''); setFilterStatus('active'); setSearch('') }} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"><X size={11} />Clear</button>}
        <span className="ml-auto text-xs text-slate-400">{displayed.length} shown</span>
      </div>

      {/* Table */}
      {loading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div> : displayed.length === 0 ? (
        <EmptyState icon={<Shield size={32} />} title="No policies found" />
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
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayed.map(p => {
                const days = daysUntil(p.expiry_date)
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
                      {expired
                        ? <span className="badge text-red-700 bg-red-50 border-red-200">EXPIRED</span>
                        : <DaysLeftBadge date={p.expiry_date} red={30} yellow={90} green={90} overdueLabel="EXPIRED" />}
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
                          { value: 'archived',  label: 'archived',  className: 'text-slate-500 bg-slate-100 border border-slate-300' },
                        ]}
                        onSave={async v => {
                          await supabase.from('insurance_policies').update({ status: v as InsurancePolicy['status'] }).eq('id', p.id)
                          fetchPolicies()
                        }}
                      />
                    </td>
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditPolicy(p); setShowForm(true) }}
                          title="Edit" className="p-1 text-slate-400 hover:text-blue-500">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => archivePolicy(p)}
                          title={p.status === 'archived' ? 'Unarchive' : 'Archive'}
                          className="p-1 text-slate-400 hover:text-amber-500">
                          <Archive size={13} />
                        </button>
                        <button onClick={() => deletePolicy(p)}
                          title="Delete" className="p-1 text-slate-400 hover:text-red-500">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <PolicyFormModal policy={editPolicy} properties={properties} onClose={() => { setShowForm(false); setEditPolicy(null) }} onSave={() => { setShowForm(false); setEditPolicy(null); fetchPolicies() }} />}

      {extractedPolicies && (
        <ExtractionReviewModal
          extractedPolicies={extractedPolicies}
          extractedFile={extractedFile}
          properties={properties}
          onClose={() => { setExtractedPolicies(null); setExtractedFile(null) }}
          onSaved={() => { setExtractedPolicies(null); setExtractedFile(null); fetchPolicies() }}
        />
      )}
    </div>
  )
}

function ExtractionReviewModal({ extractedPolicies, extractedFile, properties, onClose, onSaved }: {
  extractedPolicies: any[]
  extractedFile: { name: string; base64: string } | null
  properties: Property[]
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()

  // Each extracted policy becomes an editable draft. Auto-match property from hint.
  function matchProperty(hint: string | null): string {
    if (!hint) return ''
    const h = hint.toLowerCase()
    const match = properties.find(p =>
      h.includes(p.name.toLowerCase()) ||
      (p.name.toLowerCase().split(' ')[0] && h.includes(p.name.toLowerCase().split(' ')[0])) ||
      (p.address && h.includes((p.address as string).toLowerCase().slice(0, 10)))
    )
    return match?.id ?? ''
  }

  const [drafts, setDrafts] = useState(() =>
    extractedPolicies.map(p => ({
      property_id: matchProperty(p.property_hint),
      policy_type: p.policy_type ?? 'gl',
      carrier: p.carrier ?? '',
      policy_number: p.policy_number ?? '',
      effective_date: p.effective_date ?? '',
      expiry_date: p.expiry_date ?? '',
      per_occurrence: p.per_occurrence?.toString() ?? '',
      aggregate_limit: p.aggregate_limit?.toString() ?? '',
      building_coverage: p.building_coverage?.toString() ?? '',
      deductible: p.deductible?.toString() ?? '',
      annual_premium: p.annual_premium?.toString() ?? '',
      agent_name: p.agent_name ?? '',
      agent_phone: p.agent_phone ?? '',
      agent_email: p.agent_email ?? '',
      broker_agency: p.broker_agency ?? '',
      certificate_holder: p.certificate_holder ?? '',
      mortgagee: p.mortgagee ?? '',
      notes: p.notes ?? '',
      confidence: p.confidence ?? 'medium',
      _include: true,
    }))
  )
  const [saving, setSaving] = useState(false)

  function updateDraft(i: number, key: string, value: any) {
    setDrafts(d => d.map((draft, idx) => idx === i ? { ...draft, [key]: value } : draft))
  }

  async function saveAll() {
    setSaving(true)
    const n = (v: string) => v !== '' ? parseFloat(v) : null

    // Upload the source PDF once to storage
    let coi_file_path: string | null = null
    let coi_file_name: string | null = null
    if (extractedFile) {
      try {
        const bytes = Uint8Array.from(atob(extractedFile.base64), c => c.charCodeAt(0))
        const path = `insurance/${Date.now()}-${extractedFile.name}`
        const { error } = await supabase.storage.from('c2-documents').upload(path, bytes, { contentType: 'application/pdf' })
        if (!error) { coi_file_path = path; coi_file_name = extractedFile.name }
      } catch { /* non-fatal */ }
    }

    const toSave = drafts.filter(d => d._include)
    const rows = toSave.map(d => ({
      property_id: d.property_id || null,
      policy_type: d.policy_type,
      carrier: d.carrier,
      policy_number: d.policy_number || null,
      effective_date: d.effective_date || null,
      expiry_date: d.expiry_date || null,
      per_occurrence: n(d.per_occurrence),
      aggregate_limit: n(d.aggregate_limit),
      building_coverage: n(d.building_coverage),
      deductible: n(d.deductible),
      annual_premium: n(d.annual_premium),
      agent_name: d.agent_name || null,
      agent_phone: d.agent_phone || null,
      agent_email: d.agent_email || null,
      broker_agency: d.broker_agency || null,
      certificate_holder: d.certificate_holder || null,
      mortgagee: d.mortgagee || null,
      notes: d.notes || null,
      coi_file_path,
      coi_file_name,
      status: 'active' as const,
    }))

    // Duplicate check: fetch existing policies and compare on
    // property + carrier + policy_number + effective_date (case-insensitive).
    // Property is included so a master/blanket policy covering multiple
    // properties can be entered once per property without being blocked.
    const { data: existing } = await supabase.from('insurance_policies')
      .select('property_id, carrier, policy_number, effective_date')

    function fingerprint(propertyId: string | null, carrier: string | null, policyNo: string | null, eff: string | null) {
      return `${propertyId ?? ''}|${(carrier ?? '').trim().toLowerCase()}|${(policyNo ?? '').trim().toLowerCase()}|${eff ?? ''}`
    }
    const existingKeys = new Set(
      (existing ?? [])
        .filter((e: any) => e.policy_number)
        .map((e: any) => fingerprint(e.property_id, e.carrier, e.policy_number, e.effective_date))
    )

    const seenInBatch = new Set<string>()
    const skipped: string[] = []
    const deduped = rows.filter(r => {
      if (!r.policy_number) return true  // no policy number → can't dedupe, allow
      const key = fingerprint(r.property_id, r.carrier, r.policy_number, r.effective_date)
      if (existingKeys.has(key) || seenInBatch.has(key)) {
        skipped.push(`${r.carrier} ${r.policy_number}`)
        return false
      }
      seenInBatch.add(key)
      return true
    })

    if (deduped.length) await supabase.from('insurance_policies').insert(deduped)

    setSaving(false)
    if (skipped.length) {
      alert(
        `${deduped.length} saved. ${skipped.length} skipped as duplicate${skipped.length > 1 ? 's' : ''} ` +
        `(already in your tracker):\n\n${skipped.join('\n')}`
      )
    }
    onSaved()
  }

  const includedCount = drafts.filter(d => d._include).length

  const CONF_STYLE: Record<string, string> = {
    high: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    medium: 'text-amber-700 bg-amber-50 border-amber-200',
    low: 'text-red-700 bg-red-50 border-red-200',
  }

  return (
    <Modal
      onClose={onClose}
      maxWidth="3xl"
      title={
        <div className="flex items-center gap-2">
          <Sparkles size={17} className="text-blue-500" />
          <div>
            <h2 className="font-semibold text-slate-900">Review Extracted {drafts.length > 1 ? `${drafts.length} Policies` : 'Policy'}</h2>
            <p className="text-xs text-slate-400">{extractedFile?.name} — verify before saving</p>
          </div>
        </div>
      }>
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span>AI extraction isn&apos;t perfect. Double-check the <strong>expiry dates</strong> and <strong>property assignment</strong> — those drive your renewal alerts.</span>
          </div>

          {drafts.map((d, i) => (
            <div key={i} className={cn('border rounded-xl p-4 space-y-3', d._include ? 'border-slate-200' : 'border-slate-100 bg-slate-50 opacity-60')}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={d._include} onChange={e => updateDraft(i, '_include', e.target.checked)} className="w-4 h-4" />
                  <span className="font-medium text-slate-800 text-sm">{POLICY_TYPE_LABELS[d.policy_type] ?? d.policy_type} — {d.carrier || 'Unknown carrier'}</span>
                  <span className={cn('badge text-xs', CONF_STYLE[d.confidence] ?? CONF_STYLE.medium)}>{d.confidence} confidence</span>
                </div>
              </div>

              {d._include && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Property</label>
                    <select value={d.property_id} onChange={e => updateDraft(i, 'property_id', e.target.value)} className={cn('input', !d.property_id && 'border-amber-300 bg-amber-50')}>
                      <option value="">— assign —</option>
                      {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Type</label>
                    <select value={d.policy_type} onChange={e => updateDraft(i, 'policy_type', e.target.value)} className="input">
                      {POLICY_TYPES.map(t => <option key={t} value={t}>{POLICY_TYPE_LABELS[t]}</option>)}
                    </select>
                  </div>
                  <div><label className="label">Carrier</label><input value={d.carrier} onChange={e => updateDraft(i, 'carrier', e.target.value)} className="input" /></div>
                  <div><label className="label">Policy #</label><input value={d.policy_number} onChange={e => updateDraft(i, 'policy_number', e.target.value)} className="input" /></div>
                  <div><label className="label">Effective</label><input type="date" value={d.effective_date} onChange={e => updateDraft(i, 'effective_date', e.target.value)} className="input" /></div>
                  <div><label className="label">Expiry ⚠</label><input type="date" value={d.expiry_date} onChange={e => updateDraft(i, 'expiry_date', e.target.value)} className={cn('input', !d.expiry_date && 'border-amber-300 bg-amber-50')} /></div>
                  <div><label className="label">Per Occurrence</label><input type="number" value={d.per_occurrence} onChange={e => updateDraft(i, 'per_occurrence', e.target.value)} className="input" /></div>
                  <div><label className="label">Aggregate</label><input type="number" value={d.aggregate_limit} onChange={e => updateDraft(i, 'aggregate_limit', e.target.value)} className="input" /></div>
                  <div><label className="label">Premium</label><input type="number" value={d.annual_premium} onChange={e => updateDraft(i, 'annual_premium', e.target.value)} className="input" /></div>
                  <div><label className="label">Agent</label><input value={d.agent_name} onChange={e => updateDraft(i, 'agent_name', e.target.value)} className="input" /></div>
                  <div><label className="label">Agent Phone</label><input value={d.agent_phone} onChange={e => updateDraft(i, 'agent_phone', e.target.value)} className="input" /></div>
                  <div><label className="label">Broker</label><input value={d.broker_agency} onChange={e => updateDraft(i, 'broker_agency', e.target.value)} className="input" /></div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
          <span className="text-xs text-slate-400">{includedCount} of {drafts.length} will be saved</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={saveAll} disabled={saving || includedCount === 0} className="btn-primary">
              {saving ? 'Saving…' : <><Check size={14} />Save {includedCount} {includedCount === 1 ? 'policy' : 'policies'}</>}
            </button>
          </div>
        </div>
    </Modal>
  )
}

function PolicyFormModal({ policy, properties, onClose, onSave }: { policy: PolicyWithProp | null; properties: Property[]; onClose: () => void; onSave: () => void }) {
  const supabase = createClient()
  const [form, setForm] = useState({ property_id: policy?.property_id ?? '', policy_type: policy?.policy_type ?? 'gl', carrier: policy?.carrier ?? '', policy_number: policy?.policy_number ?? '', agent_name: policy?.agent_name ?? '', agent_phone: policy?.agent_phone ?? '', agent_email: policy?.agent_email ?? '', broker_agency: policy?.broker_agency ?? '', per_occurrence: policy?.per_occurrence?.toString() ?? '', aggregate_limit: policy?.aggregate_limit?.toString() ?? '', building_coverage: policy?.building_coverage?.toString() ?? '', deductible: policy?.deductible?.toString() ?? '', annual_premium: policy?.annual_premium?.toString() ?? '', effective_date: policy?.effective_date ?? '', expiry_date: policy?.expiry_date ?? '', certificate_holder: policy?.certificate_holder ?? 'C2 Capital Partners', mortgagee: policy?.mortgagee ?? '', notes: policy?.notes ?? '' })
  const [saving, setSaving] = useState(false)
  const n = (v: string) => v !== '' ? parseFloat(v) : null
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const payload: any = { property_id: form.property_id || null, policy_type: form.policy_type, carrier: form.carrier, policy_number: form.policy_number || null, agent_name: form.agent_name || null, agent_phone: form.agent_phone || null, agent_email: form.agent_email || null, broker_agency: form.broker_agency || null, per_occurrence: n(form.per_occurrence), aggregate_limit: n(form.aggregate_limit), building_coverage: n(form.building_coverage), deductible: n(form.deductible), annual_premium: n(form.annual_premium), effective_date: form.effective_date || null, expiry_date: form.expiry_date, certificate_holder: form.certificate_holder || null, mortgagee: form.mortgagee || null, notes: form.notes || null, status: 'active' }
    if (policy) {
      await supabase.from('insurance_policies').update(payload).eq('id', policy.id)
    } else {
      // Duplicate check on new policies: property + carrier + policy_number + effective_date.
      // Property included so master/blanket policies can be entered per-property.
      if (form.policy_number) {
        let dupeQuery = supabase.from('insurance_policies')
          .select('id')
          .ilike('carrier', form.carrier)
          .ilike('policy_number', form.policy_number)
          .eq('effective_date', (form.effective_date || null) as string)
        dupeQuery = form.property_id
          ? dupeQuery.eq('property_id', form.property_id)
          : dupeQuery.is('property_id', null)
        const { data: dupes } = await dupeQuery
        if (dupes && dupes.length > 0) {
          setSaving(false)
          const propLabel = form.property_id
            ? (properties.find(p => p.id === form.property_id)?.name ?? 'this property')
            : 'portfolio-wide'
          alert(`A policy with number "${form.policy_number}" from ${form.carrier} effective ${form.effective_date || '(no date)'} already exists for ${propLabel}. Duplicate not saved.`)
          return
        }
      }
      await supabase.from('insurance_policies').insert(payload)
    }
    setSaving(false); onSave()
  }
  const F = (key: string, label: string, type = 'text') => <div><label className="label">{label}</label><input type={type} value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="input" /></div>
  return (
    <Modal title={policy ? 'Edit Policy' : 'Add Policy'} onClose={onClose} maxWidth="2xl">
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
    </Modal>
  )
}
