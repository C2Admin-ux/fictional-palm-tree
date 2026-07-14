'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Property } from '@/lib/supabase/types'
import { cn, formatDate, formatCurrency, daysUntil } from '@/lib/utils'
import {
  Plus, X, Upload, AlertTriangle, ChevronDown,
  ChevronUp, Download, Trash2, FileText, Search,
  Sparkles, Check, Clock, Pencil, Archive,
} from 'lucide-react'
import { exportToExcel, fmtDate, titleCase, yesNo } from '@/lib/utils/export'
import { FilterSelect } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'
import { DaysLeftBadge } from '@/components/ui/days-left-badge'
import { DragOverlay } from '@/components/ui/drag-overlay'
import { ExtractingOverlay } from '@/components/ui/extracting-overlay'
import { usePdfExtraction, type ExtractResponse } from '@/lib/hooks/use-pdf-extraction'

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
  service_frequency: string | null
  service_line_items: string | null
  per_service_cost: number | null
  surcharges: string | null
  early_termination_terms: string | null
  container_details: string | null
  pickup_schedule: string | null
  inspection_frequency: string | null
  coverage_scope: string | null
  response_time_sla: string | null
  emergency_call_fee: number | null
  file_path: string | null
  file_name: string | null
  status: string
  superseded_by: string | null
  superseded_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  properties?: { name: string } | null
}

type SortField = 'expiration_date' | 'cancel_deadline' | 'vendor_name' | 'contract_type' | 'monthly_cost'

