import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isCronRequest, getSessionUser, unauthorized } from '@/lib/api-auth'
import { RENEWAL_SOURCE } from '@/lib/tasks/vocab'
import {
  cadenceOf, horizonMonths, cycleDueDate, chaseTitle, chaseDescription,
  chasePriority, isOverdue, daysLate,
} from '@/lib/renewals/cycles'
import type { Database, RenewalCycle, RenewalSetting, Task } from '@/lib/supabase/types'

// ────────────────────────────────────────────────────────────
// RENEWAL SYNC — nightly (app/api/renewals/sync, see vercel.json)
//
// Two idempotent passes:
//   1. GENERATE — every enabled property has a renewal_cycles row for the
//      current month through +6, with its due date snapshotted from that
//      property's lead_days.
//   2. CHASE    — every cycle past its due date with no offers in hand
//      gets a task, keyed (auto_source, source_record_id = cycle id).
//      Offers arriving auto-resolves the task; nothing ever reopens a
//      done one.
//
// The app tracks email traffic and never sends any of it: a chase task
// tells Nick to go write the email himself.
//
// Deliberately its own route and its own cron line rather than a branch
// of the obligations engine — that engine is PAUSED pending refinement,
// and turning it back on would dump its whole backlog. This route shares
// its reconciliation shape but none of its schedule.
// ────────────────────────────────────────────────────────────

type Counts = {
  cyclesCreated: number
  chasesCreated: number
  chasesUpdated: number
  chasesResolved: number
  chasesUnchanged: number
}

// Cron for the nightly run; a logged-in session for the board's "Sync
// now" button. Both need the service role for the writes below.
async function authorize(req: NextRequest): Promise<boolean> {
  if (isCronRequest(req)) return true
  return (await getSessionUser()) !== null
}

export async function GET(req: NextRequest) {
  if (!(await authorize(req))) return unauthorized()

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    const today = new Date().toISOString().slice(0, 10)
    const counts: Counts = {
      cyclesCreated: 0, chasesCreated: 0, chasesUpdated: 0,
      chasesResolved: 0, chasesUnchanged: 0,
    }

    // ── Load ───────────────────────────────────────────────────
    const [propertiesRes, settingsRes, cyclesRes, tasksRes] = await Promise.all([
      supabase.from('properties').select('id, name, status').eq('status', 'active'),
      supabase.from('renewal_settings').select('*'),
      supabase.from('renewal_cycles').select('*'),
      supabase.from('tasks').select('*').eq('auto_source', RENEWAL_SOURCE),
    ])
    if (propertiesRes.error) throw propertiesRes.error
    if (settingsRes.error) throw settingsRes.error
    if (cyclesRes.error) throw cyclesRes.error
    if (tasksRes.error) throw tasksRes.error

    const properties = propertiesRes.data ?? []
    const settingsByProperty = new Map(
      ((settingsRes.data ?? []) as RenewalSetting[]).map(s => [s.property_id, s]))
    const cycles = (cyclesRes.data ?? []) as RenewalCycle[]

    // ── 1. Generate missing cycles ─────────────────────────────
    // Keyed on (property, expiration_month), which the table also
    // enforces — a concurrent run loses the race harmlessly.
    const existing = new Set(cycles.map(c => `${c.property_id}|${c.expiration_month}`))
    const months = horizonMonths(today)
    const toInsert: {
      property_id: string; expiration_month: string; due_date: string
      source: 'email' | 'sheet'; source_url: string | null
    }[] = []

    for (const property of properties) {
      const cadence = cadenceOf(settingsByProperty.get(property.id))
      if (!cadence.enabled) continue
      for (const month of months) {
        if (existing.has(`${property.id}|${month}`)) continue
        toInsert.push({
          property_id: property.id,
          expiration_month: month,
          due_date: cycleDueDate(month, cadence.leadDays),
          // Snapshotted so the cycle is self-describing — the chase task
          // needs the sheet URL, and a later PM change must not rewrite
          // how an old cycle was actually run.
          source: cadence.source,
          source_url: cadence.sourceUrl,
        })
      }
    }

    if (toInsert.length > 0) {
      const { data, error } = await supabase.from('renewal_cycles')
        .insert(toInsert).select('*')
      if (error) throw error
      cycles.push(...((data ?? []) as RenewalCycle[]))
      counts.cyclesCreated = data?.length ?? 0
    }

    // ── 2. Reconcile chase tasks ───────────────────────────────
    const propertyName = new Map(properties.map(p => [p.id, p.name]))
    const pendingByCycle = new Map<string, Task>()
    const doneCycleIds = new Set<string>()
    for (const t of tasksRes.data ?? []) {
      if (!t.source_record_id) continue
      if (t.status === 'done') doneCycleIds.add(t.source_record_id)
      else pendingByCycle.set(t.source_record_id, t)
    }

    for (const cycle of cycles) {
      const cadence = cadenceOf(settingsByProperty.get(cycle.property_id))
      const name = propertyName.get(cycle.property_id)
      // A cycle whose property went inactive (or was disabled) is left
      // alone — its history stays, but it stops generating work.
      if (!name || !cadence.enabled) continue

      const pending = pendingByCycle.get(cycle.id)
      const overdue = isOverdue(cycle, today)

      if (!overdue) {
        // Offers landed (or the due date hasn't arrived). Either way there
        // is nothing to chase — close any open task.
        if (pending) {
          const reason = cycle.offer_received_at
            ? '(auto-resolved: offers received)'
            : '(auto-resolved: no longer overdue)'
          const description = [pending.description, reason].filter(Boolean).join('\n')
          const { error } = await supabase.from('tasks')
            .update({ status: 'done', completed_at: new Date().toISOString(), description })
            .eq('id', pending.id)
          if (error) throw error
          counts.chasesResolved++
        }
        continue
      }

      const title = chaseTitle(cycle, name)
      const description = chaseDescription(cycle)
      const priority = chasePriority(daysLate(cycle, today))

      if (pending) {
        // Refresh escalating priority (and the title, if a property was
        // renamed). due_date stays at the cycle's due date so the task
        // reads as overdue by the real amount on the agenda.
        const changed = pending.priority !== priority
          || pending.title !== title
          || pending.due_date !== cycle.due_date
        if (changed) {
          const { error } = await supabase.from('tasks')
            .update({ priority, title, due_date: cycle.due_date })
            .eq('id', pending.id)
          if (error) throw error
          counts.chasesUpdated++
        } else {
          counts.chasesUnchanged++
        }
        continue
      }

      // A done task for this cycle means the chase was already handled by
      // hand — never resurrect it, even if offers still aren't marked.
      if (doneCycleIds.has(cycle.id)) {
        counts.chasesUnchanged++
        continue
      }

      const { data: created, error } = await supabase.from('tasks').insert({
        title,
        description,
        property_id: cycle.property_id,
        due_date: cycle.due_date,
        priority,
        status: 'next_action',
        auto_source: RENEWAL_SOURCE,
        source_record_id: cycle.id,
      }).select('id').single()
      if (error) throw error
      counts.chasesCreated++

      // Back-link so the board can jump to the task. Best-effort: the
      // task exists either way, and a missing link is cosmetic.
      if (created?.id) {
        await supabase.from('renewal_cycles')
          .update({ chase_task_id: created.id }).eq('id', cycle.id)
      }
    }

    return NextResponse.json({ success: true, ...counts })
  } catch (err) {
    console.error('Renewal sync failed:', err)
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Renewal sync failed', detail }, { status: 500 })
  }
}
