'use client'

// CapEx page — Nick's layout (2026-08-23): filterable kanban board on
// top for the quick pipeline read, filterable detail table underneath,
// click through either to the project detail page — which is where the
// full status and the bid comparison live. One shared filter bar
// (search / property / category) feeds BOTH surfaces; the table adds
// its own status filter (default Active) and group-by, since on the
// board status is already the columns.

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CapexProject, Property } from '@/lib/supabase/types'
import { cn, formatCurrency, propertyColor } from '@/lib/utils'
import { useSort, Th } from '@/lib/utils/sort'
import { Plus, X, HardHat, Search, AlertTriangle } from 'lucide-react'
import { InlineText, InlineSelect, InlineDate, CAPEX_STATUS_OPTIONS, CAPEX_CATEGORY_OPTIONS } from '@/components/ui/inline-edit'
import { FilterSelect } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { StatTile } from '@/components/ui/stat-tile'
import { EmptyState } from '@/components/ui/empty-state'
import Link from 'next/link'
import { BidChip } from '@/components/capex/bid-chip'
import { CapexBoard, ProjectCard, budgetUsage, type CapexWithProp, type CapexStatus } from './capex-board'

// Status vocabulary (values + Nick's labels) comes from
// CAPEX_STATUS_OPTIONS / CAPEX_STATUS_LABELS so every status surface
// (board columns, inline select, filters, form) stays in lockstep.
const ACTIVE_STATUSES: CapexProject['status'][] = ['planning', 'approved', 'in_progress']
const CATEGORIES = ['roof', 'hvac', 'plumbing', 'exterior', 'unit_turn', 'amenity', 'other'] as const

// ── Property grouping (table) ────────────────────────────────
// Sections in property-name order, projects without a property under
// "No property" last. Input order (the active column sort) is
// preserved within each group.

type PropertyGroup = {
  key: string
  label: string
  projects: CapexWithProp[]
  budget: number
  spend: number
}

function groupByProperty(projects: CapexWithProp[]): PropertyGroup[] {
  const map = new Map<string, PropertyGroup>()
  for (const p of projects) {
    const key = p.property_id ?? 'none'
    let entry = map.get(key)
    if (!entry) {
      entry = { key, label: p.properties?.name ?? 'No property', projects: [], budget: 0, spend: 0 }
      map.set(key, entry)
    }
    entry.projects.push(p)
    entry.budget += p.budget ?? 0
    entry.spend += p.actual_spend ?? 0
  }
  return Array.from(map.values()).sort((a, b) =>
    a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label.localeCompare(b.label))
}

// Shared section-header content (desktop table row + mobile card list):
// property dot, name, project count, summed budget vs actual.
function GroupHeader({ group }: { group: PropertyGroup }) {
  return (
    <>
      <span className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: propertyColor(group.key === 'none' ? null : group.label) }} />
      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide truncate">{group.label}</span>
      <span className="text-xs text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded-full flex-shrink-0">{group.projects.length}</span>
      <span className="ml-auto pl-2 text-xs text-slate-400 whitespace-nowrap">
        {formatCurrency(group.budget, true)} budget · {formatCurrency(group.spend, true)} spent
      </span>
    </>
  )
}

