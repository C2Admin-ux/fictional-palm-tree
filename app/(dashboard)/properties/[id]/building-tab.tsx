'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Sparkles, Check, Building2, Trash2, Pencil, Plus } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'
import { DragOverlay } from '@/components/ui/drag-overlay'
import { ExtractingOverlay } from '@/components/ui/extracting-overlay'
import { usePdfExtraction, isPdfTooLargeError, type ExtractResponse } from '@/lib/hooks/use-pdf-extraction'
import { TaskFromRecord } from '@/components/ui/task-from-record'
import type { UnitMix } from '@/lib/supabase/types'

type PcaItem = {
  id?: string
  property_id?: string
  category: string
  label: string
  value: string | null
  detail: string | null
  est_cost: number | null
  rul_years: number | null
  sort_order?: number
}

type Facts = {
  year_built?: number | null
  year_renovated?: number | null
  gross_sf?: number | null
  net_rentable_sf?: number | null
  land_acres?: number | null
  num_buildings?: number | null
  num_stories?: number | null
  parking_total?: number | null
  parking_covered?: number | null
  parking_uncovered?: number | null
  construction_type?: string | null
  roof_type?: string | null
  unit_mix?: UnitMix | null
  pca_report_date?: string | null
  pca_assessor?: string | null
  pca_file_path?: string | null
  pca_file_name?: string | null
  parcel_number?: string | null
}

// Known PCA item categories (matches the extraction prompt in app/api/pca/extract)
const PCA_CATEGORIES = [
  'Site', 'Structure', 'Envelope', 'Roof', 'HVAC', 'Plumbing',
  'Electrical', 'Interiors', 'Amenities', 'ADA', 'Other',
]

