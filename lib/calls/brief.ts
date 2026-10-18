// Pre-call brief: one markdown document per recurring call that Nick
// pastes into Claude together with the week's leasing report and other
// stats to produce the full agenda. Deterministic and additive — it reads
// app state and never writes. Sections:
//   1. Where things stand (running summary + recent decisions)
//   2. Last call: summary, follow-ups, unresolved items
//   3. Carried over: open items still unresolved, waiting tasks with aging,
//      overdue tasks, deadlines ≤60d, flagged/untriaged findings — per property
//   4. Draft agenda (latest generated one)
//   5. Inputs to attach (the standing metrics the call reports weekly)

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CallAgenda, CallItem, CallRollup, CallSeries, Database, Task } from '@/lib/supabase/types'
import { OBLIGATION_SOURCES, OPEN_STATUSES } from '@/lib/tasks/vocab'
import { daysSince, isOpenFinding } from '@/lib/inspections/dispositions'
import { formatDate, formatDateShort, todayISO, addDaysToDate } from '@/lib/utils'

type Client = SupabaseClient<Database>

export type BriefFinding = {
  id: string; item_label: string; section_name: string; property_id: string
  inspection_date: string; disposition: string; disposition_at: string | null
}
export type BriefProperty = {
  id: string; name: string
  waiting: Task[]; overdue: Task[]; obligations: Task[]; findings: BriefFinding[]
}
export type BriefData = {
  series: CallSeries
  rollup: CallRollup | null
  lastCall: { id: string; title: string; call_date: string; summary: string | null; notes_md: string | null } | null
  lastCallItems: CallItem[]
  agenda: CallAgenda | null
  properties: BriefProperty[]
  nextCallDate: string | null
  generatedAt: string
}

const agingDays = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000))
const overdueDays = (due: string) => Math.max(0, Math.floor((Date.now() - new Date(due + 'T00:00:00').getTime()) / 86400000))

