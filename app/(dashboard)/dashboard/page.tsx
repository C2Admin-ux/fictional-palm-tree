import { createClient } from '@/lib/supabase/server'
import {
  formatCurrency, formatPct, occupancyColor, delinquencyColor,
  noiVarianceColor, TRAFFIC_LIGHT, propertyColor, daysUntil,
} from '@/lib/utils'
import Link from 'next/link'
import { AlertTriangle, CheckSquare, HardHat, TrendingUp, Building2, Shield } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()

  const [
    { data: properties },
    { data: allMetrics },
    { data: tasks },
    { data: capexProjects },
    { data: policies },
    { data: claims },
  ] = await Promise.all([
    (supabase.from('properties') as any).select('*, pmcs(name)').eq('status', 'active').order('name'),
    (supabase.from('pm_metrics') as any).select('*').order('period_month', { ascending: false }),
    (supabase.from('tasks') as any).select('id, status, priority, property_id, title, due_date').neq('status', 'done'),
    (supabase.from('capex_projects') as any).select('id, property_id, title, status, budget, actual_spend').in('status', ['planning', 'approved', 'in_progress']),
    (supabase.from('insurance_policies') as any).select('id, property_id, policy_type, carrier, expiry_date, status').eq('status', 'active'),
    (supabase.from('insurance_claims') as any).select('id, property_id, status, amount_claimed').neq('status', 'closed').neq('status', 'denied'),
  ])

  const latestMetric: Record<string, any> = {}
  for (const m of (allMetrics ?? [])) {
    if (!latestMetric[m.property_id]) latestMetric[m.property_id] = m
  }

  const props = (properties ?? []) as any[]
  const openTasks = (tasks ?? []) as any[]
  const capex = (capexProjects ?? []) as any[]
  const allPolicies = (policies ?? []) as any[]
  const openClaims = (claims ?? []) as any[]

  const propsWithMetrics = props.filter(p => latestMetric[p.id]?.occupancy_pct != null)
  const avgOccupancy = propsWithMetrics.length
    ? propsWithMetrics.reduce((s, p) => s + latestMetric[p.id].occupancy_pct, 0) / propsWithMetrics.length
    : null

  const overdueCount = openTasks.filter(t => t.due_date && new Date(t.due_date) < new Date()).length
  const totalCapexBudget = capex.reduce((s, p) => s + (p.budget ?? 0), 0)
  const expiringPolicies = allPolicies.filter(p => { const d = daysUntil(p.expiry_date); return d != null && d <= 90 })
  const totalClaimed = openClaims.reduce((s, c) => s + (c.amount_claimed ?? 0), 0)

  const propMap = Object.fromEntries(props.map(p => [p.id, p.name]))

  const topTasks = [...openTasks]
    .sort((a, b) => {
      const pri: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
      return (pri[a.priority] ?? 2) - (pri[b.priority] ?? 2)
    })
    .slice(0, 6)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="page-title">Portfolio Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">{props.length} active properties</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Portfolio Occupancy" value={avgOccupancy != null ? formatPct(avgOccupancy) : '—'} sub={`${propsWithMetrics.length}/${props.length} reporting`} icon={<Building2 size={15} />} color={occupancyColor(avgOccupancy)} />
        <KpiCard label="Open Tasks" value={String(openTasks.length)} sub={overdueCount > 0 ? `${overdueCount} overdue` : 'none overdue'} icon={<CheckSquare size={15} />} alert={overdueCount > 0} href="/tasks" />
        <KpiCard label="Active CapEx" value={String(capex.length)} sub={formatCurrency(totalCapexBudget, true) + ' budget'} icon={<HardHat size={15} />} href="/capex" />
        <KpiCard label="Insurance Expiring" value={String(expiringPolicies.length)} sub="Within 90 days" icon={<Shield size={15} />} alert={expiringPolicies.length > 0} href="/insurance/policies" />
        <KpiCard label="Open Claims" value={String(openClaims.length)} sub={formatCurrency(totalClaimed, true) + ' claimed'} icon={<TrendingUp size={15} />} href="/insurance/claims" />
      </div>

      {/* Property cards */}
      <div>
        <h2 className="section-title mb-3">Properties</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {props.map(property => {
            const metric = latestMetric[property.id]
            const propTasks = openTasks.filter(t => t.property_id === property.id)
            const propCapex = capex.filter(p => p.property_id === property.id)
            const propExpiring = allPolicies.filter(p => p.property_id === property.id && (daysUntil(p.expiry_date) ?? 999) <= 90)
            const pc = propertyColor(property.name)
            const overdueProp = propTasks.filter(t => t.due_date && new Date(t.due_date) < new Date()).length

            return (
              <Link key={property.id} href={`/properties/${property.id}`} className="card-hover p-4 block">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: pc }} />
                      <span className="font-medium text-slate-900 text-sm">{property.name}</span>
                    </div>
                    <div className="text-xs text-slate-400 ml-4.5">
                      {property.city}, {property.state}
                      {property.units_total ? ` · ${property.units_total} units` : ''}
                      {' · '}{(property as any).pmcs?.name ?? 'No PMC'}
                    </div>
                  </div>
                  {metric && (
                    <span className="text-xs text-slate-400 flex-shrink-0 ml-2">
                      {new Date(metric.period_month + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                    </span>
                  )}
                </div>

                {metric ? (
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <MetricCell label="Occupancy" value={formatPct(metric.occupancy_pct)} color={occupancyColor(metric.occupancy_pct)} />
                    <MetricCell label="Delinquency" value={formatPct(metric.delinquency_pct)} color={delinquencyColor(metric.delinquency_pct)} />
                    <MetricCell label="NOI vs Bud" value={metric.noi_actual && metric.noi_budget ? `${Math.round((metric.noi_actual - metric.noi_budget) / Math.abs(metric.noi_budget) * 100)}%` : '—'} color={noiVarianceColor(metric.noi_actual, metric.noi_budget)} />
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic mb-3 py-1.5">No metrics entered yet</p>
                )}

                <div className="flex items-center gap-4 pt-2.5 border-t border-slate-100 text-xs text-slate-500">
                  <span className={overdueProp > 0 ? 'text-red-500 font-medium' : ''}>
                    <CheckSquare size={11} className="inline mr-1" />{propTasks.length} task{propTasks.length !== 1 ? 's' : ''}
                    {overdueProp > 0 && ` (${overdueProp} overdue)`}
                  </span>
                  <span><HardHat size={11} className="inline mr-1" />{propCapex.length} CapEx</span>
                  {propExpiring.length > 0 && (
                    <span className="text-amber-600 font-medium">
                      <Shield size={11} className="inline mr-1" />{propExpiring.length} expiring
                    </span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">Top Open Tasks</h2>
            <Link href="/tasks" className="text-xs text-blue-600 hover:underline">View all →</Link>
          </div>
          {topTasks.length === 0
            ? <p className="text-sm text-slate-400 italic py-2">No open tasks</p>
            : topTasks.map(task => {
              const overdue = task.due_date && new Date(task.due_date) < new Date()
              const priDot: Record<string, string> = { urgent: 'bg-red-500', high: 'bg-orange-400', medium: 'bg-blue-400', low: 'bg-slate-300' }
              return (
                <div key={task.id} className="flex items-center gap-2.5 py-2 border-b border-slate-50 last:border-0">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${priDot[task.priority] ?? 'bg-slate-300'}`} />
                  <span className="text-sm text-slate-700 flex-1 truncate">{task.title}</span>
                  {task.property_id && <span className="text-xs text-slate-400 truncate max-w-[90px] flex-shrink-0">{propMap[task.property_id]}</span>}
                  {overdue && <AlertTriangle size={12} className="text-red-400 flex-shrink-0" />}
                </div>
              )
            })}
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">Active CapEx Projects</h2>
            <Link href="/capex" className="text-xs text-blue-600 hover:underline">View all →</Link>
          </div>
          {capex.length === 0
            ? <p className="text-sm text-slate-400 italic py-2">No active projects</p>
            : capex.slice(0, 5).map(project => {
              const pct = project.budget && project.budget > 0 ? Math.min(Math.round((project.actual_spend ?? 0) / project.budget * 100), 100) : 0
              const over = (project.actual_spend ?? 0) > (project.budget ?? Infinity)
              return (
                <div key={project.id} className="mb-3 last:mb-0">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <Link href={`/capex/${project.id}`} className="text-slate-700 hover:text-blue-600 font-medium truncate max-w-[200px]">{project.title}</Link>
                    <span className="text-slate-400 ml-2 flex-shrink-0">{formatCurrency(project.actual_spend, true)} / {formatCurrency(project.budget, true)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${over ? 'bg-red-400' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`text-xs ${over ? 'text-red-500' : 'text-slate-400'}`}>{pct}%</span>
                  </div>
                </div>
              )
            })}
        </div>
      </div>

      {expiringPolicies.length > 0 && (
        <div className="p-4 border border-amber-200 bg-amber-50 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-amber-600" />
            <h2 className="text-sm font-semibold text-amber-800">{expiringPolicies.length} insurance polic{expiringPolicies.length === 1 ? 'y' : 'ies'} expiring within 90 days</h2>
            <Link href="/insurance/policies" className="ml-auto text-xs text-amber-700 hover:underline">View all →</Link>
          </div>
          {expiringPolicies.slice(0, 3).map(p => {
            const days = daysUntil(p.expiry_date)
            return (
              <div key={p.id} className="flex items-center gap-2 text-xs text-amber-700 py-0.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${(days ?? 0) <= 30 ? 'bg-red-500' : 'bg-amber-400'}`} />
                <span className="font-medium">{p.carrier}</span>
                <span className="text-amber-400">·</span>
                <span>{p.policy_type.toUpperCase()}</span>
                <span className="ml-auto font-medium">{(days ?? 0) <= 0 ? 'EXPIRED' : `${days}d left`}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, sub, icon, color, alert, href }: {
  label: string; value: string; sub?: string; icon?: React.ReactNode
  color?: string; alert?: boolean; href?: string
}) {
  const inner = (
    <div className="card p-4 h-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
        <span className={alert ? 'text-red-400' : 'text-slate-300'}>{icon}</span>
      </div>
      <div className={`text-2xl font-semibold mt-1 ${alert ? 'text-red-600' : 'text-slate-900'}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
  if (href) return <Link href={href} className="block hover:shadow-md transition-shadow rounded-xl h-full">{inner}</Link>
  return inner
}

function MetricCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={`rounded-lg px-2 py-1.5 border text-center ${TRAFFIC_LIGHT[color as keyof typeof TRAFFIC_LIGHT] ?? 'text-slate-500 bg-slate-50 border-slate-200'}`}>
      <div className="text-xs font-semibold leading-none mb-0.5">{value}</div>
      <div className="text-xs opacity-70">{label}</div>
    </div>
  )
}