export default function BuildingTab({ propertyId, propertyName, initialFacts }: {
  propertyId: string
  propertyName: string
  initialFacts: Facts
}) {
  const supabase = createClient()
  const router = useRouter()
  const [facts, setFacts] = useState<Facts>(initialFacts)
  const [items, setItems] = useState<PcaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [review, setReview] = useState<{ facts: Facts; items: PcaItem[]; file: { name: string; base64: string } } | null>(null)
  const [editingFacts, setEditingFacts] = useState(false)
  const [itemModal, setItemModal] = useState<{ item: PcaItem | null } | null>(null)

  const fetchItems = useCallback(async () => {
    const { data } = await supabase.from('property_pca_items')
      .select('*').eq('property_id', propertyId).order('category').order('sort_order')
    setItems(data ?? [])
    setLoading(false)
  }, [propertyId])

  useEffect(() => { fetchItems() }, [fetchItems])

  const pdf = usePdfExtraction<ExtractResponse & { facts?: Facts; items?: PcaItem[] }>({
    endpoint: '/api/pca/extract',
    readingMessage: 'Reading PCA report…',
    extractingMessage: 'Extracting building data with AI…',
    onSuccess: (data, file) => {
      setReview({ facts: data.facts ?? {}, items: data.items ?? [], file })
    },
  })
  const { error: extractError, setError: setExtractError } = pdf

  useEffect(() => {
    if (!extractError) return
    alert(extractError === 'not_a_pca'
      ? "That doesn't look like a property condition assessment."
      : extractError === 'Please drop a PDF file' || isPdfTooLargeError(extractError)
        ? extractError
        : 'Extraction failed — ' + extractError)
    setExtractError(null)
  }, [extractError, setExtractError])

  async function deleteItem(id: string) {
    await supabase.from('property_pca_items').delete().eq('id', id)
    fetchItems()
  }

  const hasFacts = Boolean(
    facts.year_built || facts.year_renovated || facts.gross_sf || facts.net_rentable_sf ||
    facts.land_acres || facts.num_buildings || facts.num_stories ||
    facts.parking_total || facts.parking_covered || facts.parking_uncovered ||
    facts.construction_type || facts.roof_type || facts.parcel_number ||
    facts.unit_mix?.length
  )
  const hasData = hasFacts || items.length > 0

  // Group items by category for display
  const grouped = items.reduce((acc, it) => {
    (acc[it.category] ??= []).push(it)
    return acc
  }, {} as Record<string, PcaItem[]>)

  return (
    <div
      {...pdf.dragProps}
      className="space-y-5 relative">

      {pdf.dragOver && <DragOverlay position="absolute" title="Drop PCA report" hint="AI extracts building data" />}
      {pdf.extracting && <ExtractingOverlay title="Reading PCA report" status={pdf.status} />}

      {/* Header + upload */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">Building & PCA Data</h3>
          {facts.pca_file_name && (
            <p className="text-xs text-slate-400 mt-0.5">
              Source: {facts.pca_file_name}
              {facts.pca_report_date && ` · ${new Date(facts.pca_report_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
              {facts.pca_assessor && ` · ${facts.pca_assessor}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditingFacts(true)} className="btn-secondary">
            <Pencil size={14} />Edit facts
          </button>
          <button onClick={() => setItemModal({ item: null })} className="btn-secondary">
            <Plus size={14} />Add item
          </button>
          <label className="btn-secondary cursor-pointer">
            <Sparkles size={14} />{hasData ? 'Re-scan PCA' : 'Scan PCA PDF'}
            <input type="file" accept=".pdf" className="hidden" onChange={pdf.onInputChange} />
          </label>
        </div>
      </div>

      {!hasData && !loading && (
        <EmptyState
          icon={<Building2 size={32} />}
          title="No building data yet"
          hint="Drag a PCA report PDF here, use “Scan PCA PDF”, or enter data manually with “Edit facts”"
          className="border-dashed"
        />
      )}

      {/* Key facts grid */}
      {hasFacts && (
        <div className="card p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Key Facts</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
            <Fact label="Year Built" value={facts.year_built} />
            <Fact label="Renovated" value={facts.year_renovated} />
            <Fact label="Gross SF" value={facts.gross_sf ? facts.gross_sf.toLocaleString() : null} />
            <Fact label="Net Rentable SF" value={facts.net_rentable_sf ? facts.net_rentable_sf.toLocaleString() : null} />
            <Fact label="Land (acres)" value={facts.land_acres} />
            <Fact label="Buildings" value={facts.num_buildings} />
            <Fact label="Stories" value={facts.num_stories} />
            <Fact label="Construction" value={facts.construction_type} />
            <Fact label="Parking (total)" value={facts.parking_total} />
            <Fact label="  · Covered" value={facts.parking_covered} />
            <Fact label="  · Uncovered" value={facts.parking_uncovered} />
            <Fact label="Roof" value={facts.roof_type} />
            <Fact label="Parcel #" value={facts.parcel_number} />
          </div>
        </div>
      )}

      {/* Unit mix */}
      {facts.unit_mix && facts.unit_mix.length > 0 && (
        <div className="card p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Unit Mix</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-100">
                <th className="text-left font-medium py-1.5">Type</th>
                <th className="text-right font-medium py-1.5">Count</th>
                <th className="text-right font-medium py-1.5">Avg SF</th>
              </tr>
            </thead>
            <tbody>
              {facts.unit_mix.map((u, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 text-slate-700 font-medium">{u.type}</td>
                  <td className="py-1.5 text-right text-slate-600">{u.count}</td>
                  <td className="py-1.5 text-right text-slate-500">{u.sf ? u.sf.toLocaleString() : '—'}</td>
                </tr>
              ))}
              <tr className="font-semibold text-slate-700">
                <td className="py-1.5">Total</td>
                <td className="py-1.5 text-right">{facts.unit_mix.reduce((s, u) => s + (u.count || 0), 0)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Detailed items by category */}
      {Object.keys(grouped).length > 0 && (
        <div className="space-y-3">
          {Object.entries(grouped).map(([cat, catItems]) => (
            <div key={cat} className="card p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{cat}</div>
              <table className="w-full text-sm">
                <tbody>
                  {catItems.map(it => (
                    <tr key={it.id} className="group border-b border-slate-50 last:border-0">
                      <td className="py-1.5 pr-3 text-slate-500 align-top w-1/3">{it.label}</td>
                      <td className="py-1.5 pr-3 text-slate-800 align-top">
                        {it.value}
                        {it.detail && <span className="block text-xs text-slate-400 mt-0.5">{it.detail}</span>}
                      </td>
                      <td className="py-1.5 text-right align-top whitespace-nowrap text-slate-500">
                        {it.rul_years != null && <span className="text-xs">{it.rul_years} yr RUL</span>}
                        {it.est_cost != null && <span className="block text-xs">${it.est_cost.toLocaleString()}</span>}
                      </td>
                      <td className="w-24 align-top">
                        <div className="flex justify-end items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <TaskFromRecord
                            title={`Address: ${it.label} — ${propertyName}`}
                            propertyId={propertyId}
                            tags={['pca']}
                          />
                          <button onClick={() => setItemModal({ item: it })} aria-label="Edit item"
                            className="text-slate-300 hover:text-blue-500">
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => it.id && deleteItem(it.id)} aria-label="Delete item"
                            className="text-slate-300 hover:text-red-400">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {editingFacts && (
        <FactsEditModal
          propertyId={propertyId}
          facts={facts}
          onClose={() => setEditingFacts(false)}
          onSaved={updated => {
            setFacts(updated)
            setEditingFacts(false)
            // Refresh the parent server component (hero parcel / stat strip).
            router.refresh()
          }}
        />
      )}

      {itemModal && (
        <PcaItemModal
          propertyId={propertyId}
          item={itemModal.item}
          nextSortOrder={items.reduce((m, it) => Math.max(m, it.sort_order ?? 0), -1) + 1}
          onClose={() => setItemModal(null)}
          onSaved={() => {
            setItemModal(null)
            fetchItems()
          }}
        />
      )}

      {review && (
        <PcaReviewModal
          propertyId={propertyId}
          review={review}
          onClose={() => setReview(null)}
          onSaved={() => {
            setReview(null)
            fetchItems()
            // Refresh the parent server component (building facts in the
            // property hero) without a full page reload.
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

// ── Manual edit: building facts + unit mix ───────────────────

// String-draft mirror of the editable Facts fields — inputs hold strings,
// parsed to number-or-null (empty → null) on save.
type FactsDraft = {
  year_built: string; year_renovated: string; gross_sf: string; net_rentable_sf: string
  land_acres: string; num_buildings: string; num_stories: string
  parking_total: string; parking_covered: string; parking_uncovered: string
  construction_type: string; roof_type: string
  pca_report_date: string; pca_assessor: string; parcel_number: string
}

type UnitRowDraft = { type: string; count: string; sf: string }

const toStr = (v: string | number | null | undefined) => (v == null ? '' : String(v))
const parseNum = (v: string) => {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const parseStr = (v: string) => v.trim() || null

function FactsEditModal({ propertyId, facts, onClose, onSaved }: {
  propertyId: string
  facts: Facts
  onClose: () => void
  onSaved: (updated: Facts) => void
}) {
  const supabase = createClient()
  const [draft, setDraft] = useState<FactsDraft>({
    year_built: toStr(facts.year_built),
    year_renovated: toStr(facts.year_renovated),
    gross_sf: toStr(facts.gross_sf),
    net_rentable_sf: toStr(facts.net_rentable_sf),
    land_acres: toStr(facts.land_acres),
    num_buildings: toStr(facts.num_buildings),
    num_stories: toStr(facts.num_stories),
    parking_total: toStr(facts.parking_total),
    parking_covered: toStr(facts.parking_covered),
    parking_uncovered: toStr(facts.parking_uncovered),
    construction_type: toStr(facts.construction_type),
    roof_type: toStr(facts.roof_type),
    pca_report_date: toStr(facts.pca_report_date),
    pca_assessor: toStr(facts.pca_assessor),
    parcel_number: toStr(facts.parcel_number),
  })
  const [units, setUnits] = useState<UnitRowDraft[]>(
    (facts.unit_mix ?? []).map(u => ({ type: u.type, count: toStr(u.count), sf: toStr(u.sf) }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setD(k: keyof FactsDraft, v: string) { setDraft(d => ({ ...d, [k]: v })) }
  function setUnit(i: number, k: keyof UnitRowDraft, v: string) {
    setUnits(us => us.map((u, j) => (j === i ? { ...u, [k]: v } : u)))
  }

  async function save() {
    setSaving(true)
    setError(null)

    const unit_mix: UnitMix = units
      .filter(u => u.type.trim() !== '')
      .map(u => ({ type: u.type.trim(), count: parseNum(u.count) ?? 0, sf: parseNum(u.sf) }))

    const update = {
      year_built: parseNum(draft.year_built),
      year_renovated: parseNum(draft.year_renovated),
      gross_sf: parseNum(draft.gross_sf),
      net_rentable_sf: parseNum(draft.net_rentable_sf),
      land_acres: parseNum(draft.land_acres),
      num_buildings: parseNum(draft.num_buildings),
      num_stories: parseNum(draft.num_stories),
      parking_total: parseNum(draft.parking_total),
      parking_covered: parseNum(draft.parking_covered),
      parking_uncovered: parseNum(draft.parking_uncovered),
      construction_type: parseStr(draft.construction_type),
      roof_type: parseStr(draft.roof_type),
      pca_report_date: parseStr(draft.pca_report_date),
      pca_assessor: parseStr(draft.pca_assessor),
      parcel_number: parseStr(draft.parcel_number),
      unit_mix: unit_mix.length ? unit_mix : null,
    }

    const { error: updateError } = await supabase.from('properties').update(update).eq('id', propertyId)
    setSaving(false)
    if (updateError) { setError(updateError.message); return }
    onSaved({ ...facts, ...update })
  }

  const F = (k: keyof FactsDraft, label: string, type = 'text') => (
    <div>
      <label className="label">{label}</label>
      <input type={type} value={draft[k]} onChange={e => setD(k, e.target.value)} className="input" />
    </div>
  )

  return (
    <Modal
      onClose={onClose}
      maxWidth="3xl"
      title={
        <div className="flex items-center gap-2">
          <Pencil size={17} className="text-blue-500" />
          <div>
            <h2 className="font-semibold text-slate-900">Edit Building Facts</h2>
            <p className="text-xs text-slate-400">Fill gaps or correct values manually</p>
          </div>
        </div>
      }>
        <div className="px-6 py-5 space-y-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Key Facts</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {F('year_built', 'Year Built', 'number')}
            {F('year_renovated', 'Year Renovated', 'number')}
            {F('gross_sf', 'Gross SF', 'number')}
            {F('net_rentable_sf', 'Net Rentable SF', 'number')}
            {F('land_acres', 'Land (acres)', 'number')}
            {F('num_buildings', 'Buildings', 'number')}
            {F('num_stories', 'Stories', 'number')}
            {F('parking_total', 'Parking Total', 'number')}
            {F('parking_covered', 'Covered', 'number')}
            {F('parking_uncovered', 'Uncovered', 'number')}
            {F('construction_type', 'Construction')}
            {F('roof_type', 'Roof Type')}
            {F('pca_report_date', 'PCA Report Date', 'date')}
            {F('pca_assessor', 'PCA Assessor')}
            {F('parcel_number', 'Parcel #')}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Unit Mix</div>
              <button
                onClick={() => setUnits(us => [...us, { type: '', count: '', sf: '' }])}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <Plus size={12} />Add row
              </button>
            </div>
            {units.length === 0
              ? <p className="text-xs text-slate-400 italic">No unit mix rows. Use “Add row” to enter unit types.</p>
              : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_90px_90px_24px] gap-2 text-xs text-slate-400">
                    <span>Type</span><span>Count</span><span>Avg SF</span><span />
                  </div>
                  {units.map((u, i) => (
                    <div key={i} className="grid grid-cols-[1fr_90px_90px_24px] gap-2 items-center">
                      <input value={u.type} placeholder="e.g. 2BR/2BA"
                        onChange={e => setUnit(i, 'type', e.target.value)} className="input" />
                      <input type="number" value={u.count}
                        onChange={e => setUnit(i, 'count', e.target.value)} className="input" />
                      <input type="number" value={u.sf}
                        onChange={e => setUnit(i, 'sf', e.target.value)} className="input" />
                      <button onClick={() => setUnits(us => us.filter((_, j) => j !== i))}
                        aria-label="Remove row" className="text-slate-300 hover:text-red-400 justify-self-center">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
          {error && <span className="text-xs text-red-600 mr-auto">Save failed — {error}</span>}
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : <><Check size={14} />Save facts</>}
          </button>
        </div>
    </Modal>
  )
}

// ── Manual add / edit: PCA detail items ──────────────────────

const CUSTOM_CATEGORY = '__custom__'

function PcaItemModal({ propertyId, item, nextSortOrder, onClose, onSaved }: {
  propertyId: string
  item: PcaItem | null   // null = create new
  nextSortOrder: number
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const isCustom = item != null && !PCA_CATEGORIES.includes(item.category)
  const [category, setCategory] = useState(item ? (isCustom ? CUSTOM_CATEGORY : item.category) : PCA_CATEGORIES[0])
  const [customCategory, setCustomCategory] = useState(isCustom && item ? item.category : '')
  const [label, setLabel] = useState(item?.label ?? '')
  const [value, setValue] = useState(item?.value ?? '')
  const [detail, setDetail] = useState(item?.detail ?? '')
  const [estCost, setEstCost] = useState(toStr(item?.est_cost))
  const [rulYears, setRulYears] = useState(toStr(item?.rul_years))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finalCategory = category === CUSTOM_CATEGORY ? customCategory.trim() : category
  const canSave = label.trim() !== '' && finalCategory !== ''

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)

    const row = {
      category: finalCategory,
      label: label.trim(),
      value: parseStr(value),
      detail: parseStr(detail),
      est_cost: parseNum(estCost),
      rul_years: parseNum(rulYears),
    }

    const { error: saveError } = item?.id
      ? await supabase.from('property_pca_items').update(row).eq('id', item.id)
      : await supabase.from('property_pca_items').insert({ ...row, property_id: propertyId, sort_order: nextSortOrder })

    setSaving(false)
    if (saveError) { setError(saveError.message); return }
    onSaved()
  }

  return (
    <Modal
      onClose={onClose}
      maxWidth="lg"
      title={
        <div className="flex items-center gap-2">
          {item ? <Pencil size={17} className="text-blue-500" /> : <Plus size={17} className="text-blue-500" />}
          <h2 className="font-semibold text-slate-900">{item ? 'Edit PCA Item' : 'Add PCA Item'}</h2>
        </div>
      }>
        <div className="px-6 py-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className="input">
                {PCA_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                <option value={CUSTOM_CATEGORY}>Custom…</option>
              </select>
            </div>
            {category === CUSTOM_CATEGORY && (
              <div>
                <label className="label">Custom Category</label>
                <input value={customCategory} onChange={e => setCustomCategory(e.target.value)}
                  placeholder="e.g. Immediate Repairs" className="input" />
              </div>
            )}
          </div>
          <div>
            <label className="label">Label *</label>
            <input value={label} onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Roof covering" className="input" />
          </div>
          <div>
            <label className="label">Value</label>
            <input value={value} onChange={e => setValue(e.target.value)}
              placeholder="e.g. Modified bitumen, fair condition" className="input" />
          </div>
          <div>
            <label className="label">Detail</label>
            <textarea value={detail} onChange={e => setDetail(e.target.value)} rows={2}
              placeholder="Optional notes" className="input resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Est. Cost ($)</label>
              <input type="number" value={estCost} onChange={e => setEstCost(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">RUL (years)</label>
              <input type="number" value={rulYears} onChange={e => setRulYears(e.target.value)} className="input" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
          {error && <span className="text-xs text-red-600 mr-auto">Save failed — {error}</span>}
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || !canSave} className="btn-primary">
            {saving ? 'Saving…' : <><Check size={14} />{item ? 'Save changes' : 'Add item'}</>}
          </button>
        </div>
    </Modal>
  )
}

function Fact({ label, value }: { label: string; value: any }) {
  if (value == null || value === '') return (
    <div><div className="text-xs text-slate-400">{label}</div><div className="text-sm text-slate-300">—</div></div>
  )
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-sm font-medium text-slate-800">{value}</div>
    </div>
  )
}

function PcaReviewModal({ propertyId, review, onClose, onSaved }: {
  propertyId: string
  review: { facts: Facts; items: PcaItem[]; file: { name: string; base64: string } }
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [facts, setFacts] = useState<Facts>(review.facts)
  const [items] = useState<PcaItem[]>(review.items)
  const [saving, setSaving] = useState(false)

  function setF(k: keyof Facts, v: any) { setFacts(f => ({ ...f, [k]: v })) }

  async function save() {
    setSaving(true)
    // Upload the PCA file
    let pca_file_path: string | null = null
    let pca_file_name: string | null = null
    try {
      const bytes = Uint8Array.from(atob(review.file.base64), c => c.charCodeAt(0))
      const path = `pca/${propertyId}/${Date.now()}-${review.file.name}`
      const { error } = await supabase.storage.from('c2-documents').upload(path, bytes, { contentType: 'application/pdf' })
      if (!error) { pca_file_path = path; pca_file_name = review.file.name }
    } catch { /* non-fatal */ }

    const num = (v: any) => (v === '' || v == null ? null : Number(v))

    // Update property facts
    await supabase.from('properties').update({
      year_built: num(facts.year_built),
      year_renovated: num(facts.year_renovated),
      gross_sf: num(facts.gross_sf),
      net_rentable_sf: num(facts.net_rentable_sf),
      land_acres: num(facts.land_acres),
      num_buildings: num(facts.num_buildings),
      num_stories: num(facts.num_stories),
      parking_total: num(facts.parking_total),
      parking_covered: num(facts.parking_covered),
      parking_uncovered: num(facts.parking_uncovered),
      construction_type: facts.construction_type || null,
      roof_type: facts.roof_type || null,
      unit_mix: facts.unit_mix ?? null,
      pca_report_date: facts.pca_report_date || null,
      pca_assessor: facts.pca_assessor || null,
      pca_file_path, pca_file_name,
    }).eq('id', propertyId)

    // Insert line items
    if (items.length) {
      const rows = items.map((it, i) => ({
        property_id: propertyId,
        category: it.category || 'Other',
        label: it.label,
        value: it.value ?? null,
        detail: it.detail ?? null,
        est_cost: it.est_cost ?? null,
        rul_years: it.rul_years ?? null,
        sort_order: i,
      }))
      await supabase.from('property_pca_items').insert(rows)
    }

    setSaving(false)
    onSaved()
  }

  const F = (k: keyof Facts, label: string, type = 'text') => (
    <div>
      <label className="label">{label}</label>
      <input type={type} value={(facts[k] as any) ?? ''} onChange={e => setF(k, e.target.value)} className="input" />
    </div>
  )

  return (
    <Modal
      onClose={onClose}
      maxWidth="3xl"
      title={
        <div className="flex items-center gap-2">
          <Sparkles size={17} className="text-blue-500" />
          <div>
            <h2 className="font-semibold text-slate-900">Review PCA Extraction</h2>
            <p className="text-xs text-slate-400">{review.file.name} · {items.length} detail items found</p>
          </div>
        </div>
      }>
        <div className="px-6 py-5 space-y-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Key Facts</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {F('year_built', 'Year Built', 'number')}
            {F('year_renovated', 'Year Renovated', 'number')}
            {F('gross_sf', 'Gross SF', 'number')}
            {F('net_rentable_sf', 'Net Rentable SF', 'number')}
            {F('land_acres', 'Land (acres)', 'number')}
            {F('num_buildings', 'Buildings', 'number')}
            {F('num_stories', 'Stories', 'number')}
            {F('parking_total', 'Parking Total', 'number')}
            {F('parking_covered', 'Covered', 'number')}
            {F('parking_uncovered', 'Uncovered', 'number')}
            {F('construction_type', 'Construction')}
            {F('roof_type', 'Roof Type')}
            {F('pca_report_date', 'Report Date', 'date')}
            {F('pca_assessor', 'Assessor')}
          </div>

          {facts.unit_mix && facts.unit_mix.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Unit Mix ({facts.unit_mix.length} types)</div>
              <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
                {facts.unit_mix.map((u, i) => (
                  <span key={i} className="inline-block mr-3">{u.type}: {u.count}{u.sf ? ` (${u.sf} sf)` : ''}</span>
                ))}
              </div>
            </div>
          )}

          {items.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Detail Items ({items.length})</div>
              <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50">
                {items.map((it, i) => (
                  <div key={i} className="px-3 py-1.5 text-xs flex gap-2">
                    <span className="text-slate-400 w-24 flex-shrink-0">{it.category}</span>
                    <span className="text-slate-600 flex-shrink-0 w-32">{it.label}</span>
                    <span className="text-slate-800">{it.value}</span>
                    {it.rul_years != null && <span className="text-slate-400 ml-auto">{it.rul_years}yr</span>}
                    {it.est_cost != null && <span className="text-slate-400">${it.est_cost.toLocaleString()}</span>}
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1">All {items.length} items will be saved. You can delete individual ones afterward.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : <><Check size={14} />Save building data</>}
          </button>
        </div>
    </Modal>
  )
}
