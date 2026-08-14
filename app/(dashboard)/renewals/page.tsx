'use client'

// Renewal tracker — when PMs send renewal offers for review, and when we
// send approvals back.
//
// The app TRACKS email traffic. It composes nothing and sends nothing:
// the offer arrives in Gmail, the approval goes out from Gmail, and the
// buttons here record that it happened. Everything on this page is a date
// somebody marks afterwards.
//
// Rows are property × expiration month — the month whose leases are being
// renewed, which is how every PM batches them and how their subject lines
// are named ("FHL Renewals 6.2026", "Pikes and Pebble - June Renewals").

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { RenewalCycle, RenewalSetting } from '@/lib/supabase/types'
import { cn, formatDate, propertyColor, todayISO } from '@/lib/utils'
import {
  cadenceOf, cycleStage, isOverdue, daysLate, approvalTurnaroundDays,
  monthLabel, cycleDueDate, DEFAULT_LEAD_DAYS,
  STAGE_LABELS, STAGE_STYLES, type CadenceConfig,
} from '@/lib/renewals/cycles'
import { SchemaGapNotice } from '@/components/ui/schema-gap-notice'
import { isSchemaGapError } from '@/lib/supabase/schema-errors'
import { EmptyState } from '@/components/ui/empty-state'
import { toast } from '@/components/ui/toast'
import {
  CalendarClock, AlertTriangle, Check, RotateCcw, RefreshCw,
  ExternalLink, Settings2, ListTodo,
} from 'lucide-react'

type PropertyRow = { id: string; name: string }

// The three legs, in the order they actually happen. Rendering them from
// one list keeps the button, the label and the column in lockstep.
const LEGS = [
  { key: 'offer_received_at', label: 'Offers in', verb: 'Mark received' },
  { key: 'approved_at', label: 'Approved', verb: 'Mark approved' },
  { key: 'partner_approved_at', label: 'Partner', verb: 'Mark partner' },
] as const

type LegKey = typeof LEGS[number]['key']