export async function loadBrief(supabase: Client, seriesId: string): Promise<BriefData> {
  const { data: series, error } = await supabase.from('call_series').select('*').eq('id', seriesId).single()
  if (error || !series) throw error ?? new Error('Series not found')

  const today = todayISO()
  const in60 = addDaysToDate(today, 60)
  const propertyIds = series.property_ids ?? []

  const [rollupRes, lastRes, agendaRes, propsRes] = await Promise.all([
    supabase.from('call_rollups').select('*').eq('series_id', seriesId).maybeSingle(),
    supabase.from('calls').select('id, title, call_date, summary, notes_md').eq('series_id', seriesId)
      .order('call_date', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('call_agendas').select('*').eq('series_id', seriesId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    propertyIds.length
      ? supabase.from('properties').select('id, name').in('id', propertyIds).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const lastCall = lastRes.data ?? null

  const [itemsRes, waitingRes, overdueRes, obligationsRes, findingsRes] = await Promise.all([
    lastCall
      ? supabase.from('call_items').select('*').eq('call_id', lastCall.id).eq('resolved', false).order('sort_order')
      : Promise.resolve({ data: [] as CallItem[] }),
    propertyIds.length
      ? supabase.from('tasks').select('*').in('property_id', propertyIds).eq('status', 'waiting').order('updated_at', { ascending: true })
      : Promise.resolve({ data: [] as Task[] }),
    propertyIds.length
      ? supabase.from('tasks').select('*').in('property_id', propertyIds).in('status', OPEN_STATUSES).lt('due_date', today).order('due_date')
      : Promise.resolve({ data: [] as Task[] }),
    propertyIds.length
      ? supabase.from('tasks').select('*').in('property_id', propertyIds).in('auto_source', OBLIGATION_SOURCES).in('status', OPEN_STATUSES).lte('due_date', in60).order('due_date')
      : Promise.resolve({ data: [] as Task[] }),
    propertyIds.length
      ? supabase.from('inspection_items')
          .select('id, item_label, section_name, requires_action, disposition, disposition_at, inspections!inner(property_id, inspection_date)')
          .in('inspections.property_id', propertyIds).in('disposition', ['open', 'flagged'])
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const findings: BriefFinding[] = ((findingsRes.data ?? []) as any[])
    .filter(f => isOpenFinding(f))
    .map(f => ({
      id: f.id, item_label: f.item_label, section_name: f.section_name,
      property_id: f.inspections?.property_id, inspection_date: f.inspections?.inspection_date ?? '',
      disposition: f.disposition, disposition_at: f.disposition_at,
    }))

  const properties: BriefProperty[] = ((propsRes.data ?? []) as { id: string; name: string }[]).map(p => ({
    ...p,
    waiting: ((waitingRes.data ?? []) as Task[]).filter(t => t.property_id === p.id),
    overdue: ((overdueRes.data ?? []) as Task[]).filter(t => t.property_id === p.id),
    obligations: ((obligationsRes.data ?? []) as Task[]).filter(t => t.property_id === p.id),
    findings: findings.filter(f => f.property_id === p.id),
  }))

  return {
    series, rollup: rollupRes.data ?? null, lastCall,
    lastCallItems: (itemsRes.data ?? []) as CallItem[],
    agenda: agendaRes.data ?? null, properties,
    nextCallDate: lastCall ? addDaysToDate(lastCall.call_date, series.cadence_days) : null,
    generatedAt: today,
  }
}

/** Pull the "## Follow-ups" block out of notes_md, if present. */
function followUpsFrom(notes: string | null): string[] {
  if (!notes) return []
  const m = notes.match(/##\s*Follow-ups\s*\n([\s\S]*?)(?:\n##\s|$)/i)
  return m ? m[1].split('\n').map(l => l.trim()).filter(l => l.startsWith('-')) : []
}

export function briefMarkdown(d: BriefData): string {
  const L: string[] = []
  const name = d.series.display_name
  L.push(`# Pre-call brief — ${name}`)
  L.push(`_Generated ${formatDate(d.generatedAt)}${d.nextCallDate ? ` · next call ${formatDate(d.nextCallDate)}` : ''}${d.lastCall ? ` · last call ${formatDate(d.lastCall.call_date)}` : ''}_`)

  L.push('', '## Where things stand')
  L.push(d.rollup?.summary || '_No running summary yet._')
  const decisions = (Array.isArray(d.rollup?.recent_decisions) ? d.rollup!.recent_decisions : []) as unknown as { text: string; date?: string }[]
  if (decisions.length) {
    L.push('', '**Recent decisions**')
    for (const x of decisions) L.push(`- ${x.text}${x.date ? ` (${formatDateShort(x.date)})` : ''}`)
  }

  if (d.lastCall) {
    L.push('', `## Last call — ${formatDate(d.lastCall.call_date)}`)
    if (d.lastCall.summary) L.push(d.lastCall.summary)
    const fu = followUpsFrom(d.lastCall.notes_md)
    if (fu.length) { L.push('', '**Follow-ups promised**'); L.push(...fu) }
    const unresolved = d.lastCallItems.filter(i => i.kind === 'action' || i.kind === 'issue')
    if (unresolved.length) {
      L.push('', '**Still unresolved**')
      for (const i of unresolved) L.push(`- [${i.kind}] ${i.description}${i.owner ? ` (${i.owner})` : ''}${i.task_id ? ' — tracked' : ''}`)
    }
  }

  const open = (Array.isArray(d.rollup?.open_items) ? d.rollup!.open_items : []) as unknown as { text: string; owner?: string; since?: string; property?: string }[]
  if (open.length) {
    L.push('', '## Open items across recent calls')
    for (const o of open) L.push(`- ${o.text}${o.owner ? ` (${o.owner})` : ''}${o.since ? ` — since ${formatDateShort(o.since)}` : ''}${o.property ? ` · ${o.property}` : ''}`)
  }

  L.push('', '## Carried over, by property')
  for (const p of d.properties) {
    const n = p.waiting.length + p.overdue.length + p.obligations.length + p.findings.length
    L.push('', `### ${p.name}`)
    if (n === 0) { L.push('- Nothing outstanding in the tracker'); continue }
    const sec = (t: string, rows: string[]) => { if (rows.length) L.push(`**${t}**`, ...rows, '') }
    sec('Waiting on PM', p.waiting.map(t => `- ${t.title} — waiting ${agingDays(t.updated_at)}d${t.due_date ? ` (due ${formatDateShort(t.due_date)})` : ''}`))
    sec('Overdue', p.overdue.map(t => `- ${t.title} — due ${formatDateShort(t.due_date)} (${overdueDays(t.due_date!)}d overdue)`))
    sec('Deadlines ≤60 days', p.obligations.map(t => `- ${t.title} — due ${formatDateShort(t.due_date)}`))
    sec('Flagged / untriaged findings', p.findings.map(f => {
      const age = daysSince(f.disposition_at)
      return `- ${f.disposition === 'flagged' ? `[FLAGGED${age != null ? ` ${age}d` : ''}] ` : ''}${f.item_label} (${f.section_name}, inspected ${formatDateShort(f.inspection_date)})`
    }))
  }

  if (d.agenda) {
    L.push('', `## Draft agenda${d.agenda.for_date ? ` for ${formatDate(d.agenda.for_date)}` : ''}`, '', d.agenda.body.trim())
  }

  L.push('', '## Inputs to attach', '- Weekly leasing report (occupancy, leased %, leads / showings / applications, move-ins and move-outs)',
    '- Delinquency / aging report', '- Open work orders and turns', '- Anything new since the last call')
  return L.join('\n')
}

/** The brief wrapped as a ready-to-paste Claude prompt. */
export function briefPrompt(d: BriefData): string {
  return [
    `You are helping me prepare for the ${d.series.display_name}${d.nextCallDate ? ` on ${formatDate(d.nextCallDate)}` : ''}. Below is a brief assembled from my tracking system, and I am attaching this week's leasing report and other stats.`,
    '',
    'Produce a full pre-call agenda I can run the call from:',
    '1. Open with the numbers from the attached reports, compared to last call (occupancy, leased %, traffic, delinquency), and call out anything that moved more than expected.',
    '2. Then go property by property: what the PM owes (with how long it has been open), what I need to decide, and what to ask about based on the reports.',
    '3. Keep every concrete item from the brief; do not invent or soften anything. Flag anything in the brief that the reports contradict.',
    '4. Finish with a short list of decisions I should be ready to make on the call.',
    'Plain text with markdown headers and dashes, one line per item, most pressing property first.',
    '',
    '---',
    '',
    briefMarkdown(d),
  ].join('\n')
}
