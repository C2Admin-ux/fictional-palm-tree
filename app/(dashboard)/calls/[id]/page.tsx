'use client'

// Call detail — the review/confirm surface of the calls flywheel.
// Extraction proposes items (grounded in properties + open tasks); Nick
// curates them here (kind, property, owner, task links), then "Confirm &
// process" turns checked actions into tasks and promotes matched items
// onto their existing tasks. Items stay editable after processing —
// only the Confirm button retires.

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Call, CallItem, Task } from '@/lib/supabase/types'
import { cn, formatDate, formatDateShort } from '@/lib/utils'
import {
  CALL_ITEM_KINDS, CALL_ITEM_KIND_LABELS, CALL_ITEM_KIND_STYLES,
  CALL_OWNER_LABELS, CALL_SOURCE_LABELS, CALL_STATUS_LABELS, CALL_STATUS_STYLES,
} from '@/lib/calls/ui'
import { InlineText, InlineDate, InlineSelect } from '@/components/ui/inline-edit'
import { toast } from '@/components/ui/toast'
import { insertTask } from '@/lib/tasks/create'
import {
  ArrowLeft, AlertTriangle, RotateCcw, Sparkles, Plus, Phone,
  CheckCircle2, Circle, X, Link2, ExternalLink, ChevronDown, ChevronRight,
} from 'lucide-react'

type PmcOption = { id: string; name: string }
type PropertyOption = { id: string; name: string }
type TaskRef = Pick<Task, 'id' | 'title' | 'status'>

const UNASSIGNED = '__unassigned__'

