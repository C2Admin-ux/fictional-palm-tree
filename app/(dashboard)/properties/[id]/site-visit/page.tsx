'use client'

// Site-visit sheet — Nick's ask (2026-08-30): hit one button before a
// property visit, get one internal working page for it. Everything
// discussion-worthy in one place, in walking order:
//   · due tasks — the live TaskRow affordances (complete/snooze/
//     postpone/edit), Later + No-date collapsed behind counts
//   · every unsettled finding, grouped section/unit like a walk — the
//     triage verbs here write the REAL records (and invalidate stale
//     inspection reports, same rule as everywhere else)
//   · capex in flight (eyeball the work, discuss the bids)
//   · what the PM owes us (renewal offers, waiting-on tasks, open call
//     items)
//   · litigation deadlines
// plus scratch-note boxes (site_visit_notes, migration 0019) for the
// observations that aren't tasks or findings yet. Notes key on the
// LOCAL visit date, so each visit starts fresh and past visits stay
// readable at the bottom.
//
// Internal by design — nothing on this page is emailed or PM-facing.
// It absorbs the old walk-sheet page: Print hides the interactive
// chrome and renders checkbox rows + the notes as text.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  cn, formatCurrency, formatDate, todayISO, addDaysToDate, daysBetween,
  PRIORITY_DOT, CAPEX_STATUS_LABELS, CAPEX_STATUS_STYLES,
} from '@/lib/utils'
import { instanceLabel } from '@/lib/inspections/sections'
import {
  DISPOSITION_LABELS, UNSETTLED_DISPOSITIONS, isSettled, normalizeDisposition,
  type Disposition,
} from '@/lib/inspections/dispositions'
import { invalidateInspectionReports } from '@/lib/inspections/invalidate'
import { DispositionChip } from '@/components/inspections/disposition-chip'
import { BidChip } from '@/components/capex/bid-chip'
import type { BidLike } from '@/lib/capex/bids'
import { NoteBox } from '@/components/site-visit/note-box'
import { toast } from '@/components/ui/toast'
import { SchemaGapNotice } from '@/components/ui/schema-gap-notice'
import { isSchemaGapError } from '@/lib/supabase/schema-errors'
import TasksTab from '../tasks-tab'
import { useSignedThumbs } from '../open-findings'
import {
  owedForReview, monthListLabel, daysLate, type ReviewableCycle,
} from '@/lib/renewals/cycles'
import { STATUS_META, TYPE_LABEL, daysUntilDate } from '@/app/(dashboard)/litigation/shared'
import type { LitigationCase, RenewalSetting } from '@/lib/supabase/types'
import {
  ArrowLeft, Printer, Camera, Check, ChevronDown, ClipboardCheck, Eye, Flag,
  HardHat, Phone, Scale, StickyNote,
} from 'lucide-react'

// ── Row shapes (lean client selects) ─────────────────────────

type VisitFinding = {
  id: string
  inspection_id: string
  inspection_date: string
  item_label: string
  section_name: string
  unit_number: string | null
  requires_action: boolean
  action_priority: string | null
  disposition: string
  disposition_note: string | null
  disposition_at: string | null
  communicated_at: string | null
  watch_count: number
  capex_project_id: string | null
  thumb_path: string | null
}

type VisitCapex = {
  id: string
  title: string
  status: string
  category: string | null
  priority: string
  budget: number | null
  vendor_name: string | null
  bids_target: number | null
  target_completion: string | null
  capex_bids: BidLike[] | null
}

type WaitingTask = {
  id: string
  title: string
  due_date: string | null
  updated_at: string
  contacts: string[]
}

type OpenCallItem = {
  id: string
  description: string
  kind: string
  call_date: string | null
}

type PrintTask = { id: string; title: string; priority: string; due_date: string }

type CycleRow = ReviewableCycle & { partner_approved_at: string | null }

