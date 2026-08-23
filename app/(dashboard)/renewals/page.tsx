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
  monthLabel, monthStart, addMonths, cycleDueDate, DEFAULT_LEAD_DAYS,
  closedMonths, portfolioRate, shortMonth,
  FETCH_FLOOR_MONTHS, STAGE_LABELS, STAGE_STYLES, type CadenceConfig,
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
  const [showHistory, setShowHistory] = useState(false)
  const [schemaGap, setSchemaGap] = useState<{ code?: string | null; message?: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = todayISO()

  const fetchAll = useCallback(async () => {
    // Bounded: a cycle more than a year past its month is history the
    // board doesn't render (FETCH_FLOOR_MONTHS, shared with the sync).
    const floor = addMonths(monthStart(todayISO()), -FETCH_FLOOR_MONTHS)
    const [cyclesRes, settingsRes, propsRes] = await Promise.all([
      supabase.from('renewal_cycles').select('*')
        .gte('expiration_month', floor)
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
    // Settings/properties failures must NOT render a half-true board: a
    // missing settings table would silently drop Fox Hill's partner leg
    // and read every approved cycle as complete. Fail loud instead.
    const sideError = settingsRes.error ?? propsRes.error
    if (sideError) {
      setSchemaGap(isSchemaGapError(sideError) ? sideError : null)
      if (!isSchemaGapError(sideError)) setError(sideError.message)
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

  // A parked property ("Tracked" off) leaves the working board entirely —
  // its history stays in the table, but stale cycles must not inflate the
  // overdue count for a property the sync deliberately ignores.
  const activeCycles = useMemo(
    () => cycles.filter(c => cadenceFor(c.property_id).enabled && propertyName.has(c.property_id)),
    [cycles, cadenceFor, propertyName])

  // Grouped by expiration month. Current + upcoming months render first,
  // ascending — the board reads as a forward calendar. Past months sink
  // into a History section below, newest first, so a year of completed
  // cycles never buries the actionable ones.
  const { months, history } = useMemo(() => {
    const byMonth = new Map<string, RenewalCycle[]>()
    for (const c of activeCycles) {
      const list = byMonth.get(c.expiration_month) ?? []
      list.push(c)
      byMonth.set(c.expiration_month, list)
    }
    const entries = Array.from(byMonth.entries()).map(([month, rows]) => ({
      month,
      rows: rows.sort((a, b) =>
        (propertyName.get(a.property_id) ?? '').localeCompare(propertyName.get(b.property_id) ?? '')),
    }))
    const current = monthStart(today)
    return {
      months: entries.filter(e => e.month >= current)
        .sort((a, b) => a.month.localeCompare(b.month)),
      history: entries.filter(e => e.month < current)
        .sort((a, b) => b.month.localeCompare(a.month)),
    }
  }, [activeCycles, propertyName, today])

  const overdue = useMemo(
    () => activeCycles.filter(c => isOverdue(c, today)), [activeCycles, today])

  const awaitingUs = useMemo(
    () => activeCycles.filter(c => cycleStage(c, false) === 'awaiting_approval'), [activeCycles])

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
      return
    }
    // The chase task's world just changed — reconcile now rather than at
    // the 7:00 UTC cron, or a resolved chase sits open on the agenda all
    // day (and an undone one stays closed). Quiet best-effort: the write
    // above already succeeded, and the nightly run catches any miss.
    if (leg === 'offer_received_at' || leg === 'approved_at') {
      fetch(`/api/renewals/sync?today=${todayISO()}`)
        .then(res => res.ok ? fetchAll() : undefined)
        .catch(() => { /* nightly cron reconciles */ })
    }
  }

  async function sync() {
    setSyncing(true)
    setError(null)
    try {
      // The board's local date rides along so an evening manual sync
      // agrees with the screen (the server clock is UTC).
      const res = await fetch(`/api/renewals/sync?today=${todayISO()}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        const base = json.error ?? `Sync failed (${res.status})`
        throw new Error(json.detail ? `${base} — ${json.detail}` : base)
      }
      const bits = [
        json.cyclesCreated ? `${json.cyclesCreated} cycle${json.cyclesCreated === 1 ? '' : 's'} added` : null,
        json.chasesCreated ? `${json.chasesCreated} review task${json.chasesCreated === 1 ? '' : 's'} created` : null,
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

  // Rate entry writes onto the cycle row (the property × month grain the
  // rate lives at). A month with no row yet — history before the seed —
  // gets one created on the fly, due date computed from today's cadence.
  async function saveRate(propertyId: string, month: string, rate: number | null) {
    const cycle = cycles.find(c => c.property_id === propertyId && c.expiration_month === month)
    const previous = cycle?.renewal_rate ?? null
    if (cycle) {
      setCycles(prev => prev.map(c => c.id === cycle.id ? { ...c, renewal_rate: rate } : c))
    }
    // due_date/source are the existing row's values on conflict (written
    // back unchanged) and cadence-computed only for a brand-new row.
    const cadence = cadenceFor(propertyId)
    const { error: upsertError } = await supabase.from('renewal_cycles')
      .upsert({
        property_id: propertyId,
        expiration_month: month,
        due_date: cycle?.due_date ?? cycleDueDate(month, cadence.leadDays),
        source: cycle?.source ?? cadence.source,
        source_url: cycle?.source_url ?? cadence.sourceUrl,
        renewal_rate: rate,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'property_id,expiration_month' })
    if (upsertError) {
      if (cycle) {
        setCycles(prev => prev.map(c => c.id === cycle.id ? { ...c, renewal_rate: previous } : c))
      }
      toast(`Couldn't save rate — ${upsertError.message}`, { tone: 'error' })
      return
    }
    if (!cycle) fetchAll() // pick up the freshly created row
    // Entering a rate settles its entry task — reconcile now, not at 7am.
    fetch(`/api/renewals/sync?today=${todayISO()}`).catch(() => { /* nightly cron reconciles */ })
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
        <SummaryCard label="Overdue from PMs" cycles={overdue} tone="red" propertyName={propertyName} />
        <SummaryCard label="Waiting on your approval" cycles={awaitingUs} tone="blue" propertyName={propertyName} />
      </div>

      {showCadence && (
        <CadencePanel
          properties={properties}
          cadenceFor={cadenceFor}
          onSave={saveCadence}
        />
      )}

      {/* Monthly renewal rates — hand-entered per property once a month
          closes. The current month is deliberately absent: its outcomes
          are still accumulating and a partial rate reads as a bad one. */}
      {!loading && (
        <RateMatrix
          properties={properties.filter(p => cadenceFor(p.id).enabled)}
          cycles={cycles}
          today={today}
          onSave={saveRate}
        />
      )}

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0" />{error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : months.length === 0 && history.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={28} />}
          title="No renewal cycles yet"
          hint="Sync now generates the next six months for every active property."
          action={<button onClick={sync} className="btn-primary"><RefreshCw size={14} />Sync now</button>}
        />
      ) : (
        <>
          {months.map(({ month, rows }) => (
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
          ))}

          {/* Past months sink below the working calendar, newest first,
              behind a toggle — a year of history must never bury the
              actionable months. Overdue past cycles still count in the
              red card above either way. */}
          {history.length > 0 && (
            <section className="space-y-2">
              <button onClick={() => setShowHistory(v => !v)}
                className="section-title flex items-center gap-1.5 hover:text-slate-900">
                {showHistory ? 'Hide' : 'Show'} past months ({history.length})
              </button>
              {showHistory && history.map(({ month, rows }) => (
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
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}

// ── Renewal-rate matrix ──────────────────────────────────────
// Month-by-month table, one row per property: % of leases expiring that
// month that renewed. Entered by hand (the sync opens a per-property
// entry task when a month closes); the portfolio row is a simple mean —
// unit-weighting needs the rent-roll counts that phase 2 will carry.

const RATE_MONTHS_SHOWN = 12

function RateMatrix({ properties, cycles, today, onSave }: {
  properties: PropertyRow[]
  cycles: RenewalCycle[]
  today: string
  onSave: (propertyId: string, month: string, rate: number | null) => void
}) {
  const months = useMemo(() => closedMonths(today, RATE_MONTHS_SHOWN), [today])
  const rateByKey = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const c of cycles) map.set(`${c.property_id}|${c.expiration_month}`, c.renewal_rate)
    return map
  }, [cycles])

  if (properties.length === 0) return null

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h2 className="section-title mb-0">Renewal rates</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Share of expiring leases that renewed, by expiration month. Click a cell to enter.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-slate-50 border-b border-slate-200/70">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Property</th>
              {months.map(m => (
                <th key={m} className="text-right px-2 py-2 text-xs font-medium text-slate-500 whitespace-nowrap">
                  {shortMonth(m)}
                  {/* Year only where it changes — January or the first column */}
                  {(m.endsWith('-01-01') || m === months[0]) && (
                    <span className="text-slate-400 font-normal"> ’{m.slice(2, 4)}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70">
            {properties.map(p => (
              <tr key={p.id}>
                <td className="px-3 py-1.5 font-medium text-slate-700 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full inline-block mr-1.5" style={{ background: propertyColor(p.name) }} />
                  {p.name}
                </td>
                {months.map(m => (
                  <td key={m} className="px-2 py-1.5 text-right">
                    <RateCell
                      value={rateByKey.get(`${p.id}|${m}`) ?? null}
                      onSave={rate => onSave(p.id, m, rate)}
                    />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-slate-50/60">
              <td className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Portfolio</td>
              {months.map(m => {
                const avg = portfolioRate(properties.map(p => rateByKey.get(`${p.id}|${m}`) ?? null))
                return (
                  <td key={m} className="px-2 py-1.5 text-right text-slate-600 font-medium">
                    {avg != null ? `${avg}%` : <span className="text-slate-300">—</span>}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// One editable percent cell. Click to edit; Enter/blur saves; Escape
// cancels; clearing the input clears the stored rate.
function RateCell({ value, onSave }: {
  value: number | null
  onSave: (rate: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (value != null) onSave(null)
      return
    }
    const n = Math.round(Number(trimmed))
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      toast('Rate must be 0–100', { tone: 'error' })
      return
    }
    if (n !== value) onSave(n)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number" min={0} max={100}
        defaultValue={value ?? ''}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { setDraft(String(value ?? '')); setEditing(false) }
        }}
        className="input-sm w-14 text-right"
        aria-label="Renewal rate percent"
      />
    )
  }
  return (
    <button type="button"
      onClick={() => { setDraft(String(value ?? '')); setEditing(true) }}
      className={cn('px-1 py-0.5 rounded hover:bg-slate-100 min-w-[2.5rem] text-right',
        value != null ? 'text-slate-800' : 'text-slate-300')}>
      {value != null ? `${value}%` : '—'}
    </button>
  )
}

// ── Summary card ─────────────────────────────────────────────

const SUMMARY_TONES = {
  red: { card: 'border-red-200 bg-red-50/40', number: 'text-red-700', list: 'text-red-700' },
  blue: { card: 'border-blue-200 bg-blue-50/40', number: 'text-blue-700', list: 'text-blue-700' },
} as const

function SummaryCard({ label, cycles, tone, propertyName }: {
  label: string
  cycles: RenewalCycle[]
  tone: keyof typeof SUMMARY_TONES
  propertyName: Map<string, string>
}) {
  const tones = SUMMARY_TONES[tone]
  return (
    <div className={cn('card px-4 py-3', cycles.length > 0 && tones.card)}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn('text-2xl font-bold', cycles.length > 0 ? tones.number : 'text-slate-900')}>
        {cycles.length}
      </p>
      {cycles.length > 0 && (
        <p className={cn('text-xs mt-0.5', tones.list)}>
          {Array.from(new Set(cycles.map(c => propertyName.get(c.property_id))))
            .filter(Boolean).join(', ')}
        </p>
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

      {/* ?property= is the filter the tasks page actually reads — it
          lands on the All view scoped to this property, review task on
          top (it's overdue by definition). */}
      {cycle.chase_task_id && late && (
        <Link href={`/tasks?property=${cycle.property_id}`}
          className="text-xs text-amber-700 hover:underline flex items-center gap-1">
          <ListTodo size={11} />Review task
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
          How far ahead offers are due, and who else has to approve. Changes reach every
          cycle that hasn&apos;t started yet on the next sync — months already late or already
          in motion keep their dates, so history is never rewritten.
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
