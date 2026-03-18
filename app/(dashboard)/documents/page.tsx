'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Property } from '@/lib/supabase/types'
import { cn, formatDate, formatCurrency, daysUntil } from '@/lib/utils'
import {
  Plus, X, Upload, AlertTriangle, ChevronDown,
  ChevronUp, Download, Trash2, FileText, Search,
} from 'lucide-react'

const CONTRACT_TYPES = [
  'laundry', 'trash', 'pest_control', 'landscaping', 'elevator',
  'hvac', 'plumbing', 'electrical', 'security', 'internet',
  'cable', 'parking', 'management', 'insurance', 'utility', 'other',
] as const

const TYPE_LABELS: Record<string, string> = {
  laundry: 'Laundry', trash: 'Trash / Waste', pest_control: 'Pest Control',
  landscaping: 'Landscaping', elevator: 'Elevator', hvac: 'HVAC',
  plumbing: 'Plumbing', electrical: 'Electrical', security: 'Security',
  internet: 'Internet / Telecom', cable: 'Cable', parking: 'Parking',
  management: 'Management', insurance: 'Insurance', utility: 'Utility', other: 'Other',
}

const CANCEL_METHOD_LABELS: Record<string, string> = {
  certified_mail: 'Certified Mail', email: 'Email',
  written: 'Written Notice', any: 'Any Written',
}

type Contract = {
  id: string
  property_id: string | null
  title: string
  vendor_name: string
  contract_type: string
  vendor_contact_name: string | null
  vendor_contact_email: string | null
  vendor_contact_phone: string | null
  account_number: string | null
  agreement_number: string | null
  execution_date: string | null
  commencement_date: string | null
  expiration_date: string | null
  auto_renews: boolean | null
  renewal_term_months: number | null
  cancel_notice_days: number | null
  cancel_deadline: string | null
  cancel_method: string | null
  monthly_cost: number | null
  annual_cost: number | null
  rate_escalation: string | null
  revenue_share_pct: number | null
  revenue_share_details: string | null
  service_description: string | null
  equipment_details: string | null
  file_path: string | null
  file_name: string | null
  status: string
  notes: string | null
  created_at: string
  updated_at: string
  properties?: { name: string } | null
}

type SortField = 'expiration_date' | 'cancel_deadline' | 'vendor_name' | 'contract_type' | 'monthly_cost'
type SortDir = 'asc' | 'desc'