export default function RenewalsPage() {
  const supabase = createClient()
  const [cycles, setCycles] = useState<RenewalCycle[]>([])
  const [settings, setSettings] = useState<RenewalSetting[]>([])
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showCadence, setShowCadence] = useState(false)
  const [schemaGap, setSchemaGap] = useState<{ code?: string | null; message?: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = todayISO()

  const fetchAll = useCallback(async () => {
    const [cyclesRes, settingsRes, propsRes] = await Promise.all([
      supabase.from('renewal_cycles').select('*')
        .order('expiration_month').order('due_date'),
      supabase.from('renewal_settings').select('*'),
      supabase.from('properties').select('id, name').eq('status', 'active').order('name'),
    ])
    // An empty board and a missing table look identical on screen. Only
    // the second is worth saying out loud.
    if (cyclesRes.error) {
      setSchemaGap(isSchemaGapError(cyclesRes.error) ? cyclesRes.error : null)
      if (!isSchemaGapError(cyclesRes.error)) setError(cyclesRes.error.message)
      setLoading(false)
      return
    }
    setSchemaGap(null)
    setError(null)
    setCycles((cyclesRes.data ?? []) as RenewalCycle[])
    setSettings((settingsRes.data ?? []) as RenewalSetting[])
    setProperties((propsRes.data ?? []) as PropertyRow[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const cadenceFor = useCallback((propertyId: string): CadenceConfig =>
    cadenceOf(settings.find(s => s.property_id === propertyId)), [settings])

  const propertyName = useMemo(
    () => new Map(properties.map(p => [p.id, p.name])), [properties])

  // Grouped by expiration month, months ascending — the board reads as a
  // forward calendar, with anything already late called out on top.
  const months = useMemo(() => {
    const byMonth = new Map<string, RenewalCycle[]>()
    for (const c of cycles) {
      const list = byMonth.get(c.expiration_month) ?? []
      list.push(c)
      byMonth.set(c.expiration_month, list)
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, rows]) => ({
        month,
        rows: rows.sort((a, b) =>
          (propertyName.get(a.property_id) ?? '').localeCompare(propertyName.get(b.property_id) ?? '')),
      }))
  }, [cycles, propertyName])

  const overdue = useMemo(
    () => cycles.filter(c => isOverdue(c, today)), [cycles, today])

  const awaitingUs = useMemo(
    () => cycles.filter(c => c.offer_received_at && !c.approved_at), [cycles])

  async function setLeg(cycle: RenewalCycle, leg: LegKey, value: string | null) {
    const previous = cycle[leg]
    setCycles(prev => prev.map(c => c.id === cycle.id ? { ...c, [leg]: value } : c))
    const { error: updateError } = await supabase.from('renewal_cycles')
      .update({ [leg]: value, updated_at: new Date().toISOString() })
      .eq('id', cycle.id)
    if (updateError) {
      // Put it back rather than leaving the board claiming something the
      // database doesn't have.
      setCycles(prev => prev.map(c => c.id === cycle.id ? { ...c, [leg]: previous } : c))
      toast(`Couldn't save — ${updateError.message}`, { tone: 'error' })
    }
  }

  async function sync() {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch('/api/renewals/sync')
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        const base = json.error ?? `Sync failed (${res.status})`
        throw new Error(json.detail ? `${base} — ${json.detail}` : base)
      }
      const bits = [
        json.cyclesCreated ? `${json.cyclesCreated} cycle${json.cyclesCreated === 1 ? '' : 's'} added` : null,
        json.chasesCreated ? `${json.chasesCreated} chase task${json.chasesCreated === 1 ? '' : 's'} created` : null,
        json.chasesResolved ? `${json.chasesResolved} resolved` : null,
      ].filter(Boolean)
      toast(bits.length > 0 ? bits.join(' · ') : 'Everything already up to date')
      fetchAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed — try again.')
    } finally {
      setSyncing(false)
    }
  }

  async function saveCadence(propertyId: string, patch: Partial<RenewalSetting>) {
    const existing = settings.find(s => s.property_id === propertyId)
    const next = { ...(existing ?? { property_id: propertyId }), ...patch } as RenewalSetting
    setSettings(prev => existing
      ? prev.map(s => s.property_id === propertyId ? next : s)
      : [...prev, next])
    const { error: upsertError } = await supabase.from('renewal_settings')
      .upsert({ ...patch, property_id: propertyId, updated_at: new Date().toISOString() },
        { onConflict: 'property_id' })
    if (upsertError) {
      toast(`Couldn't save cadence — ${upsertError.message}`, { tone: 'error' })
      fetchAll()
    }
  }

  if (schemaGap) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <h1 className="page-title">Renewals</h1>
        <SchemaGapNotice error={schemaGap}
          detail="The renewal tracker needs the renewal_cycles and renewal_settings tables from migration 0014_renewal_cycles.sql." />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Renewals</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Offers in from the PM, approvals back out — tracked, never sent from here
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCadence(v => !v)} className="btn-secondary">
            <Settings2 size={14} />Cadence
          </button>
          <button onClick={sync} disabled={syncing} className="btn-primary">
            <RefreshCw size={14} className={cn(syncing && 'animate-spin')} />
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>

      {/* The two numbers that matter: who owes us, and what we owe back */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className={cn('card px-4 py-3', overdue.length > 0 && 'border-red-200 bg-red-50/40')}>
          <p className="text-xs uppercase tracking-wide text-slate-500">Overdue from PMs</p>
          <p className={cn('text-2xl font-bold', overdue.length > 0 ? 'text-red-700' : 'text-slate-900')}>
            {overdue.length}
          </p>
          {overdue.length > 0 && (
            <p className="text-xs text-red-700 mt-0.5">
              {Array.from(new Set(overdue.map(c => propertyName.get(c.property_id))))
                .filter(Boolean).join(', ')}
            </p>
          )}
        </div>
        <div className={cn('card px-4 py-3', awaitingUs.length > 0 && 'border-blue-200 bg-blue-50/40')}>
          <p className="text-xs uppercase tracking-wide text-slate-500">Waiting on your approval</p>
          <p className={cn('text-2xl font-bold', awaitingUs.length > 0 ? 'text-blue-700' : 'text-slate-900')}>
            {awaitingUs.length}
          </p>
          {awaitingUs.length > 0 && (
            <p className="text-xs text-blue-700 mt-0.5">
              {Array.from(new Set(awaitingUs.map(c => propertyName.get(c.property_id))))
                .filter(Boolean).join(', ')}
            </p>
          )}
        </div>
      </div>

      {showCadence && (
        <CadencePanel
          properties={properties}
          cadenceFor={cadenceFor}
          onSave={saveCadence}
        />
      )}

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0" />{error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : months.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={28} />}
          title="No renewal cycles yet"
          hint="Sync now generates the next six months for every active property."
          action={<button onClick={sync} className="btn-primary"><RefreshCw size={14} />Sync now</button>}
        />
      ) : (
        months.map(({ month, rows }) => (
          <section key={month} className="space-y-2">
            <h2 className="section-title">{monthLabel(month)} expirations</h2>
            <div className="card divide-y divide-slate-200/70">
              {rows.map(cycle => (
                <CycleRow
                  key={cycle.id}
                  cycle={cycle}
                  name={propertyName.get(cycle.property_id) ?? 'Unknown property'}
                  cadence={cadenceFor(cycle.property_id)}
                  today={today}
                  onSetLeg={setLeg}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

// ── One cycle row ────────────────────────────────────────────

function CycleRow({ cycle, name, cadence, today, onSetLeg }: {
  cycle: RenewalCycle
  name: string
  cadence: CadenceConfig
  today: string
  onSetLeg: (cycle: RenewalCycle, leg: LegKey, value: string | null) => void
}) {
  const stage = cycleStage(cycle, cadence.requiresPartnerApproval)
  const late = isOverdue(cycle, today)
  const lateBy = daysLate(cycle, today)
  const turnaround = approvalTurnaroundDays(cycle)

  // The partner leg only exists where a partner actually reviews.
  const legs = LEGS.filter(l =>
    l.key !== 'partner_approved_at' || cadence.requiresPartnerApproval)

  return (
    <div className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2 min-w-[180px]">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: propertyColor(name) }} />
        <span className="text-sm font-medium text-slate-800">{name}</span>
      </div>

      <div className="text-xs text-slate-500 min-w-[120px]">
        Due {formatDate(cycle.due_date)}
        {late && (
          <span className="ml-1.5 text-red-600 font-medium">
            · {lateBy}d late
          </span>
        )}
      </div>

      <span className={cn('badge', STAGE_STYLES[stage])}>{STAGE_LABELS[stage]}</span>

      {cycle.source === 'sheet' && cycle.source_url && (
        <a href={cycle.source_url} target="_blank" rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline flex items-center gap-1">
          <ExternalLink size={11} />Sheet
        </a>
      )}

      {turnaround != null && (
        <span className="text-xs text-slate-400" title="Offers in hand → approval sent">
          {turnaround}d turnaround
        </span>
      )}

      {cycle.chase_task_id && late && (
        <Link href={`/tasks?task=${cycle.chase_task_id}`}
          className="text-xs text-amber-700 hover:underline flex items-center gap-1">
          <ListTodo size={11} />Chase task
        </Link>
      )}

      <div className="flex items-center gap-1.5 ml-auto flex-wrap">
        {legs.map(leg => {
          const value = cycle[leg.key]
          return value ? (
            <span key={leg.key}
              className="text-xs text-slate-600 flex items-center gap-1 border border-slate-200 rounded-full pl-2 pr-1 py-0.5">
              <Check size={11} className="text-emerald-600" />
              {leg.label} {formatDate(value)}
              <button onClick={() => onSetLeg(cycle, leg.key, null)}
                title={`Undo — ${leg.label.toLowerCase()} was not actually recorded`}
                className="text-slate-300 hover:text-slate-600 p-0.5">
                <RotateCcw size={10} />
              </button>
            </span>
          ) : (
            <button key={leg.key} onClick={() => onSetLeg(cycle, leg.key, today)}
              className="btn-secondary text-xs py-1">
              {leg.verb}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Per-property cadence ─────────────────────────────────────

function CadencePanel({ properties, cadenceFor, onSave }: {
  properties: PropertyRow[]
  cadenceFor: (propertyId: string) => CadenceConfig
  onSave: (propertyId: string, patch: Partial<RenewalSetting>) => void
}) {
  return (
    <div className="card p-4 space-y-3">
      <div>
        <h2 className="section-title mb-0">Cadence</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          How far ahead offers are due, and who else has to approve. Changes apply to
          cycles generated from here on — past due dates stay as they were.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead className="bg-slate-50 border-b border-slate-200/70">
            <tr>
              {['Property', 'Tracked', 'Lead days', 'Partner approval', 'Source', 'Sheet URL'].map(h => (
                <th key={h} className="text-left px-3 py-2 text-xs font-medium text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70">
            {properties.map(p => {
              const c = cadenceFor(p.id)
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium text-slate-700">{p.name}</td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={c.enabled}
                      onChange={e => onSave(p.id, { enabled: e.target.checked })}
                      aria-label={`Track renewals for ${p.name}`} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={1} max={365} defaultValue={c.leadDays}
                      onBlur={e => {
                        const v = parseInt(e.target.value, 10)
                        if (Number.isFinite(v) && v >= 1 && v <= 365 && v !== c.leadDays) {
                          onSave(p.id, { lead_days: v })
                        } else {
                          e.target.value = String(c.leadDays)
                        }
                      }}
                      className="input-sm w-20" aria-label={`Lead days for ${p.name}`} />
                  </td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={c.requiresPartnerApproval}
                      onChange={e => onSave(p.id, { requires_partner_approval: e.target.checked })}
                      aria-label={`Partner approval for ${p.name}`} />
                  </td>
                  <td className="px-3 py-2">
                    <select value={c.source}
                      onChange={e => onSave(p.id, { source: e.target.value as 'email' | 'sheet' })}
                      className="input-sm" aria-label={`Source for ${p.name}`}>
                      <option value="email">Email</option>
                      <option value="sheet">Shared sheet</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {c.source === 'sheet' ? (
                      <input type="url" defaultValue={c.sourceUrl ?? ''}
                        placeholder="https://docs.google.com/…"
                        onBlur={e => {
                          const v = e.target.value.trim()
                          if (v !== (c.sourceUrl ?? '')) onSave(p.id, { source_url: v || null })
                        }}
                        className="input-sm w-full min-w-[200px]" aria-label={`Sheet URL for ${p.name}`} />
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        Default is {DEFAULT_LEAD_DAYS} days — offers for a month are due {DEFAULT_LEAD_DAYS} days before
        that month begins (e.g. October offers due {formatDate(cycleDueDate('2026-10-01', DEFAULT_LEAD_DAYS))}).
      </p>
    </div>
  )
}