// Section/unit walking order (carried over from the retired walk-sheet
// page): sections alphabetically, unitless instance first, units in
// natural order (2 before 10).
type FindingGroup = { key: string; label: string; rows: VisitFinding[] }
function groupFindings(rows: VisitFinding[]): FindingGroup[] {
  const map = new Map<string, FindingGroup>()
  for (const r of rows) {
    const key = `${r.section_name}|${r.unit_number ?? ''}`
    let g = map.get(key)
    if (!g) {
      g = { key, label: instanceLabel({ name: r.section_name, unit: r.unit_number }), rows: [] }
      map.set(key, g)
    }
    g.rows.push(r)
  }
  const collator = new Intl.Collator(undefined, { numeric: true })
  return Array.from(map.values()).sort((a, b) => collator.compare(a.label, b.label))
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
const CAPEX_ORDER: Record<string, number> = { in_progress: 0, approved: 1, planning: 2, on_hold: 3 }

const SECTION_NOTE_LABELS: Record<string, string> = {
  general: 'General',
  'section:tasks': 'Tasks',
  'section:findings': 'Findings',
  'section:capex': 'CapEx',
  'section:pm': 'PM / team',
  'section:litigation': 'Litigation',
}

export default function SiteVisitPage() {
  const params = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  // The visit date is the client's LOCAL day (the UTC-evening lesson from
  // the dashboard redesign) — fixed at mount so a walk crossing midnight
  // doesn't split its notes across two visits.
  const [visitDate] = useState(() => todayISO())

  const [loading, setLoading] = useState(true)
  const [propertyName, setPropertyName] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [findings, setFindings] = useState<VisitFinding[]>([])
  const [capex, setCapex] = useState<VisitCapex[]>([])
  const [waiting, setWaiting] = useState<WaitingTask[]>([])
  const [callItems, setCallItems] = useState<OpenCallItem[]>([])
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [renewalSetting, setRenewalSetting] = useState<RenewalSetting | null>(null)
  const [cases, setCases] = useState<LitigationCase[]>([])
  const [printTasks, setPrintTasks] = useState<PrintTask[]>([])
  const [todayNotes, setTodayNotes] = useState<Record<string, string>>({})
  const [pastNotes, setPastNotes] = useState<{ visit_date: string; scope: string; body: string }[]>([])
  const [notesError, setNotesError] = useState<{ code?: string | null; message?: string | null } | null>(null)
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({})
  const [pastOpen, setPastOpen] = useState(false)
  // Item-note boxes the user opened this session (boxes with saved text
  // are always shown).
  const [openNoteScopes, setOpenNoteScopes] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    async function fetchAll() {
      const dueCutoff = addDaysToDate(visitDate, 7)
      const [
        userRes, propRes, findingsRes, capexRes, waitingRes, callRes,
        cyclesRes, settingRes, casesRes, printTasksRes, notesRes,
      ] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('properties').select('name').eq('id', params.id).single(),
        supabase.from('inspection_items')
          .select('id, inspection_id, item_label, section_name, unit_number, requires_action, action_priority, disposition, disposition_note, disposition_at, communicated_at, watch_count, capex_project_id, photo_paths, inspections!inner(property_id, inspection_date)')
          .eq('inspections.property_id', params.id)
          .in('disposition', [...UNSETTLED_DISPOSITIONS]),
        supabase.from('capex_projects')
          .select('id, title, status, category, priority, budget, vendor_name, bids_target, target_completion, capex_bids(vendor_name, status, amount)')
          .eq('property_id', params.id)
          .in('status', ['planning', 'approved', 'in_progress', 'on_hold']),
        supabase.from('tasks')
          .select('id, title, due_date, updated_at, task_contacts(contact_id, contacts(full_name))')
          .eq('property_id', params.id).eq('status', 'waiting'),
        supabase.from('call_items')
          .select('id, description, kind, calls(call_date)')
          .eq('property_id', params.id).eq('resolved', false)
          .order('created_at', { ascending: false }).limit(8),
        supabase.from('renewal_cycles')
          .select('id, expiration_month, due_date, offer_received_at, approved_at, partner_approved_at')
          .eq('property_id', params.id),
        supabase.from('renewal_settings').select('*').eq('property_id', params.id).maybeSingle(),
        supabase.from('litigation_cases').select('*')
          .eq('property_id', params.id).neq('status', 'closed')
          .order('next_deadline', { ascending: true, nullsFirst: false }),
        // Print-only static due list — the interactive TasksTab owns its
        // own data and can't be asked for a paper rendering.
        supabase.from('tasks')
          .select('id, title, priority, due_date')
          .eq('property_id', params.id).neq('status', 'done').is('parent_task_id', null)
          .not('due_date', 'is', null).lte('due_date', dueCutoff)
          .order('due_date', { ascending: true }),
        supabase.from('site_visit_notes').select('visit_date, scope, body')
          .eq('property_id', params.id)
          .order('visit_date', { ascending: false }),
      ])
      if (cancelled) return

      setUserId(userRes.data.user?.id ?? null)
      if (propRes.error) {
        setSectionErrors(prev => ({ ...prev, property: propRes.error.message }))
      } else {
        setPropertyName(propRes.data?.name ?? null)
      }

      const errs: Record<string, string> = {}
      if (findingsRes.error) errs.findings = findingsRes.error.message
      if (capexRes.error) errs.capex = capexRes.error.message
      if (waitingRes.error || callRes.error || cyclesRes.error || settingRes.error) {
        errs.pm = (waitingRes.error ?? callRes.error ?? cyclesRes.error ?? settingRes.error)?.message ?? 'load failed'
      }
      if (casesRes.error) errs.litigation = casesRes.error.message
      setSectionErrors(prev => ({ ...prev, ...errs }))

      // Findings: flagged first, then priority, then oldest walk first —
      // the longest-outstanding item leads its group.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const findingRows = ((findingsRes.data ?? []) as any[]).map(r => ({
        id: r.id,
        inspection_id: r.inspection_id,
        inspection_date: r.inspections?.inspection_date ?? '',
        item_label: r.item_label,
        section_name: r.section_name,
        unit_number: r.unit_number,
        requires_action: r.requires_action,
        action_priority: r.action_priority,
        disposition: r.disposition,
        disposition_note: r.disposition_note,
        disposition_at: r.disposition_at,
        communicated_at: r.communicated_at,
        watch_count: r.watch_count ?? 0,
        capex_project_id: r.capex_project_id,
        thumb_path: Array.isArray(r.photo_paths) && r.photo_paths.length > 0 ? r.photo_paths[0] : null,
      } satisfies VisitFinding)).sort((a, b) =>
        (a.disposition === b.disposition ? 0 : a.disposition === 'flagged' ? -1 : b.disposition === 'flagged' ? 1 : 0) ||
        (PRIORITY_ORDER[a.action_priority ?? 'medium'] ?? 2) - (PRIORITY_ORDER[b.action_priority ?? 'medium'] ?? 2) ||
        a.inspection_date.localeCompare(b.inspection_date))
      setFindings(findingRows)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCapex(((capexRes.data ?? []) as any[])
        .sort((a, b) =>
          (CAPEX_ORDER[a.status] ?? 9) - (CAPEX_ORDER[b.status] ?? 9) ||
          (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2) ||
          String(a.title).localeCompare(String(b.title))) as VisitCapex[])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setWaiting(((waitingRes.data ?? []) as any[]).map(t => ({
        id: t.id,
        title: t.title,
        due_date: t.due_date,
        updated_at: t.updated_at,
        contacts: (t.task_contacts ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((tc: any) => tc.contacts?.full_name)
          .filter((n: unknown): n is string => Boolean(n)),
      })))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCallItems(((callRes.data ?? []) as any[]).map(ci => ({
        id: ci.id,
        description: ci.description,
        kind: ci.kind,
        call_date: ci.calls?.call_date ?? null,
      })))

      setCycles((cyclesRes.data ?? []) as CycleRow[])
      setRenewalSetting((settingRes.data ?? null) as RenewalSetting | null)
      setCases((casesRes.data ?? []) as LitigationCase[])
      setPrintTasks((printTasksRes.data ?? []) as PrintTask[])

      if (notesRes.error) {
        setNotesError(notesRes.error)
      } else {
        const today: Record<string, string> = {}
        const past: { visit_date: string; scope: string; body: string }[] = []
        for (const n of notesRes.data ?? []) {
          if (n.visit_date === visitDate) today[n.scope] = n.body
          else past.push(n)
        }
        setTodayNotes(today)
        setPastNotes(past)
      }
      setLoading(false)
    }
    void fetchAll()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id])

  const thumbs = useSignedThumbs(findings)
  const groups = useMemo(() => groupFindings(findings), [findings])

  // ── Finding triage (live writes, same rules as the triage UI) ──
  // The verb patch deliberately does NOT touch disposition_note — a note
  // written at desk triage survives an onsite "resolved". Any finding
  // change invalidates its inspection's stored report/photo sheet.
  const setDisposition = useCallback((f: VisitFinding, d: Disposition) => {
    const prior = {
      disposition: normalizeDisposition(f.disposition),
      disposition_at: f.disposition_at,
      communicated_at: f.communicated_at,
    }
    const patch = {
      disposition: d,
      disposition_at: new Date().toISOString(),
      // A fresh flag hasn't been communicated yet — same reset as triage.
      ...(d === 'flagged' ? { communicated_at: null } : {}),
    }
    setFindings(prev => prev.map(x => x.id === f.id ? { ...x, ...patch } : x))
    void (async () => {
      const { error } = await supabase.from('inspection_items').update(patch).eq('id', f.id)
      if (error) {
        setFindings(prev => prev.map(x => x.id === f.id ? { ...x, ...prior } : x))
        toast(`Couldn't update the finding — ${error.message}`, { tone: 'error' })
        return
      }
      void invalidateInspectionReports(supabase, [f.inspection_id])
      toast(`Marked ${DISPOSITION_LABELS[d].toLowerCase()}`, {
        action: {
          label: 'Undo',
          onClick: () => {
            setFindings(prev => prev.map(x => x.id === f.id ? { ...x, ...prior } : x))
            void supabase.from('inspection_items').update(prior).eq('id', f.id)
              .then(({ error: undoError }) => {
                if (undoError) toast(`Couldn't undo — ${undoError.message}`, { tone: 'error' })
                else void invalidateInspectionReports(supabase, [f.inspection_id])
              })
          },
        },
      })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Renewals summary ─────────────────────────────────────────
  const renewalsTracked = renewalSetting != null && renewalSetting.enabled
  const owed = useMemo(() => cycles.filter(c => owedForReview(c, visitDate)), [cycles, visitDate])
  const owedChase = owed.filter(c => !c.offer_received_at)
  const owedReview = owed.filter(c => c.offer_received_at != null)
  const maxDaysLate = owedChase.reduce((m, c) => Math.max(m, daysLate(c, visitDate)), 0)

  const hasPmContent = renewalsTracked || waiting.length > 0 || callItems.length > 0

  const noteScopeLabel = useCallback((scope: string): string => {
    if (SECTION_NOTE_LABELS[scope]) return SECTION_NOTE_LABELS[scope]
    if (scope.startsWith('finding:')) {
      const f = findings.find(x => `finding:${x.id}` === scope)
      return f ? `Finding — ${f.item_label || instanceLabel({ name: f.section_name, unit: f.unit_number })}` : 'Finding (since settled)'
    }
    if (scope.startsWith('capex:')) {
      const p = capex.find(x => `capex:${x.id}` === scope)
      return p ? `CapEx — ${p.title}` : 'CapEx project'
    }
    return scope
  }, [findings, capex])

  const pastByDate = useMemo(() => {
    const map = new Map<string, { scope: string; body: string }[]>()
    for (const n of pastNotes) {
      const list = map.get(n.visit_date) ?? []
      list.push(n)
      map.set(n.visit_date, list)
    }
    return Array.from(map.entries()) // already newest-first from the fetch
  }, [pastNotes])

  const noteBox = (scope: string, placeholder: string, className?: string) =>
    notesError == null ? (
      <NoteBox
        propertyId={params.id} visitDate={visitDate} scope={scope} userId={userId}
        initial={todayNotes[scope]} placeholder={placeholder} className={className} />
    ) : null

  const itemNote = (scope: string) => {
    if (notesError != null) return null
    const hasNote = (todayNotes[scope] ?? '').trim() !== ''
    if (!hasNote && !openNoteScopes.has(scope)) {
      return (
        <button
          onClick={() => setOpenNoteScopes(prev => new Set(prev).add(scope))}
          className="text-xs text-slate-400 hover:text-blue-600 flex items-center gap-1 print:hidden">
          <StickyNote size={11} />Note
        </button>
      )
    }
    return null
  }

  const itemNoteBox = (scope: string, placeholder: string) => {
    if (notesError != null) return null
    const show = (todayNotes[scope] ?? '').trim() !== '' || openNoteScopes.has(scope)
    if (!show) return null
    return noteBox(scope, placeholder, 'mt-2')
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <p className="text-sm text-slate-400">Loading the site-visit sheet…</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 print:p-0 print:max-w-none">
      {/* Screen-only toolbar */}
      <div className="flex items-center justify-between gap-2 mb-5 print:hidden">
        <Link href={`/properties/${params.id}`}
          className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1.5">
          <ArrowLeft size={14} />Back to property
        </Link>
        <button onClick={() => window.print()} className="btn-secondary text-xs py-1.5">
          <Printer size={13} />Print
        </button>
      </div>

      {sectionErrors.property && (
        <p className="text-sm text-red-600 print:hidden">
          Couldn&apos;t load the property — {sectionErrors.property}
        </p>
      )}

      {/* Sheet header */}
      <div className="border-b-2 border-slate-900 pb-3 mb-5">
        <h1 className="text-xl font-bold text-slate-900">
          {propertyName ?? 'Property'} — Site Visit
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {formatDate(visitDate)} · internal working sheet — nothing here is sent anywhere
        </p>
      </div>

      {notesError != null && (
        isSchemaGapError(notesError) ? (
          <SchemaGapNotice error={notesError} className="mb-5"
            detail="Scratch notes are hidden until migration 0019 runs — tasks and findings below still work." />
        ) : (
          <p className="text-sm text-red-600 mb-5">
            Couldn&apos;t load visit notes — {notesError.message}
          </p>
        )
      )}

      {/* General scratchpad */}
      {noteBox('general', 'Visit notes — anything to see, ask, or bring back to the team…', 'mb-6')}

      {/* ── Due tasks ─────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="section-title mb-2">Due tasks</h2>
        {noteBox('section:tasks', 'Task notes…', 'mb-3')}
        <div className="print:hidden">
          <TasksTab propertyId={params.id} focusDue />
        </div>
        {/* Print rendering: a static checkbox list of what's due */}
        <div className="hidden print:block">
          {printTasks.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No tasks due in the next 7 days.</p>
          ) : printTasks.map(t => (
            <div key={t.id} className="flex gap-3 py-1.5 border-b border-slate-200 break-inside-avoid">
              <div className="w-4 h-4 border-2 border-slate-700 rounded-sm flex-shrink-0 mt-0.5" />
              <p className="text-sm flex-1">{t.title}</p>
              <span className="text-xs text-slate-500">{formatDate(t.due_date)}</span>
              <span className="text-xs uppercase text-slate-500">{t.priority}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Findings ──────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="section-title mb-2">
          Open findings
          <span className="ml-2 font-normal text-slate-400">{findings.length}</span>
        </h2>
        {noteBox('section:findings', 'Findings notes…', 'mb-3')}
        {sectionErrors.findings && (
          <p className="text-sm text-red-600">Couldn&apos;t load findings — {sectionErrors.findings}</p>
        )}
        {!sectionErrors.findings && findings.length === 0 && (
          <p className="text-sm text-slate-400 italic">
            No unsettled findings for this property — nothing to walk.
          </p>
        )}
        {groups.map(g => (
          <div key={g.key} className="mb-4 break-inside-avoid-page">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600 border-b border-slate-300 pb-1 mb-1">
              {g.label}
              <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                {g.rows.length} item{g.rows.length === 1 ? '' : 's'}
              </span>
            </h3>
            {g.rows.map(f => {
              const settled = isSettled(f.disposition)
              const scope = `finding:${f.id}`
              const thumbUrl = f.thumb_path ? thumbs[f.thumb_path]?.url : undefined
              return (
                <div key={f.id}
                  className={cn('flex gap-3 py-2.5 border-b border-slate-200/70 break-inside-avoid',
                    settled && 'opacity-50')}>
                  {/* Print checkbox — the walk-sheet affordance lives on */}
                  <div className="hidden print:block w-4 h-4 border-2 border-slate-700 rounded-sm flex-shrink-0 mt-0.5" />
                  {thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbUrl} alt=""
                      className="w-9 h-9 rounded object-cover border border-slate-200 flex-shrink-0 print:hidden" />
                  ) : (
                    <div className="w-9 h-9 rounded bg-slate-100 flex items-center justify-center flex-shrink-0 print:hidden">
                      <Camera size={12} className="text-slate-300" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm leading-snug flex items-start gap-1.5',
                      f.item_label ? 'text-slate-700' : 'text-slate-300 italic',
                      settled && 'line-through decoration-slate-300')}>
                      {f.requires_action && (
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                          title={`Priority: ${f.action_priority ?? 'medium'}`}
                          style={{ background: PRIORITY_DOT[f.action_priority ?? 'medium'] ?? '#94a3b8' }} />
                      )}
                      <span>{f.item_label || 'No description'}</span>
                    </p>
                    {f.disposition_note && (
                      <p className="text-xs text-slate-500 mt-0.5">Note: {f.disposition_note}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <DispositionChip item={f} />
                      {normalizeDisposition(f.disposition) === 'watch' && f.watch_count > 0 && (
                        <span className="text-xs text-slate-500">{f.watch_count}× carried</span>
                      )}
                      <Link href={`/inspections/${f.inspection_id}`}
                        title="Open the source inspection"
                        className="text-xs text-slate-400 hover:text-blue-600 flex items-center gap-1 print:hidden">
                        <ClipboardCheck size={11} />{formatDate(f.inspection_date)}
                      </Link>
                      <span className="hidden print:inline text-xs text-slate-500">
                        noted {formatDate(f.inspection_date)}
                      </span>
                      {itemNote(scope)}
                    </div>
                    {itemNoteBox(scope, 'Onsite note for this finding…')}
                  </div>
                  {/* Triage verbs — live writes */}
                  {!settled && (
                    <div className="flex items-start gap-1 flex-shrink-0 print:hidden">
                      {normalizeDisposition(f.disposition) !== 'watch' && (
                        <button onClick={() => setDisposition(f, 'watch')} title="Watch"
                          className="p-1.5 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50">
                          <Eye size={14} />
                        </button>
                      )}
                      {normalizeDisposition(f.disposition) !== 'flagged' && (
                        <button onClick={() => setDisposition(f, 'flagged')} title="Flag for the PM"
                          className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50">
                          <Flag size={14} />
                        </button>
                      )}
                      <button onClick={() => setDisposition(f, 'resolved')} title="Resolved — verified onsite"
                        className="p-1.5 rounded text-slate-400 hover:text-emerald-600 hover:bg-emerald-50">
                        <Check size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </section>

      {/* ── CapEx in flight ───────────────────────────────────── */}
      {(capex.length > 0 || sectionErrors.capex) && (
        <section className="mb-8">
          <h2 className="section-title mb-2 flex items-center gap-1.5">
            <HardHat size={14} className="text-slate-400" />CapEx in flight
            <span className="font-normal text-slate-400">{capex.length}</span>
          </h2>
          {noteBox('section:capex', 'CapEx notes…', 'mb-3')}
          {sectionErrors.capex && (
            <p className="text-sm text-red-600">Couldn&apos;t load capex — {sectionErrors.capex}</p>
          )}
          {capex.map(p => {
            const scope = `capex:${p.id}`
            const overdueTarget = p.status !== 'complete' && p.target_completion != null && p.target_completion < visitDate
            return (
              <div key={p.id} className="py-2.5 border-b border-slate-200/70 break-inside-avoid">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="hidden print:block w-4 h-4 border-2 border-slate-700 rounded-sm flex-shrink-0" />
                  <Link href={`/capex/${p.id}`}
                    className="text-sm font-medium text-slate-700 hover:text-blue-600">
                    {p.title}
                  </Link>
                  <span className={cn('badge', CAPEX_STATUS_STYLES[p.status] ?? 'text-slate-600 bg-slate-50 border-slate-200')}>
                    {CAPEX_STATUS_LABELS[p.status] ?? p.status}
                  </span>
                  <BidChip bids={p.capex_bids} target={p.bids_target} />
                  {itemNote(scope)}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
                  {p.category && <span className="capitalize">{p.category}</span>}
                  {p.vendor_name && <span>{p.vendor_name}</span>}
                  {p.budget != null && <span>Budget {formatCurrency(p.budget)}</span>}
                  {p.target_completion && (
                    <span className={cn(overdueTarget && 'text-red-600 font-medium')}>
                      target {formatDate(p.target_completion)}{overdueTarget ? ' — past due' : ''}
                    </span>
                  )}
                </div>
                {itemNoteBox(scope, 'Onsite note for this project…')}
              </div>
            )
          })}
        </section>
      )}

      {/* ── PM / team discussion ──────────────────────────────── */}
      {(hasPmContent || sectionErrors.pm) && (
        <section className="mb-8">
          <h2 className="section-title mb-2 flex items-center gap-1.5">
            <Phone size={14} className="text-slate-400" />PM / team discussion
          </h2>
          {noteBox('section:pm', 'PM discussion notes…', 'mb-3')}
          {sectionErrors.pm && (
            <p className="text-sm text-red-600">Couldn&apos;t load PM items — {sectionErrors.pm}</p>
          )}

          {renewalsTracked && (
            <div className="py-2 border-b border-slate-200/70 text-sm">
              {owedChase.length > 0 && (
                <p className="text-red-700">
                  <span className="font-medium">
                    Renewal {renewalSetting?.source === 'sheet' ? 'sheet review' : 'offers'} owed by the PM:
                  </span>{' '}
                  {monthListLabel(owedChase.map(c => c.expiration_month))}
                  {maxDaysLate > 0 ? ` — ${maxDaysLate}d late` : ''}
                  {' '}<Link href="/renewals" className="text-blue-600 hover:underline text-xs">Renewals →</Link>
                </p>
              )}
              {owedReview.length > 0 && (
                <p className="text-blue-700">
                  <span className="font-medium">Offers in hand awaiting your approval:</span>{' '}
                  {monthListLabel(owedReview.map(c => c.expiration_month))}
                  {' '}<Link href="/renewals" className="text-blue-600 hover:underline text-xs">Renewals →</Link>
                </p>
              )}
              {owed.length === 0 && (
                <p className="text-emerald-700">Renewals current — nothing owed either way.</p>
              )}
            </div>
          )}

          {waiting.map(t => (
            <div key={t.id} className="flex items-center gap-2 py-2 border-b border-slate-200/70 flex-wrap">
              <div className="hidden print:block w-4 h-4 border-2 border-slate-700 rounded-sm flex-shrink-0" />
              <span className="text-sm text-slate-700 flex-1 min-w-0">{t.title}</span>
              {t.contacts.length > 0 && (
                <span className="text-xs text-slate-500">{t.contacts.join(', ')}</span>
              )}
              <span className="badge text-amber-700 bg-amber-50 border-amber-200"
                title="Days since this task last moved">
                waiting {daysBetween(t.updated_at.slice(0, 10), visitDate)}d
              </span>
              <Link href={`/tasks?task=${t.id}`}
                className="text-xs text-blue-600 hover:underline print:hidden">open</Link>
            </div>
          ))}

          {callItems.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">
                Open call items
              </p>
              {callItems.map(ci => (
                <div key={ci.id} className="flex items-baseline gap-2 py-1.5 border-b border-slate-200/70">
                  <span className="text-xs uppercase text-slate-400 flex-shrink-0 w-14">{ci.kind}</span>
                  <span className="text-sm text-slate-700 flex-1 min-w-0">{ci.description}</span>
                  {ci.call_date && (
                    <span className="text-xs text-slate-400 flex-shrink-0">{formatDate(ci.call_date)}</span>
                  )}
                </div>
              ))}
              <Link href="/calls" className="text-xs text-blue-600 hover:underline print:hidden">
                All calls →
              </Link>
            </div>
          )}
        </section>
      )}

      {/* ── Litigation ────────────────────────────────────────── */}
      {(cases.length > 0 || sectionErrors.litigation) && (
        <section className="mb-8">
          <h2 className="section-title mb-2 flex items-center gap-1.5">
            <Scale size={14} className="text-slate-400" />Litigation
            <span className="font-normal text-slate-400">{cases.length}</span>
          </h2>
          {noteBox('section:litigation', 'Litigation notes…', 'mb-3')}
          {sectionErrors.litigation && (
            <p className="text-sm text-red-600">Couldn&apos;t load cases — {sectionErrors.litigation}</p>
          )}
          {cases.map(c => {
            const days = c.next_deadline ? daysUntilDate(c.next_deadline) : null
            const urgent = days != null && days <= 14
            return (
              <div key={c.id} className="flex items-center gap-2 py-2 border-b border-slate-200/70 flex-wrap">
                <Link href={`/litigation/${c.id}`}
                  className="text-sm font-medium text-slate-700 hover:text-blue-600 flex-1 min-w-0">
                  {c.title}
                </Link>
                <span className="text-xs text-slate-500">{TYPE_LABEL[c.case_type] ?? c.case_type}</span>
                <span className={cn('badge', STATUS_META[c.status]?.style ?? 'text-slate-600 bg-slate-50 border-slate-200')}>
                  {STATUS_META[c.status]?.label ?? c.status}
                </span>
                {c.next_deadline && (
                  <span className={cn('text-xs', urgent ? 'text-red-600 font-semibold' : 'text-slate-500')}>
                    {c.next_deadline_label ? `${c.next_deadline_label} — ` : ''}
                    {formatDate(c.next_deadline)}
                    {days != null ? ` (${days}d)` : ''}
                  </span>
                )}
              </div>
            )
          })}
        </section>
      )}

      {/* ── Past visit notes ──────────────────────────────────── */}
      {pastByDate.length > 0 && (
        <section className="mb-8 print:hidden">
          <button onClick={() => setPastOpen(o => !o)}
            className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-700">
            <ChevronDown size={14} className={cn('transition-transform', !pastOpen && '-rotate-90')} />
            Past visit notes ({pastByDate.length} visit{pastByDate.length === 1 ? '' : 's'})
          </button>
          {pastOpen && pastByDate.map(([date, notes]) => (
            <div key={date} className="mt-3 pl-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">
                {formatDate(date)}
              </p>
              {notes.map(n => (
                <div key={n.scope} className="mb-2">
                  <p className="text-xs text-slate-400">{noteScopeLabel(n.scope)}</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{n.body}</p>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
