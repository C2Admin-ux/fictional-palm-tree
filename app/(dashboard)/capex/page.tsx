'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CapexProject, Property } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate, CAPEX_STATUS_STYLES, CAPEX_STATUS_DOT } from '@/lib/utils'
import { useSort, Th } from '@/lib/utils/sort'
import { Plus, X, HardHat, ChevronDown, Search } from 'lucide-react'
import { InlineText, InlineSelect, InlineDate, CAPEX_STATUS_OPTIONS, CAPEX_CATEGORY_OPTIONS, CAPEX_PRIORITY_OPTIONS } from '@/components/ui/inline-edit'
import Link from 'next/link'

const STATUSES = ['planning', 'approved', 'in_progress', 'complete', 'on_hold'] as const
const CATEGORIES = ['roof', 'hvac', 'plumbing', 'exterior', 'unit_turn', 'amenity', 'other'] as const
type CapexWithProp = CapexProject & { properties?: { name: string } | null }

export default function CapexPage() {
  const supabase = createClient()
  const [projects, setProjects] = useState<CapexWithProp[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterProp, setFilterProp] = useState('')
  const [filterStatus, setFilterStatus] = useState('active')
  const [filterCategory, setFilterCategory] = useState('')
  const [search, setSearch] = useState('')
  const { sort, dir, toggle, sortFn } = useSort<string>('created_at', 'desc')

  const fetchProjects = useCallback(async () => {
    let q = (supabase.from('capex_projects') as any).select('*, properties(name)')
    if (filterProp) q = q.eq('property_id', filterProp)
    if (filterStatus === 'active') q = q.in('status', ['planning', 'approved', 'in_progress'])
    else if (filterStatus !== 'all') q = q.eq('status', filterStatus)
    if (filterCategory) q = q.eq('category', filterCategory)
    const { data } = await q
    setProjects(data ?? [])
    setLoading(false)
  }, [filterProp, filterStatus, filterCategory])

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
          <div key={label} className="card p-4">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</div>
            <div className="text-2xl font-semibold text-slate-900">{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-44 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search…" />
        </div>
        <Sel value={filterProp} onChange={setFilterProp}>
          <option value="">All properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Sel>
        <Sel value={filterStatus} onChange={setFilterStatus}>
          <option value="active">Active</option>
          <option value="all">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Sel>
        <Sel value={filterCategory} onChange={setFilterCategory}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </Sel>
        {(filterProp || filterStatus !== 'active' || filterCategory || search) && (
          <button onClick={() => { setFilterProp(''); setFilterStatus('active'); setFilterCategory(''); setSearch('') }}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <X size={11} />Clear
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : displayed.length === 0 ? (
        <div className="py-12 text-center card">
          <HardHat size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No projects match your filters</p>
        </div>
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
                const pct = p.budget && p.budget > 0 ? Math.min(Math.round((p.actual_spend ?? 0) / p.budget * 100), 100) : 0
                const over = (p.actual_spend ?? 0) > (p.budget ?? Infinity)

                async function patch(fields: Record<string, unknown>) {
                  await (supabase.from('capex_projects') as any).update(fields).eq('id', p.id)
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

function CapexFormModal({ properties, onClose, onSave }: { properties: Property[]; onClose: () => void; onSave: () => void }) {
  const supabase = createClient()
  const [form, setForm] = useState({ title: '', property_id: '', category: '', status: 'planning', priority: 'medium', budget: '', vendor_name: '', vendor_contact: '', start_date: '', target_completion: '', notes: '' })
  const [saving, setSaving] = useState(false)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.property_id) return
    setSaving(true)
    await (supabase.from('capex_projects') as any).insert({ title: form.title, property_id: form.property_id, category: form.category || null, status: form.status, priority: form.priority, budget: form.budget ? parseFloat(form.budget) : null, vendor_name: form.vendor_name || null, vendor_contact: form.vendor_contact || null, start_date: form.start_date || null, target_completion: form.target_completion || null, notes: form.notes || null })
    setSaving(false); onSave()
  }
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h2 className="font-semibold text-slate-900">New CapEx Project</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div><label className="label">Title *</label><input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="input" placeholder="e.g. Roof Replacement — Building A" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Property *</label><select required value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))} className="input"><option value="">Select</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label">Category</label><select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input"><option value="">None</option>{CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select></div>
            <div><label className="label">Status</label><select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="input">{STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
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
      </div>
    </div>
  )
}
