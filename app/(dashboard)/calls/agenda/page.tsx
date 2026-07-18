'use client'

// Pre-call agenda for a PMC check-in: DETERMINISTIC data assembled from
// app state, grouped per property — what the PM owes (waiting tasks with
// aging, last call's unresolved items), what's coming due (obligations
// ≤60d), open inspection follow-ups, and overdue tasks. Printable, one
// click to copy as markdown, and an OPT-IN "Polish with AI" pass that
// rewrites (never extends) the same data as a narrative agenda.

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { CallItem, Task } from '@/lib/supabase/types'
import { cn, formatDate, formatDateShort, todayISO } from '@/lib/utils'
import { CALL_ITEM_KIND_LABELS, CALL_ITEM_KIND_STYLES } from '@/lib/calls/ui'
import { OBLIGATION_SOURCES } from '@/lib/tasks/vocab'
import { toast } from '@/components/ui/toast'
import {
  ArrowLeft, AlertTriangle, RotateCcw, Copy, Sparkles, Printer, CalendarClock,
} from 'lucide-react'

const OPEN_STATUSES: Task['status'][] = ['inbox', 'next_action', 'waiting', 'blocked']

type PropertyRef = { id: string; name: string }
type FindingRef = { id: string; item_label: string; section_name: string; property_id: string; inspection_date: string }

type AgendaData = {
  pmcName: string
  properties: PropertyRef[]
  waiting: Task[]
  lastCall: { id: string; title: string; call_date: string } | null
  lastCallItems: CallItem[]
  obligations: Task[]
  findings: FindingRef[]
  overdue: Task[]
}

type PerProperty = {
  property: PropertyRef
  waiting: Task[]
  lastCallItems: CallItem[]
  obligations: Task[]
  findings: FindingRef[]
  overdue: Task[]
}

function agingDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))
}

function overdueDays(due: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(due + 'T00:00:00').getTime()) / 86400000))
}

export default function AgendaPage() {
  // useSearchParams requires a Suspense boundary for the build's static
  // pass — the shell renders instantly, the reader hydrates inside it.
  return (
    <Suspense fallback={<div className="p-6 text-center text-sm text-slate-400">Loading…</div>}>
      <AgendaContent />
    </Suspense>
  )
}

