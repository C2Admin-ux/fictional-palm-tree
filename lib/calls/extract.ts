// Shared extraction core for PM check-in calls. Turns a call's raw
// transcript (pasted Granola notes or an inbound Gemini email) into a
// summary + structured call_items, grounded in app data: the PMC's
// properties, their open tasks, and the previous processed call's items
// (so unresolved commitments carry forward as accountability context).
//
// Two callers share this path so the behavior can't drift:
//   • POST /api/calls/extract  (session-authed review surface)
//   • lib/calls/ingest.ts      (email ingest pipeline behind the
//     /api/calls/inbound webhook and /api/calls/ingest direct post,
//     service-role client)
// The caller supplies the Supabase client; RLS vs service-role is its
// concern, not this module's.

import type { SupabaseClient } from '@supabase/supabase-js'
import { anthropicJson, callAnthropic } from '@/lib/anthropic'
import { CALL_ITEM_KINDS } from '@/lib/calls/ui'
import { OPEN_STATUSES } from '@/lib/tasks/vocab'
import type { Call, CallItem, Database } from '@/lib/supabase/types'

type Client = SupabaseClient<Database>

type PropertyRef = { id: string; name: string }
type OpenTaskRef = {
  id: string; title: string; status: string; priority: string
  due_date: string | null; property_id: string | null
}
type PreviousItemRef = {
  kind: string; description: string; resolved: boolean; property: string | null
}

export type CallExtractionContext = {
  call_date: string
  pmc_name: string | null
  properties: PropertyRef[]
  open_tasks: OpenTaskRef[]
  previous_items: PreviousItemRef[]
  transcript: string
}

// What the model must return per item (validated hard below — ids are
// only trusted when they exist in the provided context).
type RawItem = {
  kind?: unknown; property_id?: unknown; description?: unknown
  owner?: unknown; matched_task_id?: unknown; due_hint?: unknown
}

export type ExtractOutcome =
  | { ok: true; summary: string; items: CallItem[] }
  | { ok: false; status: number; error: string; detail?: string }

// Real calendar validation for model-supplied dates: the format regex
// alone admits impossible days ('2026-06-31') that Postgres would reject
// — failing the whole item batch. Parse + round-trip so an invalid
// due_hint degrades to null while the item survives.
function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

// Exported so the offline prompt-sanity script exercises the EXACT
// prompt the route ships — no drift between test and production.
export function buildCallExtractionPrompt(ctx: CallExtractionContext): string {
  return `You are processing the notes/transcript of a weekly property-management (PM) check-in call for the owner of a multifamily real-estate portfolio. The owner ("Nick") is on the call with his property management company${ctx.pmc_name ? ` (${ctx.pmc_name})` : ''}.

Call date: ${ctx.call_date}

CONTEXT — these are the ONLY valid ids. Never invent, alter, or guess ids.

Properties (the portfolio in scope for this call):
${JSON.stringify(ctx.properties)}

Open tasks already tracked in the owner's system:
${JSON.stringify(ctx.open_tasks)}

Unresolved items from the PREVIOUS check-in call (accountability — listen for status on these):
${JSON.stringify(ctx.previous_items)}

Return ONLY a valid JSON object, no preamble:

{
  "summary": "3-6 sentence recap of the call: what was covered, headline numbers, the big movements",
  "items": [
    {
      "kind": "action" | "update" | "issue" | "decision",
      "property_id": "one of the provided property ids" | null,
      "description": "short, specific, actionable sentence",
      "owner": "pm" | "owner" | null,
      "matched_task_id": "one of the provided open-task ids" | null,
      "due_hint": "YYYY-MM-DD" | null
    }
  ]
}

Rules:
- kind: "action" = new work someone committed to do; "update" = progress/status on existing or tracked work; "issue" = a problem raised with no clear owner/action yet; "decision" = something agreed or decided on the call.
- PREFER MATCHING over creating: when the discussion clearly refers to one of the open tasks above, set matched_task_id to that task's id and use kind "update" (or "action" if new work was committed on it) instead of inventing a duplicate action. matched_task_id must be exactly one of the provided open-task ids, else null.
- property_id must be exactly one of the provided property ids; null when the item is portfolio-wide or the property is unclear. NEVER invent property ids.
- description: one short sentence, concrete and self-contained ("Replace pool pump at ...", "Delinquency down to 2.1%..."). No filler, no speaker names unless needed.
- owner: "pm" when the management company owes the follow-through, "owner" when Nick/ownership does, null when unclear.
- due_hint: only when a date or clear timeframe was stated ("by Friday", "end of month" — resolve relative dates against the call date). Otherwise null.
- If the previous call's unresolved items are discussed, capture the new status as an item (matched to a task when one exists).
- Skip small talk and pleasantries. Do not fabricate items.

TRANSCRIPT:
${ctx.transcript}`
}