export default function CapexPage() {
  const supabase = createClient()

  const [projects, setProjects] = useState<CapexWithProp[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  // Shared filters — narrow the board AND the table.
  const [filterProp, setFilterProp] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [search, setSearch] = useState('')
  // Table-only controls: on the board, status is the columns.
  const [filterStatus, setFilterStatus] = useState('active')
  const [groupBy, setGroupBy] = useState<'property' | 'none'>('property')
  const [moveError, setMoveError] = useState<string | null>(null)
  // Monotonic fetch sequence: responses that don't match the latest seq are
  // stale (a newer fetch — or an optimistic mutation — superseded them).
  const fetchSeq = useRef(0)
  const { sort, dir, toggle, sortFn } = useSort<string>('created_at', 'desc')

  const fetchProjects = useCallback(async () => {
    // Always fetch every status — board and table share one dataset; the
    // table's status filter is applied client-side. Only property/category
    // narrow the query server-side.
    const seq = ++fetchSeq.current
    setRefreshing(true)
    // capex_bids embed is lean on purpose — just what bidGlance needs
    // for the one-chip summary on rows and cards.
    let q = supabase.from('capex_projects').select('*, properties(name), capex_bids(vendor_name, status, amount)')
    if (filterProp) q = q.eq('property_id', filterProp)
    if (filterCategory) q = q.eq('category', filterCategory)
    const { data } = await q
    if (seq !== fetchSeq.current) return // stale — a newer fetch or mutation won
    setProjects(data ?? [])
    setLoading(false)
    setRefreshing(false)
  }, [filterProp, filterCategory])

  useEffect(() => { fetchProjects() }, [fetchProjects])
  useEffect(() => {
    supabase.from('properties').select('*').order('name').then(({ data }) => setProperties(data ?? []))
  }, [])

  // Board set: shared filters only (every status — the columns carry it).
  const boardProjects = [...projects].filter(p => {
    if (!search) return true
    const s = search.toLowerCase()
    return p.title.toLowerCase().includes(s) ||
      (p.properties?.name ?? '').toLowerCase().includes(s) ||
      (p.vendor_name ?? '').toLowerCase().includes(s)
  })

  // Table set: board set narrowed by the status filter, column-sorted.
  const tableRows = boardProjects
    .filter(p => {
      if (filterStatus === 'active') return ACTIVE_STATUSES.includes(p.status)
      if (filterStatus === 'all') return true
      return p.status === filterStatus
    })
    .sort(sortFn)

  const totalBudget = boardProjects.reduce((s, p) => s + (p.budget ?? 0), 0)
  const totalSpend  = boardProjects.reduce((s, p) => s + (p.actual_spend ?? 0), 0)

  // Sections for the grouped table; null renders the flat table. A single
  // group (e.g. a property filter is active) also renders flat — the
  // header would just repeat the filter.
  const groups = (() => {
    if (groupBy !== 'property') return null
    const g = groupByProperty(tableRows)
    return g.length > 1 ? g : null
  })()

  // Optimistic status change from the board: move the card immediately,
  // snap it back with an inline error if the update fails.
  async function moveProject(id: string, status: CapexStatus) {
    const project = projects.find(p => p.id === id)
    if (!project || project.status === status) return
    const prevStatus = project.status
    setMoveError(null)
    // Invalidate any in-flight fetch: a response issued before this move
    // would clobber the optimistic status with pre-move data.
    fetchSeq.current++
    setRefreshing(false)
    setProjects(ps => ps.map(p => p.id === id ? { ...p, status } : p))
    const { error } = await supabase.from('capex_projects').update({ status }).eq('id', id)
    if (error) {
      // Compare-and-swap rollback: only revert if the card still holds the
      // status THIS call set — a later move (or edit) may have won since.
      setProjects(ps => ps.map(p => p.id === id && p.status === status ? { ...p, status: prevStatus } : p))
      setMoveError(`Couldn't move “${project.title}” — ${error.message}`)
    }
  }

  const filtersActive = filterProp || filterCategory || search

  // Mobile card — the table section's small-screen rendering. Tap
  // through to detail; inline editing is desktop-only.
  function renderCard(p: CapexWithProp) {
    return (
      <Link key={p.id} href={`/capex/${p.id}`} className="block">
        <ProjectCard project={p} showStatus showChevron
          className="hover:shadow-md transition-shadow" />
      </Link>
    )
  }

  // Desktop table row. The title links to the detail page — full status
  // and the bid comparison live there; the other cells stay
  // inline-editable for quick fixes without leaving the table.
  function renderRow(p: CapexWithProp) {
    const { pct, over } = budgetUsage(p)

    async function patch(fields: Record<string, unknown>) {
      await supabase.from('capex_projects').update(fields).eq('id', p.id)
      fetchProjects()
    }

    return (
      <tr key={p.id} className="hover:bg-slate-50 group">
        <td className="px-4 py-2.5 text-xs text-slate-500">{p.properties?.name ?? '—'}</td>
        <td className="px-3 py-2.5">
          <Link href={`/capex/${p.id}`}
            className="font-medium text-slate-900 text-sm hover:text-blue-700 hover:underline underline-offset-2">
            {p.title}
          </Link>
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
          {p.budget != null && p.budget > 0 ? (
            <div className="flex items-center justify-end gap-2">
              <div className="w-16 bg-slate-100 rounded-full h-1.5">
                <div className={cn('h-1.5 rounded-full', over ? 'bg-red-400' : 'bg-orange-400')} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
              <span className={cn('text-xs min-w-[2rem] text-right', over ? 'text-red-500 font-medium' : 'text-slate-400')}>{pct}%</span>
            </div>
          ) : over ? (
            <span className="text-xs text-red-500 font-medium whitespace-nowrap">over — no budget</span>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <InlineText
            value={p.vendor_name}
            onSave={v => patch({ vendor_name: v })}
            displayClassName="text-xs text-slate-600"
            placeholder="add vendor"
          />
          {(p.capex_bids?.length || p.bids_target != null) ? (
            <div className="mt-1">
              <BidChip bids={p.capex_bids} target={p.bids_target} />
            </div>
          ) : null}
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
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">CapEx Projects</h1>
          <p className="text-sm text-slate-500 mt-0.5">{boardProjects.length} projects</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus size={14} />New Project
        </button>
      </div>

      {/* KPI strip — follows the shared filters, every status */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {[
          { label: 'Total Budget', value: formatCurrency(totalBudget, true) },
          { label: 'Actual Spend', value: formatCurrency(totalSpend, true) },
          { label: '% Used', value: totalBudget > 0 ? `${Math.round(totalSpend / totalBudget * 100)}%` : '—' },
        ].map(({ label, value }) => (
          <StatTile key={label} label={label} value={value} />
        ))}
      </div>

      {/* Shared filters — narrow the board and the table together */}
      <div className="flex flex-wrap gap-2 items-center">
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
        <FilterSelect value={filterCategory} onChange={setFilterCategory}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </FilterSelect>
        {filtersActive && (
          <button onClick={() => { setFilterProp(''); setFilterCategory(''); setSearch('') }}
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
      ) : (
      // Dim (but keep interactive) while a refetch is in flight so filter
      // changes and edits don't render against silently-stale data.
      <div className={cn('transition-opacity space-y-6', refreshing && 'opacity-60')} aria-busy={refreshing || undefined}>
      {boardProjects.length === 0 ? (
        <EmptyState icon={<HardHat size={32} />} title="No projects match your filters" />
      ) : (
        <>
          {/* Kanban board — the quick pipeline read; drag between
              columns to change status, click a card for full status. */}
          <CapexBoard projects={boardProjects} onMove={moveProject} />

          {/* Detail table — its own status filter (the board's columns
              already show status) and group-by. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-slate-700">
                Project details
                <span className="ml-2 text-xs font-normal text-slate-400">{tableRows.length} shown</span>
              </h2>
              <div className="flex items-center gap-2">
                <FilterSelect value={filterStatus} onChange={setFilterStatus}>
                  <option value="active">Active</option>
                  <option value="all">All statuses</option>
                  {CAPEX_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </FilterSelect>
                <FilterSelect value={groupBy} onChange={v => setGroupBy(v as 'property' | 'none')}
                  ariaLabel="Group by"
                  options={[
                    { value: 'property', label: 'Group: Property' },
                    { value: 'none',     label: 'Group: None' },
                  ]} />
              </div>
            </div>

            {tableRows.length === 0 ? (
              <p className="text-sm text-slate-400 italic">
                No projects match the table&apos;s status filter — the board above still shows every status.
              </p>
            ) : (
              <>
                {/* Mobile cards */}
                {groups ? (
                  <div className="space-y-4 md:hidden">
                    {groups.map(g => (
                      <div key={g.key} className="space-y-2">
                        <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
                          <GroupHeader group={g} />
                        </div>
                        {g.projects.map(renderCard)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2 md:hidden">
                    {tableRows.map(renderCard)}
                  </div>
                )}

                {/* Desktop table */}
                <div className="card overflow-x-auto hidden md:block">
                  <table className="w-full text-sm min-w-[800px]">
                    <thead className="bg-slate-50 border-b border-slate-200/70">
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
                    {groups ? groups.map(g => (
                      // One tbody per property: a section header row (slightly
                      // stronger top edge for scanability), then the project
                      // rows — the active column sort applies within the group.
                      <tbody key={g.key} className="divide-y divide-slate-200/70">
                        <tr className="bg-slate-50 border-t border-slate-200">
                          <td colSpan={9} className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <GroupHeader group={g} />
                            </div>
                          </td>
                        </tr>
                        {g.projects.map(renderRow)}
                      </tbody>
                    )) : (
                      <tbody className="divide-y divide-slate-200/70">
                        {tableRows.map(renderRow)}
                      </tbody>
                    )}
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label">Property *</label><select required value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))} className="input"><option value="">Select</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label">Category</label><select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input"><option value="">None</option>{CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select></div>
            <div><label className="label">Status</label><select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as CapexProject['status'] }))} className="input">{CAPEX_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
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
