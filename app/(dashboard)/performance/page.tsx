'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Property, PmMetric } from '@/lib/supabase/types'
import {
  cn, formatCurrency, formatPct, firstOfMonth,
  occupancyColor, delinquencyColor, noiVarianceColor, workOrderCloseRateColor,
  TRAFFIC_LIGHT, TRAFFIC_DOT,
} from '@/lib/utils'
import { Plus, X, ChevronDown, BarChart2, Search } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useSort, Th } from '@/lib/utils/sort'

export default function PerformancePage() {
  const supabase = createClient()
  const [properties, setProperties] = useState<Property[]>([])
  const [metrics, setMetrics] = useState<PmMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editMetric, setEditMetric] = useState<PmMetric | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(firstOfMonth())
  const [viewMode, setViewMode] = useState<'scorecard' | 'trends'>('scorecard')

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    return firstOfMonth(d)
  })

  const fetchAll = useCallback(async () => {
    const [{ data: props }, { data: mets }] = await Promise.all([
      supabase.from('properties').select('*').eq('status', 'active').order('name'),
      supabase.from('pm_metrics').select('*').order('period_month', { ascending: false }),
    ])
    setProperties(props ?? [])
    setMetrics(mets ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const currentMetrics = Object.fromEntries(
    metrics.filter(m => m.period_month === selectedMonth).map(m => [m.property_id, m])
  )

  function trendData(propertyId: string) {
    return metrics
      .filter(m => m.property_id === propertyId)
      .slice(0, 6)
      .reverse()
      .map(m => ({
        month: new Date(m.period_month + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        occupancy: m.occupancy_pct,
        delinquency: m.delinquency_pct,
        noi: m.noi_actual,
      }))
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">PM Performance</h1>
          <p className="text-sm text-slate-500 mt-0.5">Monthly metrics across all properties</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
            <button onClick={() => setViewMode('scorecard')}
              className={cn('px-3 py-1.5 text-sm transition-colors',
                viewMode === 'scorecard' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
              Scorecard
            </button>
            <button onClick={() => setViewMode('trends')}
              className={cn('px-3 py-1.5 text-sm transition-colors border-l border-slate-200',
                viewMode === 'trends' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
              Trends
            </button>
          </div>
          {viewMode === 'scorecard' && (
            <div className="relative">
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
                className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-8 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                {monthOptions.map(m => (
                  <option key={m} value={m}>
                    {new Date(m + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-2.5 text-slate-400 pointer-events-none" />
            </div>
          )}
          <button onClick={() => { setEditMetric(null); setShowForm(true) }} className="btn-primary">
            <Plus size={14} />Enter Metrics
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : viewMode === 'scorecard' ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[780px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Property</th>
                <th className="text-center px-3 py-3 text-xs font-medium text-slate-500">Occupancy</th>
                <th className="text-center px-3 py-3 text-xs font-medium text-slate-500">Leased</th>
                <th className="text-center px-3 py-3 text-xs font-medium text-slate-500">Delinquency</th>
                <th className="text-center px-3 py-3 text-xs font-medium text-slate-500">NOI Actual</th>
                <th className="text-center px-3 py-3 text-xs font-medium text-slate-500">NOI Budget</th>
                <th className="text-center px-3 py-3 text-xs font-medium text-slate-500">NOI Var</th>
                <th className="text-center px-3 py-3 text-xs font-medium text-slate-500">WO Close</th>
                <th className="text-center px-3 py-3 text-xs font-medium text-slate-500">Moves</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {properties.map(prop => {
                const m = currentMetrics[prop.id]
                const woRate = m?.work_orders_opened && m.work_orders_opened > 0
                  ? ((m.work_orders_closed ?? 0) / m.work_orders_opened) * 100
                  : null
                return (
                  <tr key={prop.id} className="hover:bg-slate-50 group">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{prop.name}</div>
                      <div className="text-xs text-slate-400">{prop.city}, {prop.state}</div>
                    </td>
                    <MetricTd value={m ? formatPct(m.occupancy_pct) : null} color={occupancyColor(m?.occupancy_pct)} />
                    <MetricTd value={m ? formatPct(m.leased_pct) : null} color="gray" />
                    <MetricTd value={m ? formatPct(m.delinquency_pct) : null} color={delinquencyColor(m?.delinquency_pct)} />
                    <MetricTd value={m ? formatCurrency(m.noi_actual, true) : null} color={noiVarianceColor(m?.noi_actual, m?.noi_budget)} />
                    <MetricTd value={m ? formatCurrency(m.noi_budget, true) : null} color="gray" />
                    <MetricTd value={m?.noi_actual && m?.noi_budget ? `${Math.round((m.noi_actual - m.noi_budget) / Math.abs(m.noi_budget) * 100)}%` : null} color={noiVarianceColor(m?.noi_actual, m?.noi_budget)} />
                    <MetricTd value={woRate != null ? formatPct(woRate) : null} color={workOrderCloseRateColor(m?.work_orders_opened, m?.work_orders_closed)} />
                    <td className="px-3 py-3 text-center text-xs text-slate-500">
                      {m ? `${m.move_ins ?? '—'} / ${m.move_outs ?? '—'}` : '—'}
                    </td>
                    <td className="px-2 py-3">
                      {m ? (
                        <button onClick={() => { setEditMetric(m); setShowForm(true) }}
                          className="opacity-0 group-hover:opacity-100 text-xs text-blue-500 hover:text-blue-700 transition-opacity">
                          Edit
                        </button>
                      ) : (
                        <button onClick={() => { setEditMetric(null); setShowForm(true) }}
                          className="opacity-0 group-hover:opacity-100 text-xs text-slate-400 hover:text-blue-500 transition-opacity">
                          + Add
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {properties.map(prop => {
            const data = trendData(prop.id)
            return (
              <div key={prop.id} className="card p-5">
                <div className="font-medium text-slate-900 mb-4">{prop.name}</div>
                {data.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">No metrics entered yet</p>
                ) : (
                  <>
                    <div className="h-32">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data}>
                          <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={32} />
                          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                          <Line type="monotone" dataKey="occupancy" stroke="#3b82f6" strokeWidth={2} dot={false} name="Occupancy %" />
                          <Line type="monotone" dataKey="delinquency" stroke="#ef4444" strokeWidth={2} dot={false} name="Delinquency %" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex gap-4 mt-2 text-xs text-slate-400">
                      <span><span className="inline-block w-3 h-0.5 bg-blue-500 mr-1 align-middle" />Occupancy</span>
                      <span><span className="inline-block w-3 h-0.5 bg-red-400 mr-1 align-middle" />Delinquency</span>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <MetricFormModal
          properties={properties}
          metric={editMetric}
          defaultMonth={selectedMonth}
          onClose={() => { setShowForm(false); setEditMetric(null) }}
          onSave={() => { setShowForm(false); setEditMetric(null); fetchAll() }}
        />
      )}
    </div>
  )
}

function MetricTd({ value, color }: { value: string | null; color: string }) {
  if (!value) return <td className="px-3 py-3 text-center text-xs text-slate-300">—</td>
  return (
    <td className="px-3 py-3 text-center">
      <div className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
        TRAFFIC_LIGHT[color as keyof typeof TRAFFIC_LIGHT] ?? 'text-slate-600 bg-slate-50 border-slate-200')}>
        <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
          TRAFFIC_DOT[color as keyof typeof TRAFFIC_DOT] ?? 'bg-slate-300')} />
        {value}
      </div>
    </td>
  )
}

function MetricFormModal({ properties, metric, defaultMonth, onClose, onSave }: {
  properties: Property[]
  metric: PmMetric | null
  defaultMonth: string
  onClose: () => void
  onSave: () => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({
    property_id:          metric?.property_id ?? '',
    period_month:         metric?.period_month ?? defaultMonth,
    occupancy_pct:        metric?.occupancy_pct?.toString() ?? '',
    leased_pct:           metric?.leased_pct?.toString() ?? '',
    delinquency_pct:      metric?.delinquency_pct?.toString() ?? '',
    delinquency_amount:   metric?.delinquency_amount?.toString() ?? '',
    noi_actual:           metric?.noi_actual?.toString() ?? '',
    noi_budget:           metric?.noi_budget?.toString() ?? '',
    gross_revenue_actual: metric?.gross_revenue_actual?.toString() ?? '',
    gross_revenue_budget: metric?.gross_revenue_budget?.toString() ?? '',
    work_orders_opened:   metric?.work_orders_opened?.toString() ?? '',
    work_orders_closed:   metric?.work_orders_closed?.toString() ?? '',
    avg_days_to_close:    metric?.avg_days_to_close?.toString() ?? '',
    new_leases:           metric?.new_leases?.toString() ?? '',
    renewals:             metric?.renewals?.toString() ?? '',
    move_ins:             metric?.move_ins?.toString() ?? '',
    move_outs:            metric?.move_outs?.toString() ?? '',
    response_time_hrs:    metric?.response_time_hrs?.toString() ?? '',
    notes:                metric?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)

  const n = (v: string) => v !== '' ? parseFloat(v) : null
  const i = (v: string) => v !== '' ? parseInt(v) : null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      property_id:          form.property_id,
      period_month:         form.period_month,
      occupancy_pct:        n(form.occupancy_pct),
      leased_pct:           n(form.leased_pct),
      delinquency_pct:      n(form.delinquency_pct),
      delinquency_amount:   n(form.delinquency_amount),
      noi_actual:           n(form.noi_actual),
      noi_budget:           n(form.noi_budget),
      gross_revenue_actual: n(form.gross_revenue_actual),
      gross_revenue_budget: n(form.gross_revenue_budget),
      work_orders_opened:   i(form.work_orders_opened),
      work_orders_closed:   i(form.work_orders_closed),
      avg_days_to_close:    n(form.avg_days_to_close),
      new_leases:           i(form.new_leases),
      renewals:             i(form.renewals),
      move_ins:             i(form.move_ins),
      move_outs:            i(form.move_outs),
      response_time_hrs:    n(form.response_time_hrs),
      notes:                form.notes || null,
    }
    if (metric) {
      await (supabase.from('pm_metrics') as any).update(payload).eq('id', metric.id)
    } else {
      await (supabase.from('pm_metrics') as any).upsert(payload, { onConflict: 'property_id,period_month' })
    }
    setSaving(false)
    onSave()
  }

  const N = (key: string, label: string, placeholder = '') => (
    <div>
      <label className="label">{label}</label>
      <input type="number" step="any" value={(form as any)[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="input" placeholder={placeholder} />
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h2 className="font-semibold text-slate-900">{metric ? 'Edit Metrics' : 'Enter Monthly Metrics'}</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-700" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Property *</label>
              <select required value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))} className="input">
                <option value="">Select property</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Period *</label>
              <input type="month" required
                value={form.period_month.slice(0, 7)}
                onChange={e => setForm(f => ({ ...f, period_month: e.target.value + '-01' }))}
                className="input" />
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Occupancy & Leasing</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {N('occupancy_pct', 'Occupancy %', '94.0')}
              {N('leased_pct', 'Leased %', '96.0')}
              {N('move_ins', 'Move Ins', '0')}
              {N('move_outs', 'Move Outs', '0')}
              {N('new_leases', 'New Leases', '0')}
              {N('renewals', 'Renewals', '0')}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Financials</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {N('noi_actual', 'NOI Actual ($)')}
              {N('noi_budget', 'NOI Budget ($)')}
              {N('gross_revenue_actual', 'Revenue Actual ($)')}
              {N('gross_revenue_budget', 'Revenue Budget ($)')}
              {N('delinquency_pct', 'Delinquency %')}
              {N('delinquency_amount', 'Delinquency ($)')}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Work Orders</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {N('work_orders_opened', 'WO Opened')}
              {N('work_orders_closed', 'WO Closed')}
              {N('avg_days_to_close', 'Avg Days to Close')}
              {N('response_time_hrs', 'PM Response (hrs)')}
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="input min-h-[60px] resize-none" placeholder="Any notable items…" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving || !form.property_id} className="btn-primary">
              {saving ? 'Saving…' : metric ? 'Update metrics' : 'Save metrics'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