export default function ContractsPage() {
  const supabase = createClient()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editContract, setEditContract] = useState<Contract | null>(null)
  const [filterProp, setFilterProp] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('active')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortField>('expiration_date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [dragOver, setDragOver] = useState(false)

  const fetchContracts = useCallback(async () => {
    let q = (supabase.from('contracts') as any)
      .select('*, properties(name)')
      .order(sort, { ascending: sortDir === 'asc', nullsFirst: false })
    if (filterProp) q = q.eq('property_id', filterProp)
    if (filterType) q = q.eq('contract_type', filterType)
    if (filterStatus !== 'all') q = q.eq('status', filterStatus)
    const { data } = await q
    setContracts(data ?? [])
    setLoading(false)
  }, [filterProp, filterType, filterStatus, sort, sortDir])

  useEffect(() => { fetchContracts() }, [fetchContracts])
  useEffect(() => {
    supabase.from('properties').select('*').order('name')
      .then(({ data }) => setProperties(data ?? []))
  }, [])

  const displayed = contracts.filter(c => {
    if (!search) return true
    const s = search.toLowerCase()
    return c.title.toLowerCase().includes(s) ||
      c.vendor_name.toLowerCase().includes(s) ||
      (c.properties?.name ?? '').toLowerCase().includes(s)
  })

  const expiringSoon = contracts.filter(c => {
    const d = daysUntil(c.expiration_date); return d != null && d >= 0 && d <= 90
  })
  const cancelDeadlineSoon = contracts.filter(c => {
    const d = daysUntil(c.cancel_deadline); return d != null && d >= 0 && d <= 60
  })

  function handleSort(field: SortField) {
    if (sort === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSort(field); setSortDir('asc') }
  }

  async function downloadFile(contract: Contract) {
    if (!contract.file_path) return
    const { data } = await supabase.storage.from('c2-documents').createSignedUrl(contract.file_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deleteContract(id: string) {
    if (!confirm('Delete this contract?')) return
    await supabase.from('contracts').delete().eq('id', id)
    fetchContracts()
  }

  // Drag-drop onto the page opens form with file pre-loaded
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      setEditContract(null)
      setShowForm(true)
      // Pass file via session storage so modal can pick it up
      sessionStorage.setItem('pending_contract_file', file.name)
      // Store actual file reference
      ;(window as any).__pendingContractFile = file
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sort !== field) return <ChevronDown size={11} className="text-slate-300" />
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="text-blue-500" />
      : <ChevronDown size={11} className="text-blue-500" />
  }

  const Th = ({ label, field, className = '' }: { label: string; field?: SortField; className?: string }) => (
    <th
      className={cn('text-left px-3 py-2.5 text-xs font-medium text-slate-500 select-none whitespace-nowrap', field && 'cursor-pointer hover:text-slate-700', className)}
      onClick={field ? () => handleSort(field) : undefined}>
      <span className="flex items-center gap-1">
        {label}
        {field && <SortIcon field={field} />}
      </span>
    </th>
  )

  return (
    <div
      className="p-6 max-w-7xl mx-auto space-y-5"
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}>

      {/* Drag overlay */}
      {dragOver && (
        <div className="fixed inset-0 bg-blue-500/10 border-2 border-blue-400 border-dashed z-40 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl px-8 py-6 shadow-xl text-center">
            <Upload size={32} className="text-blue-500 mx-auto mb-2" />
            <div className="text-lg font-semibold text-blue-700">Drop to add contract</div>
            <div className="text-sm text-slate-500 mt-1">PDF, Word, or image accepted</div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Contracts</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {contracts.length} contracts · drag a file anywhere to add new
          </p>
        </div>
        <button onClick={() => { setEditContract(null); setShowForm(true) }} className="btn-primary">
          <Plus size={14} />Add Contract
        </button>
      </div>

      {/* Alert banners */}
      {cancelDeadlineSoon.length > 0 && (
        <div className="p-3 border border-red-200 bg-red-50 rounded-xl">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle size={13} className="text-red-600 flex-shrink-0" />
            <span className="text-sm font-semibold text-red-800">
              {cancelDeadlineSoon.length} cancellation deadline{cancelDeadlineSoon.length > 1 ? 's' : ''} within 60 days
            </span>
          </div>
          {cancelDeadlineSoon.map(c => {
            const d = daysUntil(c.cancel_deadline)!
            return (
              <div key={c.id} className="flex items-center gap-2 text-xs text-red-700 py-0.5 ml-5">
                <span className="font-medium">{c.vendor_name}</span>
                <span className="text-red-400">·</span>
                <span>{c.properties?.name ?? 'Portfolio'}</span>
                <span className="text-red-400">·</span>
                <span>{CANCEL_METHOD_LABELS[c.cancel_method ?? ''] ?? 'Written notice'} required</span>
                <span className="ml-auto font-semibold">{d === 0 ? 'TODAY' : `${d}d`}</span>
              </div>
            )
          })}
        </div>
      )}

      {expiringSoon.length > 0 && (
        <div className="p-3 border border-amber-200 bg-amber-50 rounded-xl">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle size={13} className="text-amber-600 flex-shrink-0" />
            <span className="text-sm font-semibold text-amber-800">
              {expiringSoon.length} contract{expiringSoon.length > 1 ? 's' : ''} expiring within 90 days
            </span>
          </div>
          {expiringSoon.map(c => {
            const d = daysUntil(c.expiration_date)!
            return (
              <div key={c.id} className="flex items-center gap-2 text-xs text-amber-700 py-0.5 ml-5">
                <span className="font-medium">{c.vendor_name}</span>
                <span className="text-amber-400">·</span>
                <span>{TYPE_LABELS[c.contract_type] ?? c.contract_type}</span>
                <span className="text-amber-400">·</span>
                <span>{c.properties?.name ?? 'Portfolio'}</span>
                <span className="ml-auto font-semibold">{d}d left</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search vendor, property…" />
        </div>
        <Sel value={filterProp} onChange={setFilterProp}>
          <option value="">All properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Sel>
        <Sel value={filterType} onChange={setFilterType}>
          <option value="">All types</option>
          {CONTRACT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </Sel>
        <Sel value={filterStatus} onChange={setFilterStatus}>
          <option value="active">Active</option>
          <option value="all">All statuses</option>
          <option value="expired">Expired</option>
          <option value="terminated">Terminated</option>
          <option value="pending">Pending</option>
        </Sel>
        {(filterProp || filterType || filterStatus !== 'active' || search) && (
          <button onClick={() => { setFilterProp(''); setFilterType(''); setFilterStatus('active'); setSearch('') }}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <X size={11} />Clear
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">{displayed.length} shown</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : displayed.length === 0 ? (
        <div className="py-16 text-center card">
          <FileText size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400 mb-2">No contracts yet</p>
          <p className="text-xs text-slate-300">Drag a contract file anywhere on the page to get started</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <Th label="Property" className="pl-4" />
                <Th label="Vendor / Title" />
                <Th label="Type" field="contract_type" />
                <Th label="Expiration" field="expiration_date" />
                <Th label="Cancel Deadline" field="cancel_deadline" />
                <Th label="Auto-Renew" />
                <Th label="Monthly Cost" field="monthly_cost" />
                <Th label="Revenue Share" />
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayed.map(contract => {
                const expDays = daysUntil(contract.expiration_date)
                const cancelDays = daysUntil(contract.cancel_deadline)
                const expUrgent = expDays != null && expDays <= 30
                const expWarn = expDays != null && expDays <= 90
                const cancelUrgent = cancelDays != null && cancelDays <= 30
                const cancelWarn = cancelDays != null && cancelDays <= 60

                return (
                  <tr key={contract.id}
                    className="hover:bg-slate-50 cursor-pointer group"
                    onClick={() => { setEditContract(contract); setShowForm(true) }}>

                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-slate-600">
                        {contract.properties?.name ?? '—'}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-900 text-sm leading-tight">{contract.vendor_name}</div>
                      <div className="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">{contract.title}</div>
                    </td>

                    <td className="px-3 py-3">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                        {TYPE_LABELS[contract.contract_type] ?? contract.contract_type}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      {contract.expiration_date ? (
                        <div>
                          <div className={cn('text-sm font-medium',
                            expUrgent ? 'text-red-600' : expWarn ? 'text-amber-600' : 'text-slate-700')}>
                            {formatDate(contract.expiration_date)}
                          </div>
                          <div className={cn('text-xs',
                            expUrgent ? 'text-red-500' : expWarn ? 'text-amber-500' : 'text-slate-400')}>
                            {expDays! <= 0 ? 'EXPIRED' : `${expDays}d`}
                          </div>
                        </div>
                      ) : <span className="text-slate-300 text-xs">No expiry</span>}
                    </td>

                    <td className="px-3 py-3">
                      {contract.cancel_deadline ? (
                        <div>
                          <div className={cn('text-sm font-medium',
                            cancelUrgent ? 'text-red-600' : cancelWarn ? 'text-amber-600' : 'text-slate-700')}>
                            {formatDate(contract.cancel_deadline)}
                          </div>
                          <div className={cn('text-xs',
                            cancelUrgent ? 'text-red-500' : cancelWarn ? 'text-amber-500' : 'text-slate-400')}>
                            {cancelDays! <= 0 ? 'PASSED' : `${cancelDays}d · ${CANCEL_METHOD_LABELS[contract.cancel_method ?? ''] ?? ''}`}
                          </div>
                        </div>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>

                    <td className="px-3 py-3 text-center">
                      {contract.auto_renews ? (
                        <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                          {contract.renewal_term_months
                            ? `${contract.renewal_term_months >= 12
                                ? `${contract.renewal_term_months / 12}yr`
                                : `${contract.renewal_term_months}mo`}`
                            : 'Yes'}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">No</span>
                      )}
                    </td>

                    <td className="px-3 py-3 text-right">
                      <span className="text-sm text-slate-700">
                        {contract.monthly_cost ? formatCurrency(contract.monthly_cost) : '—'}
                      </span>
                    </td>

                    <td className="px-3 py-3 text-right">
                      {contract.revenue_share_pct ? (
                        <span className="text-sm text-slate-700">{contract.revenue_share_pct}%</span>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>

                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                        {contract.file_path && (
                          <button
                            onClick={e => { e.stopPropagation(); downloadFile(contract) }}
                            className="text-slate-400 hover:text-blue-500 p-1">
                            <Download size={13} />
                          </button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); deleteContract(contract.id) }}
                          className="text-slate-400 hover:text-red-400 p-1">
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

      {showForm && (
        <ContractFormModal
          contract={editContract}
          properties={properties}
          onClose={() => { setShowForm(false); setEditContract(null) }}
          onSave={() => { setShowForm(false); setEditContract(null); fetchContracts() }}
        />
      )}
    </div>
  )
}

function Sel({ value, onChange, children }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode
}) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-7 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
        {children}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-2.5 text-slate-400 pointer-events-none" />
    </div>
  )
}

// ── Contract Form Modal ──────────────────────────────────────

function ContractFormModal({ contract, properties, onClose, onSave }: {
  contract: Contract | null; properties: Property[]
  onClose: () => void; onSave: () => void
}) {
  const supabase = createClient()
  const dropRef = useRef<HTMLDivElement>(null)
  const [file, setFile] = useState<File | null>(
    (window as any).__pendingContractFile ?? null
  )
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)

  // Clear pending file on mount
  useEffect(() => {
    if ((window as any).__pendingContractFile) {
      setFile((window as any).__pendingContractFile)
      delete (window as any).__pendingContractFile
    }
  }, [])

  const [form, setForm] = useState({
    property_id:          contract?.property_id ?? '',
    title:                contract?.title ?? '',
    vendor_name:          contract?.vendor_name ?? '',
    contract_type:        contract?.contract_type ?? 'other',
    vendor_contact_name:  contract?.vendor_contact_name ?? '',
    vendor_contact_email: contract?.vendor_contact_email ?? '',
    vendor_contact_phone: contract?.vendor_contact_phone ?? '',
    account_number:       contract?.account_number ?? '',
    agreement_number:     contract?.agreement_number ?? '',
    execution_date:       contract?.execution_date ?? '',
    commencement_date:    contract?.commencement_date ?? '',
    expiration_date:      contract?.expiration_date ?? '',
    auto_renews:          contract?.auto_renews ? 'true' : 'false',
    renewal_term_months:  contract?.renewal_term_months?.toString() ?? '',
    cancel_notice_days:   contract?.cancel_notice_days?.toString() ?? '',
    cancel_deadline:      contract?.cancel_deadline ?? '',
    cancel_method:        contract?.cancel_method ?? 'written',
    monthly_cost:         contract?.monthly_cost?.toString() ?? '',
    annual_cost:          contract?.annual_cost?.toString() ?? '',
    rate_escalation:      contract?.rate_escalation ?? '',
    revenue_share_pct:    contract?.revenue_share_pct?.toString() ?? '',
    revenue_share_details:contract?.revenue_share_details ?? '',
    service_description:  contract?.service_description ?? '',
    equipment_details:    contract?.equipment_details ?? '',
    status:               contract?.status ?? 'active',
    notes:                contract?.notes ?? '',
  })

  function setF(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  // Auto-compute cancel deadline when expiry + notice days change
  useEffect(() => {
    if (form.expiration_date && form.cancel_notice_days && !contract?.cancel_deadline) {
      const exp = new Date(form.expiration_date)
      const days = parseInt(form.cancel_notice_days)
      if (!isNaN(days)) {
        exp.setDate(exp.getDate() - days)
        setF('cancel_deadline', exp.toISOString().slice(0, 10))
      }
    }
  }, [form.expiration_date, form.cancel_notice_days])

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) {
      setFile(f)
      if (!form.title) setF('title', f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.vendor_name || !form.title) return
    setSaving(true)

    let file_path = contract?.file_path ?? null
    let file_name = contract?.file_name ?? null

    if (file) {
      const propId = form.property_id || 'portfolio'
      const path = `${propId}/contracts/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('c2-documents').upload(path, file)
      if (!error) { file_path = path; file_name = file.name }
    }

    const n = (v: string) => v !== '' ? parseFloat(v) : null
    const i = (v: string) => v !== '' ? parseInt(v) : null

    const payload: any = {
      property_id: form.property_id || null,
      title: form.title,
      vendor_name: form.vendor_name,
      contract_type: form.contract_type,
      vendor_contact_name: form.vendor_contact_name || null,
      vendor_contact_email: form.vendor_contact_email || null,
      vendor_contact_phone: form.vendor_contact_phone || null,
      account_number: form.account_number || null,
      agreement_number: form.agreement_number || null,
      execution_date: form.execution_date || null,
      commencement_date: form.commencement_date || null,
      expiration_date: form.expiration_date || null,
      auto_renews: form.auto_renews === 'true',
      renewal_term_months: i(form.renewal_term_months),
      cancel_notice_days: i(form.cancel_notice_days),
      cancel_deadline: form.cancel_deadline || null,
      cancel_method: form.cancel_method || null,
      monthly_cost: n(form.monthly_cost),
      annual_cost: n(form.annual_cost),
      rate_escalation: form.rate_escalation || null,
      revenue_share_pct: n(form.revenue_share_pct),
      revenue_share_details: form.revenue_share_details || null,
      service_description: form.service_description || null,
      equipment_details: form.equipment_details || null,
      file_path, file_name,
      status: form.status,
      notes: form.notes || null,
    }

    if (contract) {
      await (supabase.from('contracts') as any).update(payload).eq('id', contract.id)
    } else {
      await (supabase.from('contracts') as any).insert(payload)
    }

    setSaving(false)
    onSave()
  }

  const F = (key: string, label: string, type = 'text', placeholder = '', required = false) => (
    <div>
      <label className="label">{label}{required && <span className="text-red-400"> *</span>}</label>
      <input
        required={required} type={type} value={(form as any)[key]} placeholder={placeholder}
        onChange={e => setF(key, e.target.value)} className="input" />
    </div>
  )

  const TA = (key: string, label: string, placeholder = '') => (
    <div>
      <label className="label">{label}</label>
      <textarea value={(form as any)[key]} placeholder={placeholder}
        onChange={e => setF(key, e.target.value)}
        className="input min-h-[60px] resize-none text-sm" />
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-slate-900">{contract ? 'Edit Contract' : 'New Contract'}</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-700" /></button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* File drop zone */}
          <div
            ref={dropRef}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleFileDrop}
            onClick={() => document.getElementById('contract-file-input')?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors',
              dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
            )}>
            {file ? (
              <div className="flex items-center justify-center gap-2 text-sm">
                <FileText size={16} className="text-blue-500" />
                <span className="font-medium text-slate-700">{file.name}</span>
                <span className="text-slate-400">({(file.size / 1024).toFixed(0)} KB)</span>
                <button type="button" onClick={e => { e.stopPropagation(); setFile(null) }}
                  className="text-slate-400 hover:text-red-400 ml-1"><X size={13} /></button>
              </div>
            ) : contract?.file_name ? (
              <div className="text-sm text-slate-500 flex items-center justify-center gap-2">
                <FileText size={14} className="text-slate-400" />
                {contract.file_name}
                <span className="text-blue-500 text-xs">(click to replace)</span>
              </div>
            ) : (
              <div>
                <Upload size={20} className="text-slate-300 mx-auto mb-1" />
                <div className="text-sm text-slate-400">Drop contract file or click to browse</div>
                <div className="text-xs text-slate-300 mt-0.5">PDF, Word, image</div>
              </div>
            )}
            <input id="contract-file-input" type="file" className="hidden"
              accept=".pdf,.doc,.docx,.jpg,.png"
              onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); if (!form.title) setF('title', f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')) } }} />
          </div>

          {/* Core fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Property</label>
              <select value={form.property_id} onChange={e => setF('property_id', e.target.value)} className="input">
                <option value="">Portfolio-wide</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Contract Type</label>
              <select value={form.contract_type} onChange={e => setF('contract_type', e.target.value)} className="input">
                {CONTRACT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          </div>

          {F('vendor_name', 'Vendor Name', 'text', 'e.g. CSC ServiceWorks', true)}
          {F('title', 'Contract Title', 'text', 'e.g. Laundry Services — Fox Hill', true)}

          {/* Dates */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Dates</div>
            <div className="grid grid-cols-3 gap-3">
              {F('execution_date', 'Executed', 'date')}
              {F('commencement_date', 'Commencement', 'date')}
              {F('expiration_date', 'Expiration', 'date')}
            </div>
          </div>

          {/* Renewal + cancellation */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Auto-Renewal & Cancellation</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Auto-renews?</label>
                <select value={form.auto_renews} onChange={e => setF('auto_renews', e.target.value)} className="input">
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              {F('renewal_term_months', 'Renewal Term (months)', 'number', '12')}
              {F('cancel_notice_days', 'Notice Required (days)', 'number', '60')}
              <div>
                <label className="label">Notice Method</label>
                <select value={form.cancel_method} onChange={e => setF('cancel_method', e.target.value)} className="input">
                  <option value="written">Written Notice</option>
                  <option value="certified_mail">Certified Mail</option>
                  <option value="email">Email</option>
                  <option value="any">Any Written</option>
                </select>
              </div>
            </div>
            <div className="mt-3">
              {F('cancel_deadline', 'Cancel-By Deadline', 'date')}
              <p className="text-xs text-slate-400 mt-1">Auto-calculated from expiry − notice days. Override manually if needed.</p>
            </div>
          </div>

          {/* Financials */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Financials</div>
            <div className="grid grid-cols-2 gap-3">
              {F('monthly_cost', 'Monthly Cost ($)', 'number', '0.00')}
              {F('annual_cost', 'Annual Cost ($)', 'number', '0.00')}
              {F('revenue_share_pct', 'Revenue Share (%)', 'number', '0')}
              {F('rate_escalation', 'Rate Escalation', 'text', 'e.g. CPI annually')}
            </div>
            {form.revenue_share_pct && (
              <div className="mt-3">{TA('revenue_share_details', 'Revenue Share Details')}</div>
            )}
          </div>

          {/* Service + equipment */}
          {TA('service_description', 'Service Description', 'What services are provided?')}
          {TA('equipment_details', 'Equipment Details', 'Equipment makes, models, quantities…')}

          {/* Vendor contact */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Vendor Contact</div>
            <div className="grid grid-cols-3 gap-3">
              {F('vendor_contact_name', 'Name')}
              {F('vendor_contact_phone', 'Phone')}
              {F('vendor_contact_email', 'Email')}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              {F('account_number', 'Account Number')}
              {F('agreement_number', 'Agreement Number')}
            </div>
          </div>

          <div>
            <label className="label">Status</label>
            <select value={form.status} onChange={e => setF('status', e.target.value)} className="input">
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="expired">Expired</option>
              <option value="terminated">Terminated</option>
            </select>
          </div>

          {TA('notes', 'Notes / Key Terms')}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving || !form.vendor_name || !form.title} className="btn-primary">
              {saving ? 'Saving…' : contract ? 'Save changes' : 'Add contract'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