function AgendaContent() {
  const searchParams = useSearchParams()
  const pmcId = searchParams.get('pmc')
  const supabase = createClient()

  const [data, setData] = useState<AgendaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [polished, setPolished] = useState<string | null>(null)
  const [polishing, setPolishing] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!pmcId) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const today = todayISO()
        const in60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)

        const [{ data: pmc, error: pmcError }, { data: props, error: propError }] = await Promise.all([
          supabase.from('pmcs').select('name').eq('id', pmcId).single(),
          supabase.from('properties').select('id, name').eq('pmc_id', pmcId).order('name'),
        ])
        if (pmcError) throw pmcError
        if (propError) throw propError
        const properties = (props ?? []) as PropertyRef[]
        const propertyIds = properties.map(p => p.id)

        let waiting: Task[] = []
        let obligations: Task[] = []
        let overdue: Task[] = []
        let findings: FindingRef[] = []
        if (propertyIds.length > 0) {
          const [waitingRes, obligationsRes, overdueRes, findingsRes] = await Promise.all([
            supabase.from('tasks').select('*')
              .in('property_id', propertyIds).eq('status', 'waiting')
              .order('updated_at', { ascending: true }),
            supabase.from('tasks').select('*')
              .in('property_id', propertyIds)
              .in('auto_source', OBLIGATION_SOURCES)
              .in('status', OPEN_STATUSES)
              .lte('due_date', in60)
              .order('due_date', { ascending: true }),
            supabase.from('tasks').select('*')
              .in('property_id', propertyIds)
              .in('status', OPEN_STATUSES)
              .lt('due_date', today)
              .order('due_date', { ascending: true }),
            supabase.from('inspection_items')
              .select('id, item_label, section_name, task_id, inspections!inner(property_id, inspection_date)')
              .eq('requires_action', true)
              .in('inspections.property_id', propertyIds),
          ])
          if (waitingRes.error) throw waitingRes.error
          if (obligationsRes.error) throw obligationsRes.error
          if (overdueRes.error) throw overdueRes.error
          if (findingsRes.error) throw findingsRes.error
          waiting = (waitingRes.data ?? []) as Task[]
          obligations = (obligationsRes.data ?? []) as Task[]
          overdue = (overdueRes.data ?? []) as Task[]

          // A finding stays on the agenda while it's not yet tasked OR its
          // task is still open — resolved (done-task) findings drop off.
          const rawFindings = (findingsRes.data ?? []) as unknown as {
            id: string; item_label: string; section_name: string; task_id: string | null
            inspections: { property_id: string; inspection_date: string }
          }[]
          const taskIds = rawFindings.map(f => f.task_id).filter((v): v is string => !!v)
          const doneTaskIds = new Set<string>()
          if (taskIds.length > 0) {
            const { data: taskRows } = await supabase.from('tasks')
              .select('id, status').in('id', taskIds)
            for (const t of taskRows ?? []) if (t.status === 'done') doneTaskIds.add(t.id)
          }
          findings = rawFindings
            .filter(f => !f.task_id || !doneTaskIds.has(f.task_id))
            .map(f => ({
              id: f.id, item_label: f.item_label, section_name: f.section_name,
              property_id: f.inspections.property_id,
              inspection_date: f.inspections.inspection_date,
            }))
        }

        // Last processed call for this PMC + its unresolved items.
        const { data: lastCalls } = await supabase.from('calls')
          .select('id, title, call_date')
          .eq('pmc_id', pmcId).eq('status', 'processed')
          .order('call_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
        const lastCall = lastCalls?.[0] ?? null
        let lastCallItems: CallItem[] = []
        if (lastCall) {
          const { data: itemRows } = await supabase.from('call_items')
            .select('*').eq('call_id', lastCall.id).eq('resolved', false)
            .order('sort_order')
          lastCallItems = (itemRows ?? []) as CallItem[]
        }

        if (cancelled) return
        setData({
          pmcName: pmc?.name ?? 'PMC',
          properties, waiting, lastCall, lastCallItems, obligations, findings, overdue,
        })
        setFetchError(null)
        setLoading(false)
      } catch (err: any) {
        if (cancelled) return
        setFetchError(err.message ?? 'Could not load agenda data')
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pmcId, reloadTick])

  // Group everything per property; a "Portfolio / unassigned" bucket
  // carries last-call items without a property.
  const perProperty: PerProperty[] = useMemo(() => {
    if (!data) return []
    // Waiting tasks double as overdue when their date passed — keep them
    // in Waiting (with aging) and out of Overdue to avoid double rows.
    const waitingIds = new Set(data.waiting.map(t => t.id))
    const obligationIds = new Set(data.obligations.map(t => t.id))
    const overdue = data.overdue.filter(t => !waitingIds.has(t.id) && !obligationIds.has(t.id))
    return data.properties.map(property => ({
      property,
      waiting: data.waiting.filter(t => t.property_id === property.id),
      lastCallItems: data.lastCallItems.filter(i => i.property_id === property.id),
      obligations: data.obligations.filter(t => t.property_id === property.id),
      findings: data.findings.filter(f => f.property_id === property.id),
      overdue: overdue.filter(t => t.property_id === property.id),
    }))
  }, [data])

  const unassignedLastCallItems = useMemo(() => {
    if (!data) return []
    const propIds = new Set(data.properties.map(p => p.id))
    return data.lastCallItems.filter(i => !i.property_id || !propIds.has(i.property_id))
  }, [data])

  // ── Markdown build (drives both Copy and the AI polish input) ──

  const markdown = useMemo(() => {
    if (!data) return ''
    const lines: string[] = []
    lines.push(`# PM check-in agenda — ${data.pmcName} — ${formatDate(todayISO())}`)
    if (data.lastCall) {
      lines.push(`_Carry-over from last call: ${data.lastCall.title || 'PM check-in'} (${formatDate(data.lastCall.call_date)})_`)
    }
    const section = (title: string, rows: string[]) => {
      if (rows.length === 0) return
      lines.push('', `### ${title}`, ...rows)
    }
    for (const p of perProperty) {
      const empty = p.waiting.length + p.lastCallItems.length + p.obligations.length +
        p.findings.length + p.overdue.length === 0
      lines.push('', `## ${p.property.name}`)
      if (empty) { lines.push('- Nothing outstanding'); continue }
      section('Waiting on PM', p.waiting.map(t =>
        `- ${t.title} — waiting ${agingDays(t.updated_at)}d${t.due_date ? ` (due ${formatDateShort(t.due_date)})` : ''}`))
      section('Unresolved from last call', p.lastCallItems.map(i =>
        `- [${CALL_ITEM_KIND_LABELS[i.kind]}] ${i.description}${i.owner ? ` (${i.owner})` : ''}`))
      section('Deadlines ≤60 days', p.obligations.map(t =>
        `- ${t.title} — due ${formatDateShort(t.due_date)}`))
      section('Open inspection findings', p.findings.map(f =>
        `- ${f.item_label} (${f.section_name}, inspected ${formatDateShort(f.inspection_date)})`))
      section('Overdue tasks', p.overdue.map(t =>
        `- ${t.title} — due ${formatDateShort(t.due_date)} (${overdueDays(t.due_date!)}d overdue)`))
    }
    if (unassignedLastCallItems.length > 0) {
      lines.push('', '## Portfolio / unassigned')
      for (const i of unassignedLastCallItems) {
        lines.push(`- [${CALL_ITEM_KIND_LABELS[i.kind]}] ${i.description}${i.owner ? ` (${i.owner})` : ''}`)
      }
    }
    return lines.join('\n')
  }, [data, perProperty, unassignedLastCallItems])

  async function copyAgenda() {
    const text = polished ?? markdown
    try {
      await navigator.clipboard.writeText(text)
      toast('Agenda copied to clipboard')
    } catch {
      toast('Could not copy — clipboard unavailable', { tone: 'error' })
    }
  }

  async function polish() {
    if (!data || polishing) return
    setPolishing(true)
    try {
      const res = await fetch('/api/calls/agenda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agenda: markdown, pmc_name: data.pmcName }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.text) {
        toast(`Polish failed — ${body?.error ?? `HTTP ${res.status}`}`, { tone: 'error' })
      } else {
        setPolished(body.text)
      }
    } catch (err: any) {
      toast(`Polish failed — ${err.message}`, { tone: 'error' })
    }
    setPolishing(false)
  }

  // ── Render ─────────────────────────────────────────────────

  if (!pmcId) return (
    <div className="p-6 max-w-3xl mx-auto text-center space-y-3 py-16">
      <p className="text-sm text-slate-500">No PMC selected.</p>
      <Link href="/calls" className="btn-secondary inline-flex"><ArrowLeft size={14} />Back to Calls</Link>
    </div>
  )
  if (loading) return <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
  if (fetchError || !data) return (
    <div className="p-6 max-w-3xl mx-auto text-center space-y-3 py-16">
      <p className="text-sm text-red-600 flex items-center justify-center gap-1.5">
        <AlertTriangle size={14} />Could not load agenda — {fetchError}
      </p>
      <button onClick={() => { setLoading(true); setFetchError(null); setReloadTick(t => t + 1) }}
        className="btn-secondary"><RotateCcw size={14} />Retry</button>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 print:p-0">
      {/* Header — controls hidden in print */}
      <div className="print:hidden">
        <Link href="/calls" className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={12} />Calls
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <CalendarClock size={20} className="text-slate-400" />
              Agenda — {data.pmcName}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">{formatDate(todayISO())} · assembled from live app data</p>
          </div>
          <div className="flex items-center gap-2">
            {polished === null ? (
              <button onClick={polish} disabled={polishing} className="btn-secondary">
                <Sparkles size={14} />{polishing ? 'Polishing…' : 'Polish with AI'}
              </button>
            ) : (
              <button onClick={() => setPolished(null)} className="btn-secondary">
                <RotateCcw size={14} />Data view
              </button>
            )}
            <button onClick={() => window.print()} className="btn-secondary">
              <Printer size={14} />Print
            </button>
            <button onClick={copyAgenda} className="btn-primary">
              <Copy size={14} />Copy agenda
            </button>
          </div>
        </div>
      </div>

      {/* Print title */}
      <div className="hidden print:block">
        <h1 className="text-lg font-bold">PM check-in agenda — {data.pmcName} — {formatDate(todayISO())}</h1>
      </div>

      {polished !== null ? (
        <div className="card p-5">
          <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">{polished}</pre>
        </div>
      ) : perProperty.length === 0 ? (
        <div className="card p-6 text-center text-sm text-slate-400 italic">
          This PMC has no properties assigned yet.
        </div>
      ) : (
        <div className="space-y-4">
          {perProperty.map(p => (
            <PropertyAgendaCard key={p.property.id} data={p} />
          ))}
          {unassignedLastCallItems.length > 0 && (
            <div className="card p-4 space-y-2">
              <h2 className="text-sm font-semibold text-slate-800">Portfolio / unassigned</h2>
              <ul className="space-y-1">
                {unassignedLastCallItems.map(i => <LastCallItemRow key={i.id} item={i} />)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Per-property card ────────────────────────────────────────

function PropertyAgendaCard({ data }: { data: PerProperty }) {
  const empty = data.waiting.length + data.lastCallItems.length + data.obligations.length +
    data.findings.length + data.overdue.length === 0
  return (
    <div className="card p-4 space-y-3 print:break-inside-avoid">
      <h2 className="text-sm font-semibold text-slate-800">{data.property.name}</h2>
      {empty ? (
        <p className="text-xs text-slate-400 italic">Nothing outstanding</p>
      ) : (
        <>
          <AgendaSection title="Waiting on PM" show={data.waiting.length > 0}>
            {data.waiting.map(t => (
              <li key={t.id} className="text-sm text-slate-700 flex items-baseline gap-2">
                <span className="badge text-purple-700 bg-purple-50 border-purple-200 flex-shrink-0">
                  {agingDays(t.updated_at)}d
                </span>
                <span>{t.title}{t.due_date && <span className="text-xs text-slate-400"> · due {formatDateShort(t.due_date)}</span>}</span>
              </li>
            ))}
          </AgendaSection>
          <AgendaSection title="Unresolved from last call" show={data.lastCallItems.length > 0}>
            {data.lastCallItems.map(i => <LastCallItemRow key={i.id} item={i} />)}
          </AgendaSection>
          <AgendaSection title="Deadlines ≤60 days" show={data.obligations.length > 0}>
            {data.obligations.map(t => (
              <li key={t.id} className="text-sm text-slate-700">
                {t.title} <span className="text-xs text-amber-600">due {formatDateShort(t.due_date)}</span>
              </li>
            ))}
          </AgendaSection>
          <AgendaSection title="Open inspection findings" show={data.findings.length > 0}>
            {data.findings.map(f => (
              <li key={f.id} className="text-sm text-slate-700">
                {f.item_label} <span className="text-xs text-slate-400">({f.section_name}, inspected {formatDateShort(f.inspection_date)})</span>
              </li>
            ))}
          </AgendaSection>
          <AgendaSection title="Overdue tasks" show={data.overdue.length > 0}>
            {data.overdue.map(t => (
              <li key={t.id} className="text-sm text-slate-700">
                {t.title} <span className="text-xs text-red-600">due {formatDateShort(t.due_date)} · {overdueDays(t.due_date!)}d overdue</span>
              </li>
            ))}
          </AgendaSection>
        </>
      )}
    </div>
  )
}

function AgendaSection({ title, show, children }: {
  title: string
  show: boolean
  children: React.ReactNode
}) {
  if (!show) return null
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{title}</h3>
      <ul className="space-y-1">{children}</ul>
    </div>
  )
}

function LastCallItemRow({ item }: { item: CallItem }) {
  return (
    <li className="text-sm text-slate-700 flex items-baseline gap-2">
      <span className={cn('badge flex-shrink-0', CALL_ITEM_KIND_STYLES[item.kind])}>
        {CALL_ITEM_KIND_LABELS[item.kind]}
      </span>
      <span>
        {item.description}
        {item.owner && <span className="text-xs text-slate-400"> · {item.owner === 'pm' ? 'PM' : 'Owner'}</span>}
      </span>
    </li>
  )
}
