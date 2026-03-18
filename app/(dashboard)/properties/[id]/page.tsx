import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  formatCurrency, formatPct, formatDate,
  occupancyColor, delinquencyColor, noiVarianceColor,
  TRAFFIC_LIGHT, STATUS_LABELS, STATUS_STYLES, CAPEX_STATUS_STYLES, daysUntil,
} from '@/lib/utils'
import { CheckSquare, HardHat, BarChart2, Plus, ArrowLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

const PROP_COLORS: Record<string, string> = {
  'Fox Hill Apartments':       '#1D9E75',
  'Pikes Place on San Miguel': '#D85A30',
  'Cottages on Vance':         '#7F77DD',
  'Main Street Apartments':    '#BA7517',
}

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { tab?: string }
}) {
  const supabase = await createClient()
  const tab = searchParams.tab ?? 'overview'

  const { data: property } = await supabase
    .from('properties').select('*, pmcs(*)').eq('id', params.id).single()

  if (!property) notFound()
  const prop = property as any

  const [
    { data: tasks },
    { data: capexProjects },
    { data: metrics },
    { data: documents },
    { data: policies },
  ] = await Promise.all([
    (supabase.from('tasks') as any).select('*').eq('property_id', params.id).neq('status', 'done').order('due_date', { ascending: true, nullsFirst: false }),
    (supabase.from('capex_projects') as any).select('*').eq('property_id', params.id).order('created_at', { ascending: false }),
    (supabase.from('pm_metrics') as any).select('*').eq('property_id', params.id).order('period_month', { ascending: false }).limit(12),
    (supabase.from('documents') as any).select('*').eq('property_id', params.id).order('created_at', { ascending: false }),
    (supabase.from('insurance_policies') as any).select('*').eq('property_id', params.id).eq('status', 'active'),
  ])

  const propTasks = (tasks ?? []) as any[]
  const propCapex = (capexProjects ?? []) as any[]
  const propMetrics = (metrics ?? []) as any[]
  const propDocs = (documents ?? []) as any[]
  const propPolicies = (policies ?? []) as any[]
  const latestMetric = propMetrics[0]
  const p = property as any
  const pmc = p.pmcs

  const pc = PROP_COLORS[p.name as string] ?? '#64748b'
  const abbr = (p.name as string).split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()

  const TABS = [
    { id: 'overview',  label: 'Overview' },
    { id: 'tasks',     label: `Tasks (${propTasks.length})` },
    { id: 'capex',     label: `CapEx (${propCapex.length})` },
    { id: 'metrics',   label: 'Metrics' },
    { id: 'documents', label: `Documents (${propDocs.length})` },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Hero header */}
      <div className="bg-white border-b border-slate-200 px-6 pt-4 pb-0 flex-shrink-0">
        <Link href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-600 mb-3">
          <ArrowLeft size={12} />Back to dashboard
        </Link>

        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={{ background: pc }}>
            {abbr}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-slate-900 leading-tight">{p.name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {p.city}, {p.state}
              {p.units_total ? ` · ${p.units_total} units` : ''}
              {pmc ? ` · ${pmc.name}` : ''}
            </p>
          </div>
          {latestMetric && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {[
                { label: 'Occ', value: formatPct(latestMetric.occupancy_pct), color: occupancyColor(latestMetric.occupancy_pct) },
                { label: 'Del', value: formatPct(latestMetric.delinquency_pct), color: delinquencyColor(latestMetric.delinquency_pct) },
                { label: 'NOI', value: latestMetric.noi_actual && latestMetric.noi_budget
                    ? `${Math.round((latestMetric.noi_actual - latestMetric.noi_budget) / Math.abs(latestMetric.noi_budget) * 100)}%`
                    : '—',
                  color: noiVarianceColor(latestMetric.noi_actual, latestMetric.noi_budget) },
              ].map(({ label, value, color }) => (
                <div key={label}
                  className={`px-2 py-1 rounded-lg border text-center min-w-[52px] ${TRAFFIC_LIGHT[color as keyof typeof TRAFFIC_LIGHT] ?? 'text-slate-500 bg-slate-50 border-slate-200'}`}>
                  <div className="text-xs font-semibold">{value}</div>
                  <div className="text-xs opacity-70">{label}</div>
                </div>
              ))}
            </div>
          )}
          <Link href={`/tasks?property=${params.id}`} className="btn-primary text-xs py-1.5 flex-shrink-0">
            <Plus size={12} />Add task
          </Link>
        </div>

        {/* Tab bar */}
        <div className="flex -mb-px">
          {TABS.map(t => (
            <Link key={t.id} href={`/properties/${params.id}?tab=${t.id}`}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl">
            <div className="lg:col-span-2 space-y-4">
              {/* Tasks */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-700">Open Tasks ({propTasks.length})</h3>
                  <Link href={`/properties/${params.id}?tab=tasks`} className="text-xs text-blue-600 hover:underline">View all →</Link>
                </div>
                {propTasks.length === 0
                  ? <p className="text-xs text-slate-400 italic">No open tasks</p>
                  : propTasks.slice(0, 5).map((t: any) => (
                    <div key={t.id} className="flex items-center gap-2 py-1.5 border-b border-slate-50 last:border-0">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: { urgent: '#ef4444', high: '#f97316', medium: '#3b82f6', low: '#94a3b8' }[t.priority as string] ?? '#94a3b8' }} />
                      <span className="text-sm text-slate-700 flex-1 truncate">{t.title}</span>
                      <span className={`badge text-xs ${STATUS_STYLES[t.status]}`}>{STATUS_LABELS[t.status]}</span>
                      {t.due_date && <span className="text-xs text-slate-400 flex-shrink-0">{formatDate(t.due_date)}</span>}
                    </div>
                  ))
                }
              </div>

              {/* CapEx */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-700">CapEx Projects ({propCapex.length})</h3>
                  <Link href={`/properties/${params.id}?tab=capex`} className="text-xs text-blue-600 hover:underline">View all →</Link>
                </div>
                {propCapex.length === 0
                  ? <p className="text-xs text-slate-400 italic">No CapEx projects</p>
                  : propCapex.slice(0, 4).map((cx: any) => {
                    const pct = cx.budget > 0 ? Math.min(Math.round((cx.actual_spend ?? 0) / cx.budget * 100), 100) : 0
                    const over = (cx.actual_spend ?? 0) > (cx.budget ?? Infinity)
                    return (
                      <div key={cx.id} className="mb-3 last:mb-0">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <Link href={`/capex/${cx.id}`} className="font-medium text-slate-700 hover:text-blue-600 truncate max-w-[200px]">{cx.title}</Link>
                          <span className={`badge ${CAPEX_STATUS_STYLES[cx.status]}`}>{cx.status.replace('_', ' ')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${over ? 'bg-red-400' : 'bg-orange-400'}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-slate-400">{formatCurrency(cx.actual_spend, true)} / {formatCurrency(cx.budget, true)}</span>
                        </div>
                      </div>
                    )
                  })
                }
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-4">
              <div className="card p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Property Details</h3>
                <div className="space-y-2 text-sm">
                  {[
                    ['Location', `${p.city}, ${p.state}`],
                    ['Units', p.units_total?.toString() ?? '—'],
                    ['PMC', pmc?.name ?? '—'],
                    ['Platform', p.pms_platform ?? '—'],
                    ['Acquired', formatDate(p.acquisition_date)],
                  ].map(([label, value]) => (
                    <div key={label as string} className="flex justify-between">
                      <span className="text-slate-400">{label}</span>
                      <span className="text-slate-800 font-medium text-right">{value as string}</span>
                    </div>
                  ))}
                </div>
                {pmc?.primary_contact_name && (
                  <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 space-y-0.5">
                    <div className="font-medium text-slate-700">{pmc.primary_contact_name}</div>
                    {pmc.primary_contact_email && <div>{pmc.primary_contact_email}</div>}
                    {pmc.primary_contact_phone && <div>{pmc.primary_contact_phone}</div>}
                  </div>
                )}
              </div>

              {latestMetric && (
                <div className="card p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Latest Metrics</h3>
                  <div className="space-y-2 text-sm">
                    {[
                      ['Occupancy', formatPct(latestMetric.occupancy_pct)],
                      ['Leased', formatPct(latestMetric.leased_pct)],
                      ['Delinquency', formatPct(latestMetric.delinquency_pct)],
                      ['NOI Actual', formatCurrency(latestMetric.noi_actual)],
                      ['NOI Budget', formatCurrency(latestMetric.noi_budget)],
                    ].map(([label, value]) => (
                      <div key={label as string} className="flex justify-between">
                        <span className="text-slate-400">{label}</span>
                        <span className="text-slate-800 font-medium">{value as string}</span>
                      </div>
                    ))}
                  </div>
                  <Link href={`/properties/${params.id}?tab=metrics`} className="text-xs text-blue-600 hover:underline mt-2 block">Full trend →</Link>
                </div>
              )}

              {propPolicies.length > 0 && (
                <div className="card p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Insurance</h3>
                  {propPolicies.map((p: any) => {
                    const days = daysUntil(p.expiry_date)
                    return (
                      <div key={p.id} className="flex justify-between text-xs py-1.5 border-b border-slate-50 last:border-0">
                        <span className="text-slate-600 font-medium">{p.policy_type.toUpperCase()} — {p.carrier}</span>
                        <span className={`font-medium ${(days ?? 999) <= 30 ? 'text-red-600' : (days ?? 999) <= 90 ? 'text-amber-600' : 'text-slate-400'}`}>
                          {(days ?? 0) <= 0 ? 'EXPIRED' : `${days}d`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'tasks' && (
          <div className="max-w-3xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-semibold text-slate-700">{propTasks.length} open tasks</h2>
              <Link href={`/tasks?property=${params.id}`} className="btn-primary text-xs py-1.5"><Plus size={12} />Add task</Link>
            </div>
            {propTasks.length === 0
              ? <p className="text-sm text-slate-400 italic">No open tasks for this property.</p>
              : (
                <div className="card overflow-hidden">
                  {propTasks.map((t: any, i: number) => (
                    <div key={t.id} className={`flex items-center gap-3 px-4 py-2.5 ${i < propTasks.length - 1 ? 'border-b border-slate-100' : ''} hover:bg-slate-50`}>
                      <div className="w-1 self-stretch rounded-sm flex-shrink-0" style={{ background: { urgent: '#ef4444', high: '#f97316', medium: '#3b82f6', low: '#94a3b8' }[t.priority as string] ?? '#94a3b8' }} />
                      <span className="text-sm text-slate-700 flex-1 truncate">{t.title}</span>
                      <span className={`badge text-xs ${STATUS_STYLES[t.status]}`}>{STATUS_LABELS[t.status]}</span>
                      {t.due_date && <span className="text-xs text-slate-400 flex-shrink-0">{formatDate(t.due_date)}</span>}
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        )}

        {tab === 'capex' && (
          <div className="max-w-3xl">
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm text-slate-600">
                Budget: <strong>{formatCurrency(propCapex.reduce((s: number, c: any) => s + (c.budget ?? 0), 0), true)}</strong>
                {' · '}Spent: <strong>{formatCurrency(propCapex.reduce((s: number, c: any) => s + (c.actual_spend ?? 0), 0), true)}</strong>
              </span>
              <Link href="/capex" className="btn-secondary text-xs py-1.5"><Plus size={12} />New project</Link>
            </div>
            {propCapex.length === 0
              ? <p className="text-sm text-slate-400 italic">No CapEx projects.</p>
              : (
                <div className="space-y-3">
                  {propCapex.map((cx: any) => {
                    const pct = cx.budget > 0 ? Math.min(Math.round((cx.actual_spend ?? 0) / cx.budget * 100), 100) : 0
                    const over = (cx.actual_spend ?? 0) > (cx.budget ?? Infinity)
                    return (
                      <Link key={cx.id} href={`/capex/${cx.id}`} className="card-hover p-4 block">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div>
                            <div className="font-medium text-slate-900 text-sm">{cx.title}</div>
                            <div className="text-xs text-slate-400 mt-0.5">{cx.vendor_name ?? 'Vendor TBD'}</div>
                          </div>
                          <span className={`badge flex-shrink-0 ${CAPEX_STATUS_STYLES[cx.status]}`}>{cx.status.replace('_', ' ')}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${over ? 'bg-red-400' : 'bg-orange-400'}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-slate-400">{formatCurrency(cx.actual_spend, true)} / {formatCurrency(cx.budget, true)}</span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )
            }
          </div>
        )}

        {tab === 'metrics' && (
          <div className="max-w-4xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-semibold text-slate-700">{propMetrics.length} periods recorded</h2>
              <Link href="/performance" className="btn-secondary text-xs py-1.5"><Plus size={12} />Enter metrics</Link>
            </div>
            {propMetrics.length === 0
              ? <p className="text-sm text-slate-400 italic">No metrics yet. Go to PM Performance to add monthly data.</p>
              : (
                <div className="card overflow-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50">
                        {['Month', 'Occupancy', 'Delinquency', 'NOI Actual', 'NOI Budget', 'Move Ins', 'Move Outs', 'WO Close'].map(h => (
                          <th key={h} className="text-left px-4 py-2 text-xs font-medium text-slate-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {propMetrics.map((m: any) => {
                        const woRate = m.work_orders_opened > 0 ? Math.round((m.work_orders_closed ?? 0) / m.work_orders_opened * 100) : null
                        return (
                          <tr key={m.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-medium text-slate-700">
                              {new Date(m.period_month + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                            </td>
                            <td className="px-4 py-2.5">{formatPct(m.occupancy_pct)}</td>
                            <td className="px-4 py-2.5">{formatPct(m.delinquency_pct)}</td>
                            <td className="px-4 py-2.5">{formatCurrency(m.noi_actual, true)}</td>
                            <td className="px-4 py-2.5">{formatCurrency(m.noi_budget, true)}</td>
                            <td className="px-4 py-2.5">{m.move_ins ?? '—'}</td>
                            <td className="px-4 py-2.5">{m.move_outs ?? '—'}</td>
                            <td className="px-4 py-2.5">{woRate != null ? `${woRate}%` : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            }
          </div>
        )}

        {tab === 'documents' && (
          <div className="max-w-3xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-semibold text-slate-700">{propDocs.length} documents</h2>
              <Link href="/documents" className="btn-secondary text-xs py-1.5"><Plus size={12} />Upload</Link>
            </div>
            {propDocs.length === 0
              ? <p className="text-sm text-slate-400 italic">No documents uploaded yet.</p>
              : (
                <div className="card overflow-hidden">
                  {propDocs.map((d: any, i: number) => {
                    const days = daysUntil(d.expiration_date)
                    return (
                      <div key={d.id} className={`flex items-center gap-3 px-4 py-3 ${i < propDocs.length - 1 ? 'border-b border-slate-100' : ''}`}>
                        <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 flex-shrink-0">
                          {d.category.slice(0, 3).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-700 truncate">{d.title}</div>
                          <div className="text-xs text-slate-400">{d.file_name}</div>
                        </div>
                        {d.expiration_date && (
                          <span className={`text-xs font-medium flex-shrink-0 ${(days ?? 999) <= 30 ? 'text-red-600' : (days ?? 999) <= 60 ? 'text-amber-600' : 'text-slate-400'}`}>
                            {(days ?? 0) <= 0 ? 'EXPIRED' : `Exp ${formatDate(d.expiration_date)}`}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            }
          </div>
        )}
      </div>
    </div>
  )
}
