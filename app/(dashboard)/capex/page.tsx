'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CapexProject, Property } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate, CAPEX_STATUS_STYLES, CAPEX_STATUS_DOT } from '@/lib/utils'
import { Plus, X, HardHat, ChevronDown } from 'lucide-react'
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

  const fetchProjects = useCallback(async () => {
    let q = supabase
      .from('capex_projects')
      .select('*, properties(name)')
      .order('created_at', { ascending: false })
    if (filterProp) q = (q as any).eq('property_id', filterProp)
    if (filterStatus === 'active') q = (q as any).in('status', ['planning', 'approved', 'in_progress'])
    else if (filterStatus !== 'all') q = (q as any).eq('status', filterStatus)
    const { data } = await q
    setProjects((data as CapexWithProp[]) ?? [])
    setLoading(false)
  }, [filterProp, filterStatus])

  useEffect(() => { fetchProjects() }, [fetchProjects])
  useEffect(() => {
    supabase.from('properties').select('*').order('name').then(({ data }) => setProperties(data ?? []))
  }, [])

  const totalBudget = projects.reduce((s, p) => s + (p.budget ?? 0), 0)
  const totalSpend  = projects.reduce((s, p) => s + (p.actual_spend ?? 0), 0)
  const totalCommitted = projects.reduce((s, p) => s + (p.committed ?? 0), 0)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">CapEx Projects</h1>
          <p className="text-sm text-slate-500 mt-0.5">{projects.length} projects shown</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus size={14} />New Project
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Budget', value: formatCurrency(totalBudget, true) },
          { label: 'Committed', value: formatCurrency(totalCommitted, true) },
          { label: 'Actual Spend', value: formatCurrency(totalSpend, true) },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</div>
            <div className="text-2xl font-semibold text-slate-900">{value}</div>
            {label === 'Actual Spend' && totalBudget > 0 && (
              <div className="text-xs text-slate-400 mt-0.5">{Math.round(totalSpend / totalBudget * 100)}% of budget</div>
            )}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Sel value={filterProp} onChange={setFilterProp}>
          <option value="">All properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Sel>
        <Sel value={filterStatus} onChange={setFilterStatus}>
          <option value="active">Active</option>
          <option value="all">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Sel>
        {(filterProp || filterStatus !== 'active') && (
          <button onClick={() => { setFilterProp(''); setFilterStatus('active') }}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <X size={11} />Reset
          </button>
        )}
      </div>

      {/* Projects */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : projects.length === 0 ? (
        <div className="py-12 text-center card">
          <HardHat size={32} className="text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No projects match your filters</p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map(project => {
            const pct = project.budget && project.budget > 0
              ? Math.min(Math.round((project.actual_spend ?? 0) / project.budget * 100), 100)
              : 0
            const over = (project.actual_spend ?? 0) > (project.budget ?? Infinity)
            return (
              <Link key={project.id} href={`/capex/${project.id}`} className="card-hover p-4 block">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: CAPEX_STATUS_DOT[project.status] ?? '#94a3b8' }} />
                      <span className="font-medium text-slate-900">{project.title}</span>
                      <span className={`badge ${CAPEX_STATUS_STYLES[project.status]}`}>
                        {project.status.replace('_', ' ')}
                      </span>
                      {project.category && (
                        <span className="text-xs text-slate-400 border border-slate-200 px-2 py-0.5 rounded-full capitalize">
                          {project.category.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-1 ml-4">
                      {project.properties?.name}
                      {project.vendor_name && ` · ${project.vendor_name}`}
                      {project.target_completion && ` · Due ${formatDate(project.target_completion)}`}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-sm font-semibold ${over ? 'text-red-600' : 'text-slate-900'}`}>
                      {formatCurrency(project.actual_spend, true)}
                    </div>
                    <div className="text-xs text-slate-400">of {formatCurrency(project.budget, true)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${over ? 'bg-red-400' : 'bg-orange-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`text-xs font-medium ${over ? 'text-red-500' : 'text-slate-500'}`}>{pct}%</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {showForm && (
        <CapexFormModal
          properties={properties}
          onClose={() => setShowForm(false)}
          onSave={() => { setShowForm(false); fetchProjects() }}
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

function CapexFormModal({ properties, onClose, onSave }: {
  properties: Property[]; onClose: () => void; onSave: () => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({
    title: '', property_id: '', category: '', status: 'planning',
    priority: 'medium', budget: '', vendor_name: '', vendor_contact: '',
    start_date: '', target_completion: '', notes: '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.property_id) return
    setSaving(true)
    await (supabase.from('capex_projects') as any).insert({
      title: form.title,
      property_id: form.property_id,
      category: form.category || null,
      status: form.status,
      priority: form.priority,
      budget: form.budget ? parseFloat(form.budget) : null,
      vendor_name: form.vendor_name || null,
      vendor_contact: form.vendor_contact || null,
      start_date: form.start_date || null,
      target_completion: form.target_completion || null,
      notes: form.notes || null,
    })
    setSaving(false)
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h2 className="font-semibold text-slate-900">New CapEx Project</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-700" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="label">Project Title *</label>
            <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="input" placeholder="e.g. Roof Replacement — Building A" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Property *</label>
              <select required value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))} className="input">
                <option value="">Select property</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input">
                <option value="">None</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="input">
                {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="input">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="label">Budget ($)</label>
              <input type="number" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
                className="input" placeholder="0" min="0" step="100" />
            </div>
            <div>
              <label className="label">Vendor</label>
              <input value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))}
                className="input" placeholder="Vendor name" />
            </div>
            <div>
              <label className="label">Start Date</label>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">Target Completion</label>
              <input type="date" value={form.target_completion} onChange={e => setForm(f => ({ ...f, target_completion: e.target.value }))} className="input" />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="input min-h-[60px] resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving || !form.property_id} className="btn-primary">
              {saving ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
