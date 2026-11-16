// Server-side recap assembly for the automatic Gmail draft. Called by the
// ingest route right after extraction: when the call belongs to a series
// with recap_auto on, returns the recap (subject / text / html) for the
// Apps Script to turn into a Gmail draft. Includes EVERY extracted action
// item (Nick deletes what he doesn't want in Gmail) and — only when the
// series has recap_carryover on — the still-open tasks carried over from
// earlier calls in the series (same rule as components/calls/carried-over).

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildRecap, type Recap, type RecapLine } from '@/lib/calls/recap'
import type { Database } from '@/lib/supabase/types'

type Client = SupabaseClient<Database>

export async function buildAutoRecap(supabase: Client, callId: string): Promise<Recap | null> {
  const { data: call } = await supabase.from('calls')
    .select('id, title, call_date, series_id, pmc_id, recap_status').eq('id', callId).single()
  if (!call?.series_id || call.recap_status !== 'none') return null

  const { data: series } = await supabase.from('call_series')
    .select('display_name, recap_auto, recap_carryover').eq('id', call.series_id).single()
  if (!series?.recap_auto) return null

  let pmcName: string | null = null
  if (call.pmc_id) {
    const { data } = await supabase.from('pmcs').select('name').eq('id', call.pmc_id).single()
    pmcName = data?.name ?? null
  }

  const { data: items } = await supabase.from('call_items')
    .select('description, owner, owner_name, kind').eq('call_id', call.id)
    .eq('kind', 'action').order('sort_order')
  const lines: RecapLine[] = (items ?? []).map(i => ({ text: i.description, name: i.owner_name, owner: i.owner }))

  const carried = series.recap_carryover
    ? await loadCarried(supabase, call.series_id, call.call_date)
    : []

  if (!lines.length && !carried.length) return null
  return buildRecap({ seriesName: series.display_name, callDate: call.call_date, pmcName, items: lines, carried })
}

/** Open tasks that came out of earlier calls in the series. */
async function loadCarried(supabase: Client, seriesId: string, beforeDate: string): Promise<RecapLine[]> {
  const { data: earlier } = await supabase.from('calls')
    .select('id, call_date').eq('series_id', seriesId).lt('call_date', beforeDate)
  const callIds = (earlier ?? []).map(c => c.id)
  if (!callIds.length) return []
  const dateOf = new Map((earlier ?? []).map(c => [c.id, c.call_date]))
  const { data: items } = await supabase.from('call_items')
    .select('call_id, owner, owner_name, task_id, matched_task_id').in('call_id', callIds)
  const byTask = new Map<string, { since: string; owner: string | null; name: string | null }>()
  for (const i of items ?? []) {
    for (const tid of [i.task_id, i.matched_task_id]) {
      if (!tid) continue
      const since = dateOf.get(i.call_id) ?? ''
      const prev = byTask.get(tid)
      if (!prev || since > prev.since) byTask.set(tid, { since, owner: i.owner, name: i.owner_name ?? prev?.name ?? null })
    }
  }
  const ids = Array.from(byTask.keys())
  if (!ids.length) return []
  const { data: tasks } = await supabase.from('tasks')
    .select('id, title').in('id', ids).neq('status', 'done')
  return (tasks ?? [])
    .map(t => ({ t, m: byTask.get(t.id)! }))
    .sort((a, b) => a.m.since.localeCompare(b.m.since))
    .map(({ t, m }) => ({ text: t.title, name: m.name, owner: m.owner }))
}
