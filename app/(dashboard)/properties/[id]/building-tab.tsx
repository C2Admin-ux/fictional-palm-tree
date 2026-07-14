'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Sparkles, Loader2, Upload, X, Check, Building2, Download, Trash2, Pencil, Plus } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'

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
  unit_mix?: { type: string; count: number; sf: number | null }[] | null
  pca_report_date?: string | null
  pca_assessor?: string | null
  pca_file_path?: string | null
  pca_file_name?: string | null
}

export default function BuildingTab({ propertyId, initialFacts }: {
  propertyId: string
  initialFacts: Facts
}) {
  const supabase = createClient()
  const [facts, setFacts] = useState<Facts>(initialFacts)
  const [items, setItems] = useState<PcaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractStatus, setExtractStatus] = useState('')
  const [review, setReview] = useState<{ facts: Facts; items: PcaItem[]; file: { name: string; base64: string } } | null>(null)

  const fetchItems = useCallback(async () => {
    const { data } = await supabase.from('property_pca_items')
      .select('*').eq('property_id', propertyId).order('category').order('sort_order')
    setItems(data ?? [])
    setLoading(false)
  }, [propertyId])

  useEffect(() => { fetchItems() }, [fetchItems])

  function fileToBase64(file: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res((r.result as string).split(',')[1])
      r.onerror = rej
      r.readAsDataURL(file)
    })
  }

  async function runExtraction(file: File) {
    setExtracting(true)
    setExtractStatus('Reading PCA report…')
    try {
      const base64 = await fileToBase64(file)
      setExtractStatus('Extracting building data with AI…')
      const res = await fetch('/api/pca/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: base64, filename: file.name }),
      })
      const data = await res.json()
      if (data.error === 'not_a_pca') { alert("That doesn't look like a property condition assessment."); setExtracting(false); return }
      if (!data.success) {
        const reason = data.detail ? `${data.error}: ${String(data.detail).slice(0, 200)}` : (data.error ?? 'unknown')
        alert('Extraction failed — ' + reason); setExtracting(false); return
      }
      setReview({ facts: data.facts, items: data.items, file: { name: file.name, base64 } })
    } catch (err: any) {
      alert('Something went wrong: ' + err.message)
    }
    setExtracting(false); setExtractStatus('')
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const file = Array.from(e.dataTransfer.files).find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (file) runExtraction(file)
    else alert('Please drop a PDF file')
  }

  async function deleteItem(id: string) {
    await supabase.from('property_pca_items').delete().eq('id', id)
    fetchItems()
  }

  const hasFacts = facts.year_built || facts.gross_sf || facts.parking_total || (facts.unit_mix?.length)
  const hasData = hasFacts || items.length > 0

  // Group items by category for display
  const grouped = items.reduce((acc, it) => {
    (acc[it.category] ??= []).push(it)
    return acc
  }, {} as Record<string, PcaItem[]>)

  return (
    <div
      onDragOver={e => { e.preventDefault(); if (!extracting) setDragOver(true) }}
      onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
      onDrop={onDrop}
      className="space-y-5 relative">

      {dragOver && (
        <div className="absolute inset-0 bg-blue-500/10 border-2 border-blue-400 border-dashed z-30 rounded-xl flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl px-6 py-4 shadow-xl text-center">
            <Sparkles size={28} className="text-blue-500 mx-auto mb-1" />
            <div className="font-semibold text-blue-700">Drop PCA report</div>
            <div className="text-xs text-slate-500">AI extracts building data</div>
          </div>
        </div>
      )}

      {extracting && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl px-8 py-6 shadow-xl text-center max-w-sm">
            <Loader2 size={30} className="text-blue-500 mx-auto mb-3 animate-spin" />
            <div className="font-semibold text-slate-800">Reading PCA report</div>
            <div className="text-sm text-slate-500 mt-1">{extractStatus}</div>
          </div>
        </div>
      )}

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
        <label className="btn-secondary cursor-pointer">
          <Sparkles size={14} />{hasData ? 'Re-scan PCA' : 'Scan PCA PDF'}
          <input type="file" accept=".pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) runExtraction(f); e.target.value = '' }} />
        </label>
      </div>

      {!hasData && !loading && (
        <EmptyState
          icon={<Building2 size={32} />}
          title="No building data yet"
          hint="Drag a PCA report PDF here, or use “Scan PCA PDF”"
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
                      <td className="w-6 align-top">
                        <button onClick={() => it.id && deleteItem(it.id)}
                          className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-opacity">
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {review && (
        <PcaReviewModal
          propertyId={propertyId}
          review={review}
          onClose={() => setReview(null)}
          onSaved={() => { setReview(null); fetchItems(); window.location.reload() }}
        />
      )}
    </div>
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
