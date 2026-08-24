'use client'

// Litigation — quick-view TABLE (Nick's layout, 8/25): one row per
// matter for scanning; click the case to open its full view at
// /litigation/[id], where the update log, counsel, and insurance
// details live. Filters: property / status (closed hidden by default)
// / type. Sorted active-first, then by nearest deadline.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { InsurancePolicy, LitigationUpdate, Property } from '@/lib/supabase/types'
import { cn, formatDate, propertyColor } from '@/lib/utils'
import { FilterSelect } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { SchemaGapNotice } from '@/components/ui/schema-gap-notice'
import { isSchemaGapError } from '@/lib/supabase/schema-errors'
import { Plus, Scale, X, ChevronRight } from 'lucide-react'
import {
  CaseFormModal, CASE_TYPES, CASE_STATUSES, TYPE_LABEL, STATUS_META, STATUS_ORDER,
  daysUntilDate, type CaseWithJoins,
} from './shared'

export default function LitigationPage() {
  const supabase = createClient()
  const [cases, setCases] = useState<CaseWithJoins[]>([])
  const [lastUpdate, setLastUpdate] = useState<Record<string, string>>({})
  const [properties, setProperties] = useState<Property[]>([])
  const [policies, setPolicies] = useState<InsurancePolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [schemaGap, setSchemaGap] = useState<{ code?: string | null; message?: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [filterProp, setFilterProp] = useState('')
  const [filterStatus, setFilterStatus] = useState('open')
  const [filterType, setFilterType] = useState('')

  const fetchAll = useCallback(async () => {
    const [casesRes, updatesRes, propsRes, policiesRes] = await Promise.all([
      supabase.from('litigation_cases')
        .select('*, properties(name), insurance_policies(policy_number, policy_type, carrier)')
        .order('created_at', { ascending: false }),
      // Newest update per case drives the "Last update" column.
      supabase.from('litigation_updates').select('case_id, created_at').order('created_at', { ascending: false }),
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
    const latest: Record<string, string> = {}
    for (const u of (updatesRes.data ?? []) as Pick<LitigationUpdate, 'case_id' | 'created_at'>[]) {
      if (!latest[u.case_id]) latest[u.case_id] = u.created_at
    }
    setLastUpdate(latest)
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
  const filtersActive = filterProp || filterType || filterStatus !== 'open'

  function deadlineCell(c: CaseWithJoins) {
    if (!c.next_deadline) return <span className="text-slate-300">—</span>
    const days = daysUntilDate(c.next_deadline)
    return (
      <span className={cn('whitespace-nowrap', days <= 14 ? 'text-red-600 font-medium' : 'text-slate-600')}
        title={c.next_deadline_label ?? undefined}>
        {formatDate(c.next_deadline)}
        {days >= 0 ? ` (${days}d)` : ' (past)'}
      </span>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Litigation</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {openCount} open matter{openCount === 1 ? '' : 's'}
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus size={14} />New Case</button>
      </div>

      {schemaGap && (
        <SchemaGapNotice error={schemaGap}
          detail="The litigation tracker needs migration 0017 — run it in the Supabase SQL Editor. Nothing has been lost." />
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
              {CASE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
            <>
              {/* Mobile cards — tap through to the full case */}
              <div className="space-y-2 md:hidden">
                {visible.map(c => {
                  const meta = STATUS_META[c.status]
                  return (
                    <Link key={c.id} href={`/litigation/${c.id}`}
                      className="card p-3 block hover:shadow-md transition-shadow space-y-1.5">
                      <div className="flex items-start gap-2">
                        <span className="text-sm font-medium text-slate-900 flex-1">{c.title}</span>
                        <span className={cn('badge flex-shrink-0', meta.style)}>{meta.label}</span>
                        <ChevronRight size={14} className="text-slate-300 mt-0.5 flex-shrink-0" />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full"
                            style={{ background: propertyColor(c.properties?.name) }} />
                          {c.properties?.name ?? '—'}
                        </span>
                        {c.litigant && <span>· {c.litigant}</span>}
                        <span>· {TYPE_LABEL[c.case_type]}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>Updated {formatDate(lastUpdate[c.id] ?? c.updated_at)}</span>
                        {c.next_deadline && deadlineCell(c)}
                      </div>
                    </Link>
                  )
                })}
              </div>

              {/* Desktop table */}
              <div className="card overflow-x-auto hidden md:block">
                <table className="w-full text-sm min-w-[820px]">
                  <thead className="bg-slate-50 border-b border-slate-200/70">
                    <tr className="text-left text-xs text-slate-500">
                      <th className="px-4 py-2.5 font-medium">Case</th>
                      <th className="px-3 py-2.5 font-medium">Property</th>
                      <th className="px-3 py-2.5 font-medium">Litigant</th>
                      <th className="px-3 py-2.5 font-medium">Type</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Notice</th>
                      <th className="px-3 py-2.5 font-medium">Last update</th>
                      <th className="px-3 py-2.5 font-medium">Next deadline</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70">
                    {visible.map(c => {
                      const meta = STATUS_META[c.status]
                      return (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <Link href={`/litigation/${c.id}`}
                              className="font-medium text-slate-900 hover:text-blue-700 hover:underline underline-offset-2">
                              {c.title}
                            </Link>
                            {c.case_number && (
                              <p className="text-xs text-slate-400 mt-0.5">#{c.case_number}</p>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ background: propertyColor(c.properties?.name) }} />
                              {c.properties?.name ?? '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">{c.litigant ?? '—'}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap">{TYPE_LABEL[c.case_type]}</td>
                          <td className="px-3 py-2.5"><span className={cn('badge', meta.style)}>{meta.label}</span></td>
                          <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                            {c.date_of_notice ? formatDate(c.date_of_notice) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                            {formatDate(lastUpdate[c.id] ?? c.updated_at)}
                          </td>
                          <td className="px-3 py-2.5 text-xs">{deadlineCell(c)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {showForm && (
        <CaseFormModal properties={properties} policies={policies}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchAll() }} />
      )}
    </div>
  )
}