export default function CallDetailPage() {
  const params = useParams<{ id: string }>()
  const callId = params.id
  const supabase = createClient()

  const [call, setCall] = useState<Call | null>(null)
  const [items, setItems] = useState<CallItem[]>([])
  const [pmcs, setPmcs] = useState<PmcOption[]>([])
  const [properties, setProperties] = useState<PropertyOption[]>([])
  // Titles/status of every task referenced by an item (task_id or
  // matched_task_id) — for the "Matches: …" / "Linked: …" lines.
  const [taskRefs, setTaskRefs] = useState<Record<string, TaskRef>>({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  // Per-item review choices (uncommitted until Confirm & process):
  // unchecking removes an action from task creation / a match from linking.
  // Default ON for both — the common case confirms everything.
  const [uncheckedCreate, setUncheckedCreate] = useState<Set<string>>(new Set())
  const [uncheckedLink, setUncheckedLink] = useState<Set<string>>(new Set())
  // Items whose created task exists but could not be linked AND could not
  // be compensation-deleted — re-confirming would duplicate the task, so
  // they sit out for the rest of the session (see confirmProcess).
  const [orphanedItems, setOrphanedItems] = useState<Set<string>>(new Set())

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchCall = useCallback(async () => {
    const { data, error } = await supabase.from('calls')
      .select('*').eq('id', callId).single()
    if (error) {
      if (error.code === 'PGRST116') { setNotFound(true); setLoading(false); return }
      setFetchError(error.message)
      setLoading(false)
      return
    }
    setFetchError(null)
    setCall(data as Call)
    setLoading(false)
  }, [callId])

  const fetchItems = useCallback(async () => {
    const { data, error } = await supabase.from('call_items')
      .select('*').eq('call_id', callId).order('sort_order').order('created_at')
    if (error) { setActionError(`Could not load items: ${error.message}`); return }
    setItems((data as CallItem[]) ?? [])
  }, [callId])

  useEffect(() => { fetchCall(); fetchItems() }, [fetchCall, fetchItems])
  useEffect(() => {
    supabase.from('pmcs').select('id, name').order('name')
      .then(({ data }) => setPmcs(data ?? []))
    supabase.from('properties').select('id, name').order('name')
      .then(({ data }) => setProperties(data ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resolve referenced task titles whenever the item set changes.
  useEffect(() => {
    const ids = Array.from(new Set(
      items.flatMap(i => [i.task_id, i.matched_task_id]).filter((v): v is string => !!v)
    ))
    const missing = ids.filter(id => !taskRefs[id])
    if (missing.length === 0) return
    supabase.from('tasks').select('id, title, status').in('id', missing)
      .then(({ data }) => {
        if (!data) return
        setTaskRefs(prev => {
          const next = { ...prev }
          for (const t of data) next[t.id] = t as TaskRef
          return next
        })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // ── Optimistic writes (call + items) ───────────────────────

  async function patchCall(fields: Partial<Call>) {
    if (!call) return
    const prev = call
    const stamped = { ...fields, updated_at: new Date().toISOString() }
    setCall({ ...call, ...stamped })
    const { error } = await supabase.from('calls').update(stamped).eq('id', call.id)
    if (error) {
      setCall(prev)
      toast('Could not save — change reverted', { tone: 'error' })
    }
  }

  async function patchItem(item: CallItem, fields: Partial<CallItem>) {
    setItems(list => list.map(i => i.id === item.id ? { ...i, ...fields } : i))
    const { error } = await supabase.from('call_items').update(fields).eq('id', item.id)
    if (error) {
      setItems(list => list.map(i => i.id === item.id ? item : i))
      toast('Could not save — change reverted', { tone: 'error' })
    }
  }

  async function deleteItem(item: CallItem) {
    setItems(list => list.filter(i => i.id !== item.id))
    const { error } = await supabase.from('call_items').delete().eq('id', item.id)
    if (error) {
      setItems(list => [...list, item].sort((a, b) => a.sort_order - b.sort_order))
      toast('Could not delete item', { tone: 'error' })
    }
  }

  async function addItem(kind: CallItem['kind'], description: string, propertyId: string | null) {
    const sortOrder = items.reduce((max, i) => Math.max(max, i.sort_order), -1) + 1
    const { data, error } = await supabase.from('call_items')
      .insert({ call_id: callId, kind, description, property_id: propertyId, sort_order: sortOrder })
      .select('*').single()
    if (error || !data) {
      toast('Could not add item', { tone: 'error' })
      return
    }
    setItems(list => [...list, data as CallItem])
  }

  // ── Extraction re-run ──────────────────────────────────────

  async function rerunExtraction() {
    if (!call) return
    if (items.length > 0 &&
      !confirm('Re-run extraction? A fresh extraction of the transcript replaces the unlinked proposed items; items already linked to tasks are kept.')) return
    setExtracting(true)
    setActionError(null)
    try {
      const res = await fetch('/api/calls/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: call.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setActionError(`Extraction failed: ${body?.error ?? `HTTP ${res.status}`}`)
      } else {
        setUncheckedCreate(new Set())
        setUncheckedLink(new Set())
        setOrphanedItems(new Set())
        await Promise.all([fetchCall(), fetchItems()])
        toast('Extraction complete')
      }
    } catch (err: any) {
      setActionError(`Extraction failed: ${err.message}`)
    }
    setExtracting(false)
  }

  // ── Confirm & process ──────────────────────────────────────
  // Checked matches (any kind) link their existing task; unchecked
  // matches are skipped entirely — never silently turned into new tasks
  // (clear the match first to make an action creatable). Checked
  // unmatched actions become tasks, and a creation only counts when BOTH
  // the task insert and the item link landed. Per-item failures are
  // counted, not hidden — the call only flips to processed when every
  // requested write landed.

  async function confirmProcess() {
    if (!call) return
    setProcessing(true)
    setActionError(null)
    let created = 0, linked = 0, failed = 0
    let orphanMessage: string | null = null

    for (const item of items) {
      if (item.task_id) continue // already linked (e.g. earlier partial run)
      if (orphanedItems.has(item.id)) continue // its task exists unlinked — retrying would duplicate it

      // Matched proposal: link when checked, otherwise skip entirely.
      if (item.matched_task_id) {
        if (uncheckedLink.has(item.id)) continue
        const { error } = await supabase.from('call_items')
          .update({ task_id: item.matched_task_id }).eq('id', item.id)
        if (error) { failed++; continue }
        setItems(list => list.map(i => i.id === item.id ? { ...i, task_id: item.matched_task_id } : i))
        linked++
        continue
      }

      // Unmatched action with "Create task" checked → new task.
      if (item.kind === 'action' && !uncheckedCreate.has(item.id)) {
        const task = await insertTask(supabase, {
          title: item.description,
          status: 'next_action',
          priority: 'medium',
          due_date: item.due_hint,
          description: `From PM call — ${call.title || 'PM check-in'} · ${formatDate(call.call_date)}`,
          property_id: item.property_id,
          auto_source: 'call',
          source_record_id: call.id,
          created_by: userId,
          assigned_to: userId,
        })
        if (!task) { failed++; continue }
        const { error: linkError } = await supabase.from('call_items')
          .update({ task_id: task.id }).eq('id', item.id)
        if (linkError) {
          // Compensate: delete the task the item doesn't know about. If
          // THAT also fails an unlinked task really exists — saying
          // "confirm again" would invite a duplicate, so the item sits
          // out for this session (same pattern as inspection findings).
          const { error: deleteError } = await supabase.from('tasks').delete().eq('id', task.id)
          if (deleteError) {
            setOrphanedItems(prev => new Set(prev).add(item.id))
            orphanMessage = `“${task.title}” exists in Tasks but couldn’t be linked to its call item — delete it there, or reload and confirm again.`
          }
          failed++
          continue
        }
        setItems(list => list.map(i => i.id === item.id ? { ...i, task_id: task.id } : i))
        setTaskRefs(prev => ({ ...prev, [task.id]: { id: task.id, title: task.title, status: task.status } }))
        created++
      }
    }

    if (failed > 0) {
      const base = `${failed} item${failed === 1 ? '' : 's'} could not be processed — fix and confirm again.`
      setActionError(orphanMessage ? `${base} ${orphanMessage}` : base)
    } else {
      await patchCall({ status: 'processed' })
    }
    const parts = [
      `${created} task${created === 1 ? '' : 's'} created`,
      `${linked} linked`,
    ]
    toast(parts.join(', '), failed > 0 ? { tone: 'error' } : undefined)
    setProcessing(false)
  }

  // ── Grouping ───────────────────────────────────────────────

  const grouped = useMemo(() => {
    const nameById = new Map(properties.map(p => [p.id, p.name]))
    const groups = new Map<string, { label: string; items: CallItem[] }>()
    for (const item of items) {
      const key = item.property_id ?? UNASSIGNED
      const label = item.property_id ? nameById.get(item.property_id) ?? 'Unknown property' : 'Unassigned'
      const g = groups.get(key) ?? { label, items: [] }
      g.items.push(item)
      groups.set(key, g)
    }
    // Property groups alphabetical, unassigned last.
    return Array.from(groups.entries())
      .sort(([ka, a], [kb, b]) => {
        if (ka === UNASSIGNED) return 1
        if (kb === UNASSIGNED) return -1
        return a.label.localeCompare(b.label)
      })
  }, [items, properties])

  const isDraft = call?.status === 'draft'
  const pmcOptions = useMemo(() => [
    { value: '', label: 'No PMC' },
    ...pmcs.map(p => ({ value: p.id, label: p.name })),
  ], [pmcs])
  const propertyOptions = useMemo(() => [
    { value: '', label: 'Unassigned' },
    ...properties.map(p => ({ value: p.id, label: p.name })),
  ], [properties])
  const kindOptions = useMemo(() => CALL_ITEM_KINDS.map(k => ({
    value: k, label: CALL_ITEM_KIND_LABELS[k], className: cn('badge', CALL_ITEM_KIND_STYLES[k]),
  })), [])
  const ownerOptions = [
    { value: '', label: '—' },
    { value: 'pm', label: 'PM' },
    { value: 'owner', label: 'Owner' },
  ]

  if (loading) return <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
  if (notFound) return (
    <div className="p-6 max-w-3xl mx-auto text-center space-y-3 py-16">
      <p className="text-sm text-slate-500">Call not found.</p>
      <Link href="/calls" className="btn-secondary inline-flex"><ArrowLeft size={14} />Back to Calls</Link>
    </div>
  )
  if (fetchError || !call) return (
    <div className="p-6 max-w-3xl mx-auto text-center space-y-3 py-16">
      <p className="text-sm text-red-600 flex items-center justify-center gap-1.5">
        <AlertTriangle size={14} />Could not load call — {fetchError}
      </p>
      <button onClick={() => { setLoading(true); setFetchError(null); fetchCall(); fetchItems() }}
        className="btn-secondary"><RotateCcw size={14} />Retry</button>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <Link href="/calls" className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={12} />Calls
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Phone size={18} className="text-slate-400 flex-shrink-0" />
              <InlineText
                value={call.title}
                onSave={v => patchCall({ title: v })}
                placeholder="Untitled call"
                displayClassName="text-lg font-semibold text-slate-900"
              />
            </div>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs text-slate-500">
              <InlineDate
                value={call.call_date}
                onSave={v => patchCall({ call_date: v ?? call.call_date })}
              />
              <InlineSelect
                value={call.pmc_id ?? ''}
                options={pmcOptions}
                onSave={v => patchCall({ pmc_id: v || null })}
                trigger={
                  <span className="text-xs text-slate-600 underline decoration-dotted underline-offset-2">
                    {pmcs.find(p => p.id === call.pmc_id)?.name ?? 'No PMC'}
                  </span>
                }
              />
              <span className="text-slate-300">·</span>
              <span>{CALL_SOURCE_LABELS[call.source]}</span>
              <span className={cn('badge', CALL_STATUS_STYLES[call.status])}>
                {CALL_STATUS_LABELS[call.status]}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isDraft && (
              <button onClick={rerunExtraction} disabled={extracting || processing} className="btn-secondary">
                <Sparkles size={14} />{extracting ? 'Extracting…' : 'Re-run extraction'}
              </button>
            )}
            {isDraft && (
              <button onClick={confirmProcess} disabled={processing || extracting} className="btn-primary">
                {processing ? 'Processing…' : 'Confirm & process'}
              </button>
            )}
          </div>
        </div>
      </div>

      {actionError && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)} aria-label="Dismiss error"
            className="text-red-400 hover:text-red-600 flex-shrink-0"><X size={12} /></button>
        </p>
      )}

      {/* Summary */}
      <SummaryCard summary={call.summary} onSave={v => patchCall({ summary: v || null })} />

      {/* Items grouped by property */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Items</h2>
          <span className="text-xs text-slate-400">
            {items.length} item{items.length === 1 ? '' : 's'}
            {items.filter(i => !i.resolved).length > 0 && ` · ${items.filter(i => !i.resolved).length} open`}
          </span>
        </div>

        {items.length === 0 && !extracting && (
          <div className="card p-6 text-center text-sm text-slate-400 italic">
            No items yet — run extraction or add items manually below.
          </div>
        )}
        {extracting && (
          <div className="card p-6 text-center text-sm text-slate-400">
            Extracting items from the transcript…
          </div>
        )}

        {grouped.map(([key, group]) => (
          <div key={key} className="card overflow-visible">
            <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {group.label}
            </div>
            <div className="divide-y divide-slate-50">
              {group.items.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  isDraft={isDraft}
                  kindOptions={kindOptions}
                  propertyOptions={propertyOptions}
                  ownerOptions={ownerOptions}
                  taskRefs={taskRefs}
                  createChecked={!uncheckedCreate.has(item.id)}
                  linkChecked={!uncheckedLink.has(item.id)}
                  onToggleCreate={() => setUncheckedCreate(prev => {
                    const next = new Set(prev)
                    if (next.has(item.id)) next.delete(item.id); else next.add(item.id)
                    return next
                  })}
                  onToggleLink={() => setUncheckedLink(prev => {
                    const next = new Set(prev)
                    if (next.has(item.id)) next.delete(item.id); else next.add(item.id)
                    return next
                  })}
                  onPatch={fields => patchItem(item, fields)}
                  onDelete={() => deleteItem(item)}
                />
              ))}
            </div>
          </div>
        ))}

        <AddItemRow properties={properties} onAdd={addItem} />
      </div>

      {/* Transcript */}
      {call.transcript && (
        <div className="card overflow-hidden">
          <button
            onClick={() => setShowTranscript(s => !s)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            {showTranscript ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Transcript
            <span className="text-xs font-normal text-slate-400">
              {call.transcript.length.toLocaleString()} chars
            </span>
          </button>
          {showTranscript && (
            <pre className="px-4 pb-4 text-xs text-slate-600 whitespace-pre-wrap font-mono max-h-[480px] overflow-y-auto">
              {call.transcript}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ── Summary card ─────────────────────────────────────────────
// Editable textarea that saves on blur (only when changed).

function SummaryCard({ summary, onSave }: {
  summary: string | null
  onSave: (v: string) => void
}) {
  const [draft, setDraft] = useState(summary ?? '')
  // Re-sync when extraction rewrites the summary underneath.
  useEffect(() => { setDraft(summary ?? '') }, [summary])
  return (
    <div className="card p-4">
      <h2 className="section-title mb-2">Summary</h2>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft !== (summary ?? '')) onSave(draft) }}
        placeholder="Call summary — filled by extraction, editable here"
        className="w-full text-sm text-slate-700 bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 focus:outline-none rounded-lg p-2 -m-2 resize-y min-h-[72px]"
      />
    </div>
  )
}

// ── Item row ─────────────────────────────────────────────────

type Option = { value: string; label: string; className?: string }

function ItemRow({
  item, isDraft, kindOptions, propertyOptions, ownerOptions, taskRefs,
  createChecked, linkChecked, onToggleCreate, onToggleLink, onPatch, onDelete,
}: {
  item: CallItem
  isDraft: boolean
  kindOptions: Option[]
  propertyOptions: Option[]
  ownerOptions: Option[]
  taskRefs: Record<string, TaskRef>
  createChecked: boolean
  linkChecked: boolean
  onToggleCreate: () => void
  onToggleLink: () => void
  onPatch: (fields: Partial<CallItem>) => void
  onDelete: () => void
}) {
  const linkedTask = item.task_id ? taskRefs[item.task_id] : null
  const matchedTask = !item.task_id && item.matched_task_id ? taskRefs[item.matched_task_id] : null
  const showCreate = isDraft && item.kind === 'action' && !item.task_id && !item.matched_task_id

  return (
    <div className={cn('px-4 py-3 space-y-1.5', item.resolved && 'opacity-60')}>
      <div className="flex items-start gap-2.5">
        {/* Resolved toggle */}
        <button
          onClick={() => onPatch({ resolved: !item.resolved })}
          title={item.resolved ? 'Mark open' : 'Mark resolved'}
          className="mt-0.5 flex-shrink-0 text-slate-300 hover:text-emerald-500 transition-colors">
          {item.resolved
            ? <CheckCircle2 size={16} className="text-emerald-500" />
            : <Circle size={16} />}
        </button>

        {/* Kind chip */}
        <InlineSelect
          value={item.kind}
          options={kindOptions}
          onSave={v => onPatch({ kind: v as CallItem['kind'] })}
          trigger={
            <span className={cn('badge text-xs cursor-pointer', CALL_ITEM_KIND_STYLES[item.kind])}>
              {CALL_ITEM_KIND_LABELS[item.kind]}
            </span>
          }
        />

        {/* Description */}
        <div className="flex-1 min-w-0">
          <InlineText
            value={item.description}
            onSave={v => { if (v.trim()) onPatch({ description: v.trim() }) }}
            displayClassName={cn('text-sm text-slate-800', item.resolved && 'line-through')}
          />
        </div>

        {/* Delete */}
        <button onClick={onDelete} title="Delete item"
          className="flex-shrink-0 text-slate-300 hover:text-red-400 transition-colors mt-0.5">
          <X size={13} />
        </button>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 flex-wrap pl-[26px] text-xs text-slate-500">
        <InlineSelect
          value={item.property_id ?? ''}
          options={propertyOptions}
          onSave={v => onPatch({ property_id: v || null })}
          trigger={
            <span className="underline decoration-dotted underline-offset-2 cursor-pointer">
              {propertyOptions.find(o => o.value === (item.property_id ?? ''))?.label ?? 'Unassigned'}
            </span>
          }
        />
        <InlineSelect
          value={item.owner ?? ''}
          options={ownerOptions}
          onSave={v => onPatch({ owner: v || null })}
          trigger={
            <span className="cursor-pointer">
              {item.owner ? `Owes: ${CALL_OWNER_LABELS[item.owner] ?? item.owner}` : 'Owner —'}
            </span>
          }
        />
        {item.due_hint && (
          <span className="text-amber-600">Due hint: {formatDateShort(item.due_hint)}</span>
        )}

        {/* Task link states */}
        {linkedTask && (
          <Link href="/tasks" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700">
            <Link2 size={11} />
            Linked: <span className="font-medium truncate max-w-[220px]">{linkedTask.title}</span>
            <ExternalLink size={10} />
          </Link>
        )}
        {!linkedTask && item.task_id && (
          <span className="inline-flex items-center gap-1 text-slate-400"><Link2 size={11} />Linked task</span>
        )}
        {matchedTask && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-400">Matches:</span>
            <Link href="/tasks" className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">
              <span className="font-medium truncate max-w-[220px]">{matchedTask.title}</span>
              <ExternalLink size={10} />
            </Link>
            {isDraft && (
              <label className="inline-flex items-center gap-1 cursor-pointer select-none text-slate-500">
                <input type="checkbox" checked={linkChecked} onChange={onToggleLink}
                  className="rounded border-slate-300" />
                link
              </label>
            )}
            {isDraft && (
              // Wrong match? Clearing it turns the item back into a plain
              // proposal — actions regain their "Create task" checkbox.
              <button onClick={() => onPatch({ matched_task_id: null })} title="Clear match"
                className="text-slate-300 hover:text-red-400 transition-colors">
                <X size={11} />
              </button>
            )}
          </span>
        )}
        {showCreate && (
          <label className="inline-flex items-center gap-1 cursor-pointer select-none text-blue-600">
            <input type="checkbox" checked={createChecked} onChange={onToggleCreate}
              className="rounded border-slate-300" />
            Create task
          </label>
        )}
      </div>
    </div>
  )
}

// ── Add item row ─────────────────────────────────────────────

function AddItemRow({ properties, onAdd }: {
  properties: PropertyOption[]
  onAdd: (kind: CallItem['kind'], description: string, propertyId: string | null) => Promise<void>
}) {
  const [kind, setKind] = useState<CallItem['kind']>('action')
  const [description, setDescription] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim() || saving) return
    setSaving(true)
    await onAdd(kind, description.trim(), propertyId || null)
    setDescription('')
    setSaving(false)
  }

  return (
    <form onSubmit={submit} className="card px-4 py-3 flex items-center gap-2 flex-wrap">
      <Plus size={14} className="text-slate-300 flex-shrink-0" />
      <select value={kind} onChange={e => setKind(e.target.value as CallItem['kind'])}
        className="input-sm w-auto" aria-label="Item kind">
        {CALL_ITEM_KINDS.map(k => <option key={k} value={k}>{CALL_ITEM_KIND_LABELS[k]}</option>)}
      </select>
      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Add an item…"
        className="input-sm flex-1 min-w-[180px]"
      />
      <select value={propertyId} onChange={e => setPropertyId(e.target.value)}
        className="input-sm w-auto" aria-label="Property">
        <option value="">Unassigned</option>
        {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="submit" disabled={!description.trim() || saving} className="btn-secondary">
        {saving ? 'Adding…' : 'Add'}
      </button>
    </form>
  )
}
