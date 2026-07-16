'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { CapexProject, Property } from '@/lib/supabase/types'
import { cn, formatCurrency } from '@/lib/utils'
import { useSort, Th } from '@/lib/utils/sort'
import { Plus, X, HardHat, Search, List, LayoutGrid, AlertTriangle } from 'lucide-react'
import { InlineText, InlineSelect, InlineDate, CAPEX_STATUS_OPTIONS, CAPEX_CATEGORY_OPTIONS } from '@/components/ui/inline-edit'
import { FilterSelect } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { StatTile } from '@/components/ui/stat-tile'
import { EmptyState } from '@/components/ui/empty-state'
import { CapexBoard, budgetUsage, type CapexWithProp, type CapexStatus } from './capex-board'

const STATUSES = ['planning', 'approved', 'in_progress', 'complete', 'on_hold'] as const
const CATEGORIES = ['roof', 'hvac', 'plumbing', 'exterior', 'unit_turn', 'amenity', 'other'] as const

export default function CapexPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading…</div>}>
      <CapexInner />
    </Suspense>
  )
}

function CapexInner() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const view: 'list' | 'board' = searchParams.get('view') === 'board' ? 'board' : 'list'

  const [projects, setProjects] = useState<CapexWithProp[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterProp, setFilterProp] = useState('')
  const [filterStatus, setFilterStatus] = useState('active')
  const [filterCategory, setFilterCategory] = useState('')
  const [search, setSearch] = useState('')
  const [moveError, setMoveError] = useState<string | null>(null)
  const { sort, dir, toggle, sortFn } = useSort<string>('created_at', 'desc')

  function setView(v: 'list' | 'board') {
    router.replace(v === 'board' ? '/capex?view=board' : '/capex', { scroll: false })
  }

  const fetchProjects = useCallback(async () => {
    let q = supabase.from('capex_projects').select('*, properties(name)')
    if (filterProp) q = q.eq('property_id', filterProp)
    // The board always shows all five status columns — only the list
    // narrows by status.
    if (view === 'list') {
      if (filterStatus === 'active') q = q.in('status', ['planning', 'approved', 'in_progress'])
      else if (filterStatus !== 'all') q = q.eq('status', filterStatus as CapexProject['status'])
    }
    if (filterCategory) q = q.eq('category', filterCategory)
    const { data } = await q
    setProjects(data ?? [])
    setLoading(false)
  }, [filterProp, filterStatus, filterCategory, view])

  useEffect(() => { fetchProjects() }, [fetchProjects])
  useEffect(() => {
    supabase.from('properties').select('*').order('name').then(({ data }) => setProperties(data ?? []))
  }, [])

  const displayed = [...projects]
    .filter(p => {
      if (!search) return true
      const s = search.toLowerCase()
      return p.title.toLowerCase().includes(s) ||
        (p.properties?.name ?? '').toLowerCase().includes(s) ||
        (p.vendor_name ?? '').toLowerCase().includes(s)
    })
    .sort(sortFn)

  const totalBudget = displayed.reduce((s, p) => s + (p.budget ?? 0), 0)
  const totalSpend  = displayed.reduce((s, p) => s + (p.actual_spend ?? 0), 0)

  // Optimistic status change from the board: move the card immediately,
  // snap it back with an inline error if the update fails.
  async function moveProject(id: string, status: CapexStatus) {
    const project = projects.find(p => p.id === id)
    if (!project || project.status === status) return
    const prevStatus = project.status
    setMoveError(null)
    setProjects(ps => ps.map(p => p.id === id ? { ...p, status } : p))
    const { error } = await supabase.from('capex_projects').update({ status }).eq('id', id)
    if (error) {
      setProjects(ps => ps.map(p => p.id === id ? { ...p, status: prevStatus } : p))
      setMoveError(`Couldn't move “${project.title}” — ${error.message}`)
    }
  }

  const filtersActive = filterProp || filterCategory || search || (view === 'list' && filterStatus !== 'active')

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">CapEx Projects</h1>
          <p className="text-sm text-slate-500 mt-0.5">{displayed.length} projects</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus size={14} />New Project
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Budget', value: formatCurrency(totalBudget, true) },
          { label: 'Actual Spend', value: formatCurrency(totalSpend, true) },
          { label: '% Used', value: totalBudget > 0 ? `${Math.round(totalSpend / totalBudget * 100)}%` : '—' },
        ].map(({ label, value }) => (
          <StatTile key={label} label={label} value={value} />
        ))}
      </div>

      {/* View toggle + filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden" role="group" aria-label="View">
          {([['list', 'List', List], ['board', 'Board', LayoutGrid]] as const).map(([v, label, Icon]) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className={cn('px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
                view === v ? 'bg-blue-50 text-blue-700' : 'bg-white text-slate-500 hover:bg-slate-50')}>
              <Icon size={13} />{label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-44 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search…" />
        </div>
        <FilterSelect value={filterProp} onChange={setFilterProp}>
          <option value="">All properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </FilterSelect>
        {view === 'list' && (
          <FilterSelect value={filterStatus} onChange={setFilterStatus}>
            <option value="active">Active</option>
            <option value="all">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </FilterSelect>
        )}
        <FilterSelect value={filterCategory} onChange={setFilterCategory}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </FilterSelect>
        {filtersActive && (
          <button onClick={() => { setFilterProp(''); setFilterStatus('active'); setFilterCategory(''); setSearch('') }}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <X size={11} />Clear
          </button>
        )}
      </div>

      {/* Board move errors surface inline — the card already snapped back */}
      {moveError && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span className="flex-1">{moveError}</span>
          <button onClick={() => setMoveError(null)} aria-label="Dismiss error"
            className="text-red-400 hover:text-red-600 flex-shrink-0">
            <X size={12} />
          </button>
        </p>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : displayed.length === 0 ? (
        <EmptyState icon={<HardHat size={32} />} title="No projects match your filters" />
      ) : view === 'board' ? (
        <CapexBoard projects={displayed} onMove={moveProject} />
      ) : (
        <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <Th label="Property" field="property_id" current={sort} dir={dir} onSort={toggle} className="pl-4" />
                  <Th label="Title" field="title" current={sort} dir={dir} onSort={toggle} />
                  <Th label="Category" field="category" current={sort} dir={dir} onSort={toggle} />
                  <Th label="Status" field="status" current={sort} dir={dir} onSort={toggle} />
                  <Th label="Budget" field="budget" current={sort} dir={dir} onSort={toggle} align="right" />
                  <Th label="Spent" field="actual_spend" current={sort} dir={dir} onSort={toggle} align="right" />
                  <Th label="% Used" align="right" />
                  <Th label="Vendor" field="vendor_name" current={sort} dir={dir} onSort={toggle} />
                  <Th label="Target" field="target_completion" current={sort} dir={dir} onSort={toggle} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {displayed.map(p => {
                  const { pct, over } = budgetUsage(p)

                  async function patch(fields: Record<string, unknown>) {
                    await supabase.from('capex_projects').update(fields).eq('id', p.id)
                    fetchProjects()
                  }

                  return (
                    <tr key={p.id} className="hover:bg-slate-50 group">
                      <td className="px-4 py-2.5 text-xs text-slate-500">{p.properties?.name ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <InlineText
                          value={p.title}
                          onSave={v => patch({ title: v })}
                          displayClassName="font-medium text-slate-900 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <InlineSelect
                          value={p.category ?? ''}
                          options={CAPEX_CATEGORY_OPTIONS}
                          onSave={v => patch({ category: v })}
                          trigger={
                            p.category
                              ? <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full capitalize cursor-pointer hover:bg-slate-200 transition-colors">{p.category.replace('_', ' ')}</span>
                              : <span className="text-xs text-slate-300 italic cursor-pointer hover:text-slate-500">set category</span>
                          }
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <InlineSelect
                          value={p.status}
                          options={CAPEX_STATUS_OPTIONS}
                          onSave={v => patch({ status: v })}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <InlineText
                          value={p.budget?.toString() ?? ''}
                          onSave={v => patch({ budget: parseFloat(v) || null })}
                          displayClassName={cn('text-sm text-slate-700', !p.budget && 'text-slate-300 italic')}
                          placeholder="set budget"
                        />
                      </td>
                      <td className={cn('px-3 py-2.5 text-right text-sm font-medium', over ? 'text-red-600' : 'text-slate-700')}>{formatCurrency(p.actual_spend, true)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-slate-100 rounded-full h-1.5">
                            <div className={cn('h-1.5 rounded-full', over ? 'bg-red-400' : 'bg-orange-400')} style={{ width: `${pct}%` }} />
                          </div>
                          <span className={cn('text-xs w-8 text-right', over ? 'text-red-500' : 'text-slate-400')}>{pct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <InlineText
                          value={p.vendor_name}
                          onSave={v => patch({ vendor_name: v })}
                          displayClassName="text-xs text-slate-600"
                          placeholder="add vendor"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <InlineDate
                          value={p.target_completion}
                          onSave={v => patch({ target_completion: v })}
                          className="text-xs text-slate-500"
                          emptyLabel="set date"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
        </div>
      )}

      {showForm && (
        <CapexFormModal properties={properties}
          onClose={() => setShowForm(false)}
          onSave={() => { setShowForm(false); fetchProjects() }} />
      )}
    </div>
  )
}

function CapexFormModal({ properties, onClose, onSave }: { properties: Property[]; onClose: () => void; onSave: () => void }) {
  const supabase = createClient()
  const [form, setForm] = useState({ title: '', property_id: '', category: '', status: 'planning' as CapexProject['status'], priority: 'medium' as CapexProject['priority'], budget: '', vendor_name: '', vendor_contact: '', start_date: '', target_completion: '', notes: '' })
  const [saving, setSaving] = useState(false)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.property_id) return
    setSaving(true)
    await supabase.from('capex_projects').insert({ title: form.title, property_id: form.property_id, category: form.category || null, status: form.status, priority: form.priority, budget: form.budget ? parseFloat(form.budget) : null, vendor_name: form.vendor_name || null, vendor_contact: form.vendor_contact || null, start_date: form.start_date || null, target_completion: form.target_completion || null, notes: form.notes || null })
    setSaving(false); onSave()
  }
  return (
    <Modal title="New CapEx Project" onClose={onClose} maxWidth="lg">
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div><label className="label">Title *</label><input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="input" placeholder="e.g. Roof Replacement — Building A" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Property *</label><select required value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))} className="input"><option value="">Select</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label">Category</label><select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input"><option value="">None</option>{CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select></div>
            <div><label className="label">Status</label><select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as CapexProject['status'] }))} className="input">{STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
            <div><label className="label">Budget ($)</label><input type="number" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} className="input" placeholder="0" /></div>
            <div><label className="label">Vendor</label><input value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))} className="input" /></div>
            <div><label className="label">Target Completion</label><input type="date" value={form.target_completion} onChange={e => setForm(f => ({ ...f, target_completion: e.target.value }))} className="input" /></div>
          </div>
          <div><label className="label">Notes</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input min-h-[60px] resize-none" /></div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving || !form.property_id} className="btn-primary">{saving ? 'Creating…' : 'Create project'}</button>
          </div>
        </form>
    </Modal>
  )
}
