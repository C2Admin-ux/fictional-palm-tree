'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn, formatDate, propertyColor, todayISO, INSPECTION_STATUS_STYLES } from '@/lib/utils'
import { INSPECTION_TYPE_LABELS, INSPECTION_STATUS_LABELS, type InspectionType } from '@/lib/inspections/templates'
import { removeInspectionPhotos } from '@/lib/inspections/photos'
import { inspectionScore } from '@/lib/inspections/score'
import { GradeBadge } from '@/lib/inspections/grade-badge'
import { FilterSelect } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'
import { useSort, Th } from '@/lib/utils/sort'
import { ClipboardCheck, Plus, Trash2, AlertTriangle, ChevronRight, RotateCcw, X } from 'lucide-react'

type PropertyOption = { id: string; name: string }

type InspectionRow = {
  id: string
  property_id: string
  inspection_type: InspectionType
  inspection_date: string
  status: 'draft' | 'submitted' | 'report_sent'
  notes: string | null
  created_at: string
  properties: { name: string } | null
  inspection_items: { requires_action: boolean; action_priority: string | null }[]
}

export default function InspectionsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [inspections, setInspections] = useState<InspectionRow[]>([])
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [filterProp, setFilterProp] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const { sort, dir, toggle, sortFn } = useSort<string>('inspection_date', 'desc')

  const fetchInspections = useCallback(async () => {
    let q = supabase.from('inspections')
      .select('id, property_id, inspection_type, inspection_date, status, notes, created_at, properties(name), inspection_items(requires_action, action_priority)')
    if (filterProp) q = q.eq('property_id', filterProp)
    if (filterType) q = q.eq('inspection_type', filterType as InspectionType)
    if (filterStatus) q = q.eq('status', filterStatus as InspectionRow['status'])
    const { data, error } = await q
    if (error) {
      // Never show the false "No inspections yet" empty state on a failed
      // fetch — surface the error with a retry instead.
      setFetchError(error.message)
      setLoading(false)
      return
    }
    setFetchError(null)
    setInspections((data as unknown as InspectionRow[]) ?? [])
    setLoading(false)
  }, [filterProp, filterType, filterStatus])

  useEffect(() => { fetchInspections() }, [fetchInspections])
  useEffect(() => {
    supabase.from('properties').select('id, name').order('name')
      .then(({ data }) => setProperties(data ?? []))
  }, [])

  // A draft mid-walk has partial findings — it has no score yet. null here
  // both renders as the muted "—" slot and sorts to the bottom regardless
  // of direction (useSort puts nulls last either way).
  const displayed = useMemo(() => inspections
    .map(i => ({
      ...i,
      property_name: i.properties?.name ?? '',
      item_count: i.inspection_items.length,
      open_findings: i.inspection_items.filter(it => it.requires_action).length,
      score: i.status === 'draft' ? null : inspectionScore(i.inspection_items),
    }))
    .sort(sortFn),
    // sortFn is fully determined by sort + dir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inspections, sort, dir])

  async function deleteInspection(insp: InspectionRow) {
    if (!confirm(`Delete this draft inspection${insp.properties?.name ? ` at ${insp.properties.name}` : ''} and all its findings? This cannot be undone.`)) return
    setActionError(null)
    // Collect photo paths BEFORE the delete cascades the items away. If
    // this read fails we still delete — orphaned storage files are
    // acceptable, a lost delete is not.
    const { data: itemRows } = await supabase.from('inspection_items')
      .select('photo_paths').eq('inspection_id', insp.id)
    const { error } = await supabase.from('inspections').delete().eq('id', insp.id)
    if (error) { setActionError(`Delete failed: ${error.message}`); return }
    const paths = (itemRows ?? []).flatMap(r => r.photo_paths ?? [])
    await removeInspectionPhotos(supabase, paths)
    setInspections(prev => prev.filter(i => i.id !== insp.id))
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Inspections</h1>
          <p className="text-sm text-slate-500 mt-0.5">Onsite walk-throughs — capture findings as you go</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary">
          <Plus size={14} />New Inspection
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <FilterSelect value={filterProp} onChange={setFilterProp} ariaLabel="Filter by property">
          <option value="">All properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </FilterSelect>
        <FilterSelect value={filterType} onChange={setFilterType} ariaLabel="Filter by type">
          <option value="">All types</option>
          <option value="site_visit">Site Visit</option>
          <option value="annual">Annual</option>
        </FilterSelect>
        <FilterSelect value={filterStatus} onChange={setFilterStatus} ariaLabel="Filter by status">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="report_sent">Report Sent</option>
        </FilterSelect>
        {(filterProp || filterType || filterStatus) && (
          <button onClick={() => { setFilterProp(''); setFilterType(''); setFilterStatus('') }}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <X size={11} />Clear
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">{displayed.length} shown</span>
      </div>

      {/* Mutation errors surface inline — never silently pretend success */}
      {actionError && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)} aria-label="Dismiss error"
            className="text-red-400 hover:text-red-600 flex-shrink-0">
            <X size={12} />
          </button>
        </p>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : fetchError ? (
        <div className="card py-10 text-center space-y-3">
          <p className="text-sm text-red-600 flex items-center justify-center gap-1.5">
            <AlertTriangle size={14} className="flex-shrink-0" />
            Could not load inspections — {fetchError}
          </p>
          <button
            onClick={() => { setLoading(true); setFetchError(null); fetchInspections() }}
            className="btn-secondary">
            <RotateCcw size={14} />Retry
          </button>
        </div>
      ) : displayed.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="No inspections yet"
          hint="Start a new inspection before your next property walk"
          action={<button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={14} />New Inspection</button>}
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 sm:hidden">
            {displayed.map(insp => (
              <Link key={insp.id} href={`/inspections/${insp.id}`}
                className="card-hover p-3 flex items-center gap-3 block">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: propertyColor(insp.property_name) }} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900 truncate">{insp.property_name || '—'}</div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                    <span>{INSPECTION_TYPE_LABELS[insp.inspection_type] ?? insp.inspection_type}</span>
                    <span>·</span>
                    <span>{formatDate(insp.inspection_date)}</span>
                    <span>·</span>
                    <span>{insp.item_count} finding{insp.item_count === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {insp.score != null
                    ? <GradeBadge score={insp.score} />
                    : <span className="text-slate-300 text-xs">—</span>}
                  {insp.open_findings > 0 && (
                    <span className="badge text-amber-700 bg-amber-50 border-amber-200">
                      <AlertTriangle size={10} className="mr-1" />{insp.open_findings}
                    </span>
                  )}
                  <span className={cn('badge', INSPECTION_STATUS_STYLES[insp.status])}>
                    {INSPECTION_STATUS_LABELS[insp.status] ?? insp.status}
                  </span>
                  <ChevronRight size={14} className="text-slate-300" />
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <div className="card overflow-x-auto hidden sm:block">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-slate-50 border-b border-slate-200/70">
                <tr>
                  <Th label="Property" field="property_name" current={sort} dir={dir} onSort={toggle} className="pl-4" />
                  <Th label="Type" field="inspection_type" current={sort} dir={dir} onSort={toggle} />
                  <Th label="Date" field="inspection_date" current={sort} dir={dir} onSort={toggle} />
                  <Th label="Status" field="status" current={sort} dir={dir} onSort={toggle} />
                  <Th label="Score" field="score" current={sort} dir={dir} onSort={toggle} />
                  <Th label="Findings" field="item_count" current={sort} dir={dir} onSort={toggle} align="right" />
                  <Th label="Follow-ups" field="open_findings" current={sort} dir={dir} onSort={toggle} align="right" />
                  <th className="w-14" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70">
                {displayed.map(insp => (
                  <tr key={insp.id} className="hover:bg-slate-50 cursor-pointer group"
                    onClick={() => router.push(`/inspections/${insp.id}`)}>
                    <td className="pl-4 pr-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: propertyColor(insp.property_name) }} />
                        <span className="font-medium text-slate-900">{insp.property_name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                        {INSPECTION_TYPE_LABELS[insp.inspection_type] ?? insp.inspection_type}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{formatDate(insp.inspection_date)}</td>
                    <td className="px-3 py-3">
                      <span className={cn('badge', INSPECTION_STATUS_STYLES[insp.status])}>
                        {INSPECTION_STATUS_LABELS[insp.status] ?? insp.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {insp.score != null
                        ? <GradeBadge score={insp.score} />
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-700">{insp.item_count}</td>
                    <td className="px-3 py-3 text-right">
                      {insp.open_findings > 0 ? (
                        <span className="badge text-amber-700 bg-amber-50 border-amber-200">
                          <AlertTriangle size={10} className="mr-1" />{insp.open_findings}
                        </span>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      {insp.status === 'draft' && (
                        <button
                          onClick={e => { e.stopPropagation(); deleteInspection(insp) }}
                          title="Delete draft"
                          className="text-slate-300 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showNew && (
        <NewInspectionModal
          properties={properties}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  )
}

// ── New Inspection Modal ─────────────────────────────────────
// Pick property + type → INSERT a draft → jump straight into capture.

function NewInspectionModal({ properties, onClose }: {
  properties: PropertyOption[]
  onClose: () => void
}) {
  const supabase = createClient()
  const router = useRouter()
  const [propertyId, setPropertyId] = useState(properties.length === 1 ? properties[0].id : '')
  const [type, setType] = useState<InspectionType>('site_visit')
  const [date, setDate] = useState(todayISO())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start(e: React.FormEvent) {
    e.preventDefault()
    if (!propertyId) return
    setSaving(true)
    setError(null)
    const { data: auth } = await supabase.auth.getUser()
    const { data, error: insertError } = await supabase.from('inspections')
      .insert({
        property_id: propertyId,
        inspection_type: type,
        inspection_date: date || todayISO(),
        status: 'draft',
        inspected_by: auth.user?.id ?? null,
      })
      .select('id')
      .single()
    if (insertError || !data) {
      setError(insertError?.message ?? 'Could not create inspection')
      setSaving(false)
      return
    }
    router.push(`/inspections/${data.id}`)
  }

  return (
    <Modal title="New Inspection" onClose={onClose} maxWidth="md">
      <form onSubmit={start} className="px-6 py-5 space-y-4">
        <div>
          <label className="label">Property<span className="text-red-400"> *</span></label>
          <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className="input" required>
            <option value="">Select a property…</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Inspection Type</label>
          <div className="grid grid-cols-2 gap-2">
            {(['site_visit', 'annual'] as const).map(t => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={cn(
                  'border rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  type === t
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                )}>
                {INSPECTION_TYPE_LABELS[t]}
                <span className="block text-xs font-normal text-slate-400 mt-0.5">
                  {t === 'site_visit' ? 'Regular walk-through' : 'Comprehensive'}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving || !propertyId} className="btn-primary">
            {saving ? 'Starting…' : 'Start Inspection'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