// When a newer contract is added for the same property + vendor + type,
// archive any older ACTIVE contracts (status -> 'superseded') and link them
// to the replacement. "Older" = earlier commencement/execution date.
async function supersedeOlderContracts(
  supabase: ReturnType<typeof createClient>,
  newContract: { id: string; property_id: string | null; vendor_name: string; contract_type: string; commencement_date: string | null; execution_date: string | null }
) {
  const newDate = newContract.commencement_date ?? newContract.execution_date
  if (!newDate) return  // can't determine ordering without a date

  // Find candidate older contracts: same property, vendor, type, still active,
  // and not the row we just inserted.
  let q = supabase.from('contracts')
    .select('id, commencement_date, execution_date')
    .eq('contract_type', newContract.contract_type)
    .ilike('vendor_name', newContract.vendor_name)
    .eq('status', 'active')
    .neq('id', newContract.id)
  q = newContract.property_id
    ? q.eq('property_id', newContract.property_id)
    : q.is('property_id', null)

  const { data: candidates } = await q
  if (!candidates?.length) return

  const toArchive = candidates
    .filter((c: any) => {
      const oldDate = c.commencement_date ?? c.execution_date
      return oldDate && oldDate < newDate  // strictly older
    })
    .map((c: any) => c.id)

  if (toArchive.length) {
    await supabase.from('contracts')
      .update({ status: 'superseded', superseded_by: newContract.id, superseded_at: new Date().toISOString() })
      .in('id', toArchive)
  }
}
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

  // OCR state
  const [extractedContracts, setExtractedContracts] = useState<any[] | null>(null)
  const [extractedFile, setExtractedFile] = useState<{ name: string; base64: string } | null>(null)

  // Drag-drop / Scan PDF runs OCR extraction, then opens a review modal
  const pdf = usePdfExtraction<ExtractResponse & { contracts?: any[] }>({
    endpoint: '/api/contracts/extract',
    extractingMessage: 'Extracting contract details with AI…',
    onSuccess: (data, file) => {
      setExtractedContracts(data.contracts ?? [])
      setExtractedFile(file)
    },
  })
  const { error: extractError, setError: setExtractError } = pdf

  useEffect(() => {
    if (!extractError) return
    alert(extractError === 'not_a_contract'
      ? "That doesn't look like a contract. Try a service agreement or vendor contract PDF."
      : extractError === 'Please drop a PDF file'
        ? extractError
        : 'Extraction failed — ' + extractError)
    setExtractError(null)
  }, [extractError, setExtractError])

  const fetchContracts = useCallback(async () => {
    let q = supabase.from('contracts')
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
  // Warn when within 90 days of the cancellation-notice deadline (the date by
  // which written notice must be sent to avoid auto-renewal).
  const cancelDeadlineSoon = contracts.filter(c => {
    const d = daysUntil(c.cancel_deadline); return d != null && d >= 0 && d <= 90
  })

  function exportContracts() {
    const rows = displayed.map(c => ({
      'Property': c.properties?.name ?? 'Portfolio-wide',
      'Vendor': c.vendor_name,
      'Title': c.title,
      'Type': titleCase(c.contract_type),
      'Status': titleCase(c.status),
      'Executed': fmtDate(c.execution_date),
      'Commencement': fmtDate(c.commencement_date),
      'Expiration': fmtDate(c.expiration_date),
      'Auto-Renews': yesNo(c.auto_renews),
      'Renewal Term (mo)': c.renewal_term_months ?? '',
      'Cancel Notice (days)': c.cancel_notice_days ?? '',
      'Cancel Method': titleCase(c.cancel_method),
      'Cancel Deadline': fmtDate(c.cancel_deadline),
      'Monthly Cost': c.monthly_cost ?? '',
      'Annual Cost': c.annual_cost ?? '',
      'Per-Service Cost': (c as any).per_service_cost ?? '',
      'Rate Escalation': c.rate_escalation ?? '',
      'Surcharges': (c as any).surcharges ?? '',
      'Revenue Share %': c.revenue_share_pct ?? '',
      'Service Frequency': (c as any).service_frequency ?? '',
      'Containers': (c as any).container_details ?? '',
      'Pickup Schedule': (c as any).pickup_schedule ?? '',
      'Inspection Freq.': (c as any).inspection_frequency ?? '',
      'Coverage Scope': (c as any).coverage_scope ?? '',
      'Response SLA': (c as any).response_time_sla ?? '',
      'Emergency Fee': (c as any).emergency_call_fee ?? '',
      'Early Termination': (c as any).early_termination_terms ?? '',
      'Account #': c.account_number ?? '',
      'Agreement #': c.agreement_number ?? '',
      'Vendor Contact': c.vendor_contact_name ?? '',
      'Vendor Phone': c.vendor_contact_phone ?? '',
      'Vendor Email': c.vendor_contact_email ?? '',
      'Notes': c.notes ?? '',
    }))
    exportToExcel(rows, 'C2_Contracts', 'Contracts')
  }

  function handleSort(field: SortField) {
    if (sort === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSort(field); setSortDir('asc') }
  }

  async function downloadFile(contract: Contract) {
    if (!contract.file_path) return
    const { data } = await supabase.storage.from('c2-documents').createSignedUrl(contract.file_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deleteContract(contract: Contract) {
    if (!confirm(`Permanently delete the ${contract.vendor_name} contract "${contract.title}"? This cannot be undone.`)) return
    if (contract.file_path) {
      try { await supabase.storage.from('c2-documents').remove([contract.file_path]) } catch { /* non-fatal */ }
    }
    await supabase.from('contracts').delete().eq('id', contract.id)
    fetchContracts()
  }

  async function archiveContract(contract: Contract) {
    const next = contract.status === 'archived' ? 'active' : 'archived'
    await supabase.from('contracts').update({ status: next }).eq('id', contract.id)
    fetchContracts()
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
      {...pdf.dragProps}>

      {pdf.dragOver && <DragOverlay title="Drop contract PDF" />}
      {pdf.extracting && <ExtractingOverlay title="Reading your contract" status={pdf.status} />}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Contracts</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {contracts.length} contracts · drag a PDF anywhere to auto-extract
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportContracts} className="btn-secondary" disabled={displayed.length === 0}>
            <Download size={14} />Export
          </button>
          <label className="btn-secondary cursor-pointer">
            <Sparkles size={14} />Scan PDF
            <input type="file" accept=".pdf" className="hidden" onChange={pdf.onInputChange} />
          </label>
          <button onClick={() => { setEditContract(null); setShowForm(true) }} className="btn-primary">
            <Plus size={14} />Add Contract
          </button>
        </div>
      </div>

      {/* Hint banner */}
      <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <Sparkles size={13} className="text-blue-500 flex-shrink-0" />
        <span>Drag a vendor contract PDF anywhere on this page to auto-extract vendor, dates, cancellation terms, and pricing.</span>
      </div>

      {/* Alert banners */}
      {cancelDeadlineSoon.length > 0 && (
        <div className="p-3 border border-red-200 bg-red-50 rounded-xl">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle size={13} className="text-red-600 flex-shrink-0" />
            <span className="text-sm font-semibold text-red-800">
              {cancelDeadlineSoon.length} cancellation deadline{cancelDeadlineSoon.length > 1 ? 's' : ''} within 90 days
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
        <FilterSelect value={filterProp} onChange={setFilterProp}>
          <option value="">All properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </FilterSelect>
        <FilterSelect value={filterType} onChange={setFilterType}>
          <option value="">All types</option>
          {CONTRACT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </FilterSelect>
        <FilterSelect value={filterStatus} onChange={setFilterStatus}>
          <option value="active">Active</option>
          <option value="all">All statuses</option>
          <option value="expired">Expired</option>
          <option value="terminated">Terminated</option>
          <option value="pending">Pending</option>
          <option value="archived">Archived</option>
          <option value="superseded">Archived (superseded)</option>
        </FilterSelect>
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
        <EmptyState
          icon={<FileText size={32} />}
          title="No contracts yet"
          hint="Drag a contract file anywhere on the page to get started"
        />
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
                          <DaysLeftBadge date={contract.expiration_date} red={30} yellow={90} green={90} overdueLabel="EXPIRED" className="mt-0.5" />
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
                          <div className="flex items-center gap-1 mt-0.5">
                            <DaysLeftBadge date={contract.cancel_deadline} red={30} yellow={60} green={60} overdueLabel="PASSED" />
                            {cancelDays != null && cancelDays > 0 && (
                              <span className="text-xs text-slate-400">{CANCEL_METHOD_LABELS[contract.cancel_method ?? ''] ?? ''}</span>
                            )}
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
                            title="Download file"
                            className="text-slate-400 hover:text-blue-500 p-1">
                            <Download size={13} />
                          </button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); setEditContract(contract); setShowForm(true) }}
                          title="Edit"
                          className="text-slate-400 hover:text-blue-500 p-1">
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); archiveContract(contract) }}
                          title={contract.status === 'archived' ? 'Unarchive' : 'Archive'}
                          className="text-slate-400 hover:text-amber-500 p-1">
                          <Archive size={13} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); deleteContract(contract) }}
                          title="Delete"
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

      {extractedContracts && (
        <ContractExtractionReviewModal
          extractedContracts={extractedContracts}
          extractedFile={extractedFile}
          properties={properties}
          onClose={() => { setExtractedContracts(null); setExtractedFile(null) }}
          onSaved={() => { setExtractedContracts(null); setExtractedFile(null); fetchContracts() }}
        />
      )}
    </div>
  )
}