// Loads everything the prompt needs for one call. Exported separately so
// the extract route can respond with context-shaped errors distinctly.
async function loadContext(supabase: Client, call: Call): Promise<CallExtractionContext> {
  let pmcName: string | null = null
  if (call.pmc_id) {
    const { data } = await supabase.from('pmcs').select('name').eq('id', call.pmc_id).single()
    pmcName = data?.name ?? null
  }

  // The call's property pool: the PMC's properties, or every active
  // property when the call isn't assigned to a PMC yet (inbound email).
  let propQuery = supabase.from('properties').select('id, name').order('name')
  propQuery = call.pmc_id
    ? propQuery.eq('pmc_id', call.pmc_id)
    : propQuery.eq('status', 'active')
  const { data: properties, error: propError } = await propQuery
  if (propError) throw propError
  const propertyIds = (properties ?? []).map(p => p.id)

  let openTasks: OpenTaskRef[] = []
  if (propertyIds.length > 0) {
    // Capped: the inbound path (pmc null) spans every active property —
    // the 200 soonest-due open tasks are plenty of matching context
    // without embedding the whole portfolio's backlog in the prompt.
    const { data, error } = await supabase.from('tasks')
      .select('id, title, status, priority, due_date, property_id')
      .in('property_id', propertyIds)
      .in('status', OPEN_STATUSES)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(200)
    if (error) throw error
    openTasks = data ?? []
  }

  // Previous processed call for the SAME pmc (or the same "unassigned"
  // bucket) on or before this call's date — its items are the
  // accountability list the model listens for status on.
  let prevQuery = supabase.from('calls')
    .select('id')
    .eq('status', 'processed')
    .neq('id', call.id)
    .lte('call_date', call.call_date)
    .order('call_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
  prevQuery = call.pmc_id ? prevQuery.eq('pmc_id', call.pmc_id) : prevQuery.is('pmc_id', null)
  const { data: prevCalls } = await prevQuery

  let previousItems: PreviousItemRef[] = []
  if (prevCalls && prevCalls.length > 0) {
    const { data: prevItems } = await supabase.from('call_items')
      .select('kind, description, resolved, property_id')
      .eq('call_id', prevCalls[0].id)
      .order('sort_order')
    const nameById = new Map((properties ?? []).map(p => [p.id, p.name]))
    previousItems = (prevItems ?? [])
      .filter(i => !i.resolved)
      .map(i => ({
        kind: i.kind,
        description: i.description,
        resolved: i.resolved,
        property: i.property_id ? nameById.get(i.property_id) ?? null : null,
      }))
  }

  return {
    call_date: call.call_date,
    pmc_name: pmcName,
    properties: properties ?? [],
    open_tasks: openTasks,
    previous_items: previousItems,
    transcript: call.transcript ?? '',
  }
}

/** Run extraction for one call: build context, one Anthropic call, then
 *  persist summary + replace the call's UNLINKED proposal items (items
 *  already linked to a task survive re-runs). Status stays 'draft' —
 *  processing is the human Confirm step, never the model's. */
export async function extractCall(supabase: Client, call: Call): Promise<ExtractOutcome> {
  if (!call.transcript?.trim()) {
    return { ok: false, status: 400, error: 'Call has no transcript to extract from' }
  }

  const ctx = await loadContext(supabase, call)

  const response = await callAnthropic({
    max_tokens: 8000, // generous — long calls yield many items
    messages: [{ role: 'user', content: buildCallExtractionPrompt(ctx) }],
  })

  if (!response.ok) {
    const errText = await response.text()
    console.error('Call extraction Anthropic error:', errText)
    return { ok: false, status: 502, error: 'Extraction failed', detail: errText }
  }

  const parsed = anthropicJson<{ summary?: unknown; items?: RawItem[] }>(await response.json())
  if (!parsed || typeof parsed.summary !== 'string' || !Array.isArray(parsed.items)) {
    return { ok: false, status: 422, error: 'Could not parse extraction result' }
  }

  // Hard validation: ids only pass when they exist in the provided
  // context; enum fields fall back rather than fail the whole call.
  const propertyIds = new Set(ctx.properties.map(p => p.id))
  const taskIds = new Set(ctx.open_tasks.map(t => t.id))
  const items = parsed.items
    .filter(i => typeof i.description === 'string' && (i.description as string).trim().length > 0)
    .map(i => ({
      kind: CALL_ITEM_KINDS.includes(i.kind as typeof CALL_ITEM_KINDS[number]) ? i.kind as CallItem['kind'] : 'update',
      property_id: typeof i.property_id === 'string' && propertyIds.has(i.property_id) ? i.property_id : null,
      description: (i.description as string).trim(),
      owner: i.owner === 'pm' || i.owner === 'owner' ? i.owner : null,
      matched_task_id: typeof i.matched_task_id === 'string' && taskIds.has(i.matched_task_id) ? i.matched_task_id : null,
      due_hint: typeof i.due_hint === 'string' && isValidDateOnly(i.due_hint) ? i.due_hint : null,
    }))

  // Persist: summary on the call, then swap the PROPOSAL set. Items a
  // partial confirm already linked (task_id set) are never touched —
  // deleting them would let the next confirm duplicate their tasks. The
  // fully-validated fresh proposals are INSERTED FIRST (their new ids
  // are the batch marker), then the stale unlinked rows outside that
  // batch are deleted — an order that can never strip the call: an
  // insert failure leaves the old set intact, a delete failure leaves
  // extra stale rows that the next re-run supersedes.
  const { error: updateError } = await supabase.from('calls')
    .update({ summary: parsed.summary, updated_at: new Date().toISOString() })
    .eq('id', call.id)
  if (updateError) {
    return { ok: false, status: 500, error: `Could not save summary: ${updateError.message}` }
  }

  // Kept (linked) items stay in front; fresh proposals continue after.
  const { data: keptRows, error: keptError } = await supabase.from('call_items')
    .select('id, sort_order').eq('call_id', call.id).not('task_id', 'is', null)
  if (keptError) {
    return { ok: false, status: 500, error: `Could not load existing items: ${keptError.message}` }
  }
  const baseOrder = (keptRows ?? []).reduce((max, r) => Math.max(max, r.sort_order), -1) + 1

  let inserted: CallItem[] = []
  if (items.length > 0) {
    const { data, error: insertError } = await supabase.from('call_items')
      .insert(items.map((i, idx) => ({ ...i, call_id: call.id, sort_order: baseOrder + idx })))
      .select('*')
    if (insertError) {
      return { ok: false, status: 500, error: `Could not save items: ${insertError.message}` }
    }
    inserted = (data ?? []) as CallItem[]
  }

  let deleteQuery = supabase.from('call_items').delete()
    .eq('call_id', call.id).is('task_id', null)
  if (inserted.length > 0) {
    deleteQuery = deleteQuery.not('id', 'in', `(${inserted.map(i => i.id).join(',')})`)
  }
  const { error: deleteError } = await deleteQuery
  if (deleteError) {
    return { ok: false, status: 500, error: `Could not clear previous items: ${deleteError.message}` }
  }

  return { ok: true, summary: parsed.summary, items: inserted }
}
