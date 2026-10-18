// "Confirm on site" write path, shared by the property findings list and
// the site-visit sheet. Confirming assumes the PM's word: the finding is
// settled and its linked task is completed. The finding then waits on the
// site-visit sheet under "Verify in person":
//   verified  -> 'resolved' (stays done)
//   not fixed -> 'flagged' and the linked task is reopened
// Every step returns the priors it changed so callers can offer Undo.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Task } from '@/lib/supabase/types'
import { normalizeDisposition, type Disposition } from '@/lib/inspections/dispositions'

type Client = SupabaseClient<Database>

export const CONFIRM_NOTE = 'PM reported fixed — verify on next site visit'

type FindingRef = { id: string; disposition: string | null; disposition_note: string | null; disposition_at: string | null }

export type ConfirmPrior = {
  finding: { disposition: Disposition; disposition_note: string | null; disposition_at: string | null }
  task: { id: string; status: Task['status']; completed_at: string | null } | null
}

async function linkedOpenTask(supabase: Client, findingId: string) {
  const { data: item } = await supabase.from('inspection_items').select('task_id').eq('id', findingId).single()
  if (!item?.task_id) return null
  const { data: task } = await supabase.from('tasks').select('id, status, completed_at').eq('id', item.task_id).single()
  return task ?? null
}

/** Mark a finding "confirm on site": settle it and complete its task. */
export async function confirmFinding(supabase: Client, f: FindingRef): Promise<{ prior: ConfirmPrior } | { error: string }> {
  const now = new Date().toISOString()
  const prior: ConfirmPrior = {
    finding: { disposition: normalizeDisposition(f.disposition), disposition_note: f.disposition_note, disposition_at: f.disposition_at },
    task: null,
  }
  const { error } = await supabase.from('inspection_items')
    .update({ disposition: 'confirm', disposition_at: now, disposition_note: f.disposition_note ?? CONFIRM_NOTE })
    .eq('id', f.id)
  if (error) return { error: error.message }

  const task = await linkedOpenTask(supabase, f.id)
  if (task && task.status !== 'done') {
    prior.task = { id: task.id, status: task.status, completed_at: task.completed_at }
    const { error: tErr } = await supabase.from('tasks')
      .update({ status: 'done', completed_at: now, updated_at: now }).eq('id', task.id)
    if (tErr) console.warn('Confirm: could not complete linked task:', tErr.message)
  }
  return { prior }
}

/** Undo a confirm: restore the finding and reopen the task if we closed it. */
export async function undoConfirm(supabase: Client, findingId: string, prior: ConfirmPrior): Promise<string | null> {
  const { error } = await supabase.from('inspection_items').update(prior.finding).eq('id', findingId)
  if (error) return error.message
  if (prior.task) {
    await supabase.from('tasks')
      .update({ status: prior.task.status, completed_at: prior.task.completed_at, updated_at: new Date().toISOString() })
      .eq('id', prior.task.id)
  }
  return null
}

/** Onsite outcome for a "confirm" finding. */
export async function verifyFinding(
  supabase: Client, f: FindingRef, outcome: 'verified' | 'not_fixed',
): Promise<{ prior: ConfirmPrior } | { error: string }> {
  const now = new Date().toISOString()
  const prior: ConfirmPrior = {
    finding: { disposition: normalizeDisposition(f.disposition), disposition_note: f.disposition_note, disposition_at: f.disposition_at },
    task: null,
  }
  if (outcome === 'verified') {
    const { error } = await supabase.from('inspection_items')
      .update({ disposition: 'resolved', disposition_at: now, disposition_note: f.disposition_note === CONFIRM_NOTE ? null : f.disposition_note })
      .eq('id', f.id)
    return error ? { error: error.message } : { prior }
  }
  // Not fixed: back to flagged (fresh communication cycle) and reopen the task.
  const { error } = await supabase.from('inspection_items')
    .update({ disposition: 'flagged', disposition_at: now, communicated_at: null, disposition_note: 'Reported fixed, found not fixed on site visit' })
    .eq('id', f.id)
  if (error) return { error: error.message }
  const task = await linkedOpenTask(supabase, f.id)
  if (task && task.status === 'done') {
    prior.task = { id: task.id, status: task.status, completed_at: task.completed_at }
    await supabase.from('tasks').update({ status: 'next_action', completed_at: null, updated_at: now }).eq('id', task.id)
  }
  return { prior }
}