function ContractExtractionReviewModal({ extractedContracts, extractedFile, properties, onClose, onSaved }: {
  extractedContracts: any[]
  extractedFile: { name: string; base64: string } | null
  properties: Property[]
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()

  function matchProperty(hint: string | null): string {
    if (!hint) return ''
    const h = hint.toLowerCase()
    const m = properties.find(p =>
      h.includes(p.name.toLowerCase()) ||
      (p.name.toLowerCase().split(' ')[0] && h.includes(p.name.toLowerCase().split(' ')[0]))
    )
    return m?.id ?? ''
  }

  // Derive cancel deadline = expiration_date − cancel_notice_days
  function deriveCancelDeadline(expiration: string | null, noticeDays: number | null): string {
    if (!expiration || !noticeDays) return ''
    const d = new Date(expiration + 'T00:00:00')
    d.setDate(d.getDate() - noticeDays)
    return d.toISOString().slice(0, 10)
  }

  const [drafts, setDrafts] = useState(() =>
    extractedContracts.map(c => ({
      property_id: matchProperty(c.property_hint),
      title: c.title ?? '',
      vendor_name: c.vendor_name ?? '',
      contract_type: c.contract_type ?? 'other',
      vendor_contact_name: c.vendor_contact_name ?? '',
      vendor_contact_email: c.vendor_contact_email ?? '',
      vendor_contact_phone: c.vendor_contact_phone ?? '',
      account_number: c.account_number ?? '',
      agreement_number: c.agreement_number ?? '',
      execution_date: c.execution_date ?? '',
      commencement_date: c.commencement_date ?? '',
      expiration_date: c.expiration_date ?? '',
      auto_renews: c.auto_renews ?? false,
      renewal_term_months: c.renewal_term_months?.toString() ?? '',
      cancel_notice_days: c.cancel_notice_days?.toString() ?? '',
      cancel_deadline: deriveCancelDeadline(c.expiration_date, c.cancel_notice_days),
      cancel_method: c.cancel_method ?? 'written',
      monthly_cost: c.monthly_cost?.toString() ?? '',
      annual_cost: c.annual_cost?.toString() ?? '',
      rate_escalation: c.rate_escalation ?? '',
      revenue_share_pct: c.revenue_share_pct?.toString() ?? '',
      revenue_share_details: c.revenue_share_details ?? '',
      service_description: c.service_description ?? '',
      equipment_details: c.equipment_details ?? '',
      service_frequency: c.service_frequency ?? '',
      service_line_items: c.service_line_items ?? '',
      per_service_cost: c.per_service_cost?.toString() ?? '',
      surcharges: c.surcharges ?? '',
      early_termination_terms: c.early_termination_terms ?? '',
      container_details: c.container_details ?? '',
      pickup_schedule: c.pickup_schedule ?? '',
      inspection_frequency: c.inspection_frequency ?? '',
      coverage_scope: c.coverage_scope ?? '',
      response_time_sla: c.response_time_sla ?? '',
      emergency_call_fee: c.emergency_call_fee?.toString() ?? '',
      notes: c.notes ?? '',
      confidence: c.confidence ?? 'medium',
      _include: true,
    }))
  )
  const [saving, setSaving] = useState(false)

  function update(i: number, key: string, value: any) {
    setDrafts(d => d.map((draft, idx) => {
      if (idx !== i) return draft
      const next = { ...draft, [key]: value }
      // Re-derive cancel deadline when expiration or notice days change
      if (key === 'expiration_date' || key === 'cancel_notice_days') {
        const days = parseInt(key === 'cancel_notice_days' ? value : next.cancel_notice_days)
        next.cancel_deadline = deriveCancelDeadline(
          key === 'expiration_date' ? value : next.expiration_date,
          isNaN(days) ? null : days
        )
      }
      return next
    }))
  }

  async function saveAll() {
    setSaving(true)
    const n = (v: string) => v !== '' ? parseFloat(v) : null
    const i = (v: string) => v !== '' ? parseInt(v) : null

    let file_path: string | null = null
    let file_name: string | null = null
    if (extractedFile) {
      try {
        const bytes = Uint8Array.from(atob(extractedFile.base64), c => c.charCodeAt(0))
        const path = `contracts/${Date.now()}-${extractedFile.name}`
        const { error } = await supabase.storage.from('c2-documents').upload(path, bytes, { contentType: 'application/pdf' })
        if (!error) { file_path = path; file_name = extractedFile.name }
      } catch { /* non-fatal */ }
    }

    const rows = drafts.filter(d => d._include).map(d => ({
      property_id: d.property_id || null,
      title: d.title,
      vendor_name: d.vendor_name,
      contract_type: d.contract_type,
      vendor_contact_name: d.vendor_contact_name || null,
      vendor_contact_email: d.vendor_contact_email || null,
      vendor_contact_phone: d.vendor_contact_phone || null,
      account_number: d.account_number || null,
      agreement_number: d.agreement_number || null,
      execution_date: d.execution_date || null,
      commencement_date: d.commencement_date || null,
      expiration_date: d.expiration_date || null,
      auto_renews: d.auto_renews,
      renewal_term_months: i(d.renewal_term_months),
      cancel_notice_days: i(d.cancel_notice_days),
      cancel_deadline: d.cancel_deadline || null,
      cancel_method: d.cancel_method || null,
      monthly_cost: n(d.monthly_cost),
      annual_cost: n(d.annual_cost),
      rate_escalation: d.rate_escalation || null,
      revenue_share_pct: n(d.revenue_share_pct),
      revenue_share_details: d.revenue_share_details || null,
      service_description: d.service_description || null,
      equipment_details: d.equipment_details || null,
      service_frequency: d.service_frequency || null,
      service_line_items: d.service_line_items || null,
      per_service_cost: n(d.per_service_cost),
      surcharges: d.surcharges || null,
      early_termination_terms: d.early_termination_terms || null,
      container_details: d.container_details || null,
      pickup_schedule: d.pickup_schedule || null,
      inspection_frequency: d.inspection_frequency || null,
      coverage_scope: d.coverage_scope || null,
      response_time_sla: d.response_time_sla || null,
      emergency_call_fee: n(d.emergency_call_fee),
      file_path, file_name,
      status: 'active',
      notes: d.notes || null,
    }))

    if (rows.length) {
      const { data: inserted } = await supabase.from('contracts').insert(rows).select('id, property_id, vendor_name, contract_type, commencement_date, execution_date')
      // Archive older active contracts that this batch supersedes
      if (inserted) {
        for (const newC of inserted) {
          await supersedeOlderContracts(supabase, newC)
        }
      }
    }
    setSaving(false)
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
            <h2 className="font-semibold text-slate-900">Review Extracted Contract{drafts.length > 1 ? 's' : ''}</h2>
            <p className="text-xs text-slate-400">{extractedFile?.name} — verify before saving</p>
          </div>
        </div>
      }>
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <span>Double-check the <strong>expiration date</strong> and <strong>cancellation notice period</strong> — these drive your renewal deadline alerts. The cancel-by date is auto-calculated from them.</span>
          </div>

          {drafts.map((d, idx) => (
            <div key={idx} className={cn('border rounded-xl p-4 space-y-3', d._include ? 'border-slate-200' : 'border-slate-100 bg-slate-50 opacity-60')}>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={d._include} onChange={e => update(idx, '_include', e.target.checked)} className="w-4 h-4" />
                <span className="font-medium text-slate-800 text-sm">{d.vendor_name || 'Unknown vendor'} — {TYPE_LABELS[d.contract_type] ?? d.contract_type}</span>
                <span className={cn('badge text-xs', CONF_STYLE[d.confidence] ?? CONF_STYLE.medium)}>{d.confidence} confidence</span>
              </div>

              {d._include && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="label">Property</label>
                      <select value={d.property_id} onChange={e => update(idx, 'property_id', e.target.value)} className="input">
                        <option value="">Portfolio-wide</option>
                        {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Type</label>
                      <select value={d.contract_type} onChange={e => update(idx, 'contract_type', e.target.value)} className="input">
                        {CONTRACT_TYPES.filter(t => t !== 'insurance').map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                      </select>
                    </div>
                    <div><label className="label">Vendor</label><input value={d.vendor_name} onChange={e => update(idx, 'vendor_name', e.target.value)} className="input" /></div>
                    <div className="col-span-2 sm:col-span-3"><label className="label">Title</label><input value={d.title} onChange={e => update(idx, 'title', e.target.value)} className="input" /></div>
                    <div><label className="label">Executed</label><input type="date" value={d.execution_date} onChange={e => update(idx, 'execution_date', e.target.value)} className="input" /></div>
                    <div><label className="label">Commencement</label><input type="date" value={d.commencement_date} onChange={e => update(idx, 'commencement_date', e.target.value)} className="input" /></div>
                    <div><label className="label">Expiration ⚠</label><input type="date" value={d.expiration_date} onChange={e => update(idx, 'expiration_date', e.target.value)} className={cn('input', !d.expiration_date && 'border-amber-300 bg-amber-50')} /></div>
                  </div>

                  {/* Cancellation block — highlighted since it's the key output */}
                  <div className="border border-blue-200 bg-blue-50/50 rounded-lg p-3">
                    <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Clock size={11} />Cancellation Terms
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div><label className="label">Notice (days)</label><input type="number" value={d.cancel_notice_days} onChange={e => update(idx, 'cancel_notice_days', e.target.value)} className="input" /></div>
                      <div>
                        <label className="label">Method</label>
                        <select value={d.cancel_method} onChange={e => update(idx, 'cancel_method', e.target.value)} className="input">
                          <option value="written">Written</option>
                          <option value="certified_mail">Certified Mail</option>
                          <option value="email">Email</option>
                          <option value="any">Any Written</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Cancel By (auto)</label>
                        <input type="date" value={d.cancel_deadline} onChange={e => update(idx, 'cancel_deadline', e.target.value)} className="input font-medium" />
                      </div>
                      <div>
                        <label className="label">Auto-renews?</label>
                        <select value={d.auto_renews ? 'true' : 'false'} onChange={e => update(idx, 'auto_renews', e.target.value === 'true')} className="input">
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Service delivery — applies to all types */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div><label className="label">Frequency</label><input value={d.service_frequency} onChange={e => update(idx, 'service_frequency', e.target.value)} className="input" placeholder="2x/week" /></div>
                    <div><label className="label">Monthly $</label><input type="number" value={d.monthly_cost} onChange={e => update(idx, 'monthly_cost', e.target.value)} className="input" /></div>
                    <div><label className="label">Per-Service $</label><input type="number" value={d.per_service_cost} onChange={e => update(idx, 'per_service_cost', e.target.value)} className="input" placeholder="per haul/visit" /></div>
                    <div><label className="label">Rate Escalation</label><input value={d.rate_escalation} onChange={e => update(idx, 'rate_escalation', e.target.value)} className="input" /></div>
                  </div>

                  {/* Trash / waste */}
                  {d.contract_type === 'trash' && (
                    <div className="border border-slate-200 bg-slate-50/60 rounded-lg p-3">
                      <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Waste Service</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div><label className="label">Containers</label><input value={d.container_details} onChange={e => update(idx, 'container_details', e.target.value)} className="input" placeholder="1x3yd + 1x4yd" /></div>
                        <div><label className="label">Pickup Schedule</label><input value={d.pickup_schedule} onChange={e => update(idx, 'pickup_schedule', e.target.value)} className="input" placeholder="3yd 2x/wk, 4yd 1x/wk" /></div>
                        <div className="sm:col-span-2"><label className="label">Surcharges</label><input value={d.surcharges} onChange={e => update(idx, 'surcharges', e.target.value)} className="input" placeholder="fuel, environmental, admin — or exempt" /></div>
                      </div>
                    </div>
                  )}

                  {/* Mechanical: elevator / HVAC / plumbing / electrical */}
                  {['elevator', 'hvac', 'plumbing', 'electrical'].includes(d.contract_type) && (
                    <div className="border border-slate-200 bg-slate-50/60 rounded-lg p-3">
                      <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Maintenance Terms</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="label">Inspection Freq.</label><input value={d.inspection_frequency} onChange={e => update(idx, 'inspection_frequency', e.target.value)} className="input" placeholder="monthly / annual cert" /></div>
                        <div><label className="label">Coverage</label><input value={d.coverage_scope} onChange={e => update(idx, 'coverage_scope', e.target.value)} className="input" placeholder="parts + labor" /></div>
                        <div><label className="label">Response SLA</label><input value={d.response_time_sla} onChange={e => update(idx, 'response_time_sla', e.target.value)} className="input" placeholder="4hr emergency" /></div>
                        <div><label className="label">Emergency Fee $</label><input type="number" value={d.emergency_call_fee} onChange={e => update(idx, 'emergency_call_fee', e.target.value)} className="input" /></div>
                      </div>
                    </div>
                  )}

                  {/* Laundry */}
                  {d.contract_type === 'laundry' && (
                    <div className="border border-slate-200 bg-slate-50/60 rounded-lg p-3">
                      <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Laundry Terms</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="label">Rev Share %</label><input type="number" value={d.revenue_share_pct} onChange={e => update(idx, 'revenue_share_pct', e.target.value)} className="input" /></div>
                        <div><label className="label">Equipment</label><input value={d.equipment_details} onChange={e => update(idx, 'equipment_details', e.target.value)} className="input" placeholder="26 washers / 26 dryers" /></div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
          <span className="text-xs text-slate-400">{includedCount} of {drafts.length} will be saved</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={saveAll} disabled={saving || includedCount === 0} className="btn-primary">
              {saving ? 'Saving…' : <><Check size={14} />Save {includedCount > 1 ? `${includedCount} contracts` : 'contract'}</>}
            </button>
          </div>
        </div>
    </Modal>
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
    service_frequency:    contract?.service_frequency ?? '',
    service_line_items:   contract?.service_line_items ?? '',
    per_service_cost:     contract?.per_service_cost?.toString() ?? '',
    surcharges:           contract?.surcharges ?? '',
    early_termination_terms: contract?.early_termination_terms ?? '',
    container_details:    contract?.container_details ?? '',
    pickup_schedule:      contract?.pickup_schedule ?? '',
    inspection_frequency: contract?.inspection_frequency ?? '',
    coverage_scope:       contract?.coverage_scope ?? '',
    response_time_sla:    contract?.response_time_sla ?? '',
    emergency_call_fee:   contract?.emergency_call_fee?.toString() ?? '',
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
      service_frequency: form.service_frequency || null,
      service_line_items: form.service_line_items || null,
      per_service_cost: n(form.per_service_cost),
      surcharges: form.surcharges || null,
      early_termination_terms: form.early_termination_terms || null,
      container_details: form.container_details || null,
      pickup_schedule: form.pickup_schedule || null,
      inspection_frequency: form.inspection_frequency || null,
      coverage_scope: form.coverage_scope || null,
      response_time_sla: form.response_time_sla || null,
      emergency_call_fee: n(form.emergency_call_fee),
      file_path, file_name,
      status: form.status,
      notes: form.notes || null,
    }

    if (contract) {
      await supabase.from('contracts').update(payload).eq('id', contract.id)
    } else {
      const { data: inserted } = await supabase.from('contracts').insert(payload).select('id, property_id, vendor_name, contract_type, commencement_date, execution_date').single()
      if (inserted) await supersedeOlderContracts(supabase, inserted)
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
    <Modal title={contract ? 'Edit Contract' : 'New Contract'} onClose={onClose} maxWidth="2xl">
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

          {/* Financials — all types */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Financials</div>
            <div className="grid grid-cols-2 gap-3">
              {F('monthly_cost', 'Monthly Cost ($)', 'number', '0.00')}
              {F('annual_cost', 'Annual Cost ($)', 'number', '0.00')}
              {F('rate_escalation', 'Rate Escalation', 'text', 'e.g. CPI annually, +10% 2027')}
            </div>
          </div>

          {/* Service delivery — all types */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Service</div>
            <div className="grid grid-cols-2 gap-3">
              {F('service_frequency', 'Frequency', 'text', '2x/week, monthly…')}
              {F('per_service_cost', 'Per-Service Cost ($)', 'number', 'per haul/visit/call')}
            </div>
            <div className="mt-3">{TA('service_description', 'Service Description', 'What services are provided?')}</div>
          </div>

          {/* Trash / waste */}
          {form.contract_type === 'trash' && (
            <div className="border border-slate-200 bg-slate-50/60 rounded-lg p-3">
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Waste Service</div>
              <div className="grid grid-cols-2 gap-3">
                {F('container_details', 'Containers', 'text', '1x3yd + 1x4yd')}
                {F('pickup_schedule', 'Pickup Schedule', 'text', '3yd 2x/wk, 4yd 1x/wk')}
              </div>
              <div className="mt-3">{F('surcharges', 'Surcharges', 'text', 'fuel, environmental, admin — or exempt')}</div>
            </div>
          )}

          {/* Mechanical */}
          {['elevator', 'hvac', 'plumbing', 'electrical'].includes(form.contract_type) && (
            <div className="border border-slate-200 bg-slate-50/60 rounded-lg p-3">
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Maintenance Terms</div>
              <div className="grid grid-cols-2 gap-3">
                {F('inspection_frequency', 'Inspection Freq.', 'text', 'monthly / annual cert')}
                {F('coverage_scope', 'Coverage', 'text', 'parts + labor')}
                {F('response_time_sla', 'Response SLA', 'text', '4hr emergency')}
                {F('emergency_call_fee', 'Emergency Fee ($)', 'number', '0.00')}
              </div>
            </div>
          )}

          {/* Laundry */}
          {form.contract_type === 'laundry' && (
            <div className="border border-slate-200 bg-slate-50/60 rounded-lg p-3">
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Laundry Terms</div>
              <div className="grid grid-cols-2 gap-3">
                {F('revenue_share_pct', 'Revenue Share (%)', 'number', '0')}
                {TA('equipment_details', 'Equipment', 'makes, models, counts')}
              </div>
              {form.revenue_share_pct && (
                <div className="mt-3">{TA('revenue_share_details', 'Revenue Share Details')}</div>
              )}
            </div>
          )}

          {/* Early termination — all types */}
          {TA('early_termination_terms', 'Early Termination / Liquidated Damages', 'buyout or penalty language…')}

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
    </Modal>
  )
}
