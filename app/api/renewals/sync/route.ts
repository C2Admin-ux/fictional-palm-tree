import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isCronRequest, getSessionUser, unauthorized } from '@/lib/api-auth'
import { RENEWAL_SOURCE } from '@/lib/tasks/vocab'
import { autoResolveTask, wasAutoResolved } from '@/lib/tasks/auto-resolve'
import {
  cadenceOf, horizonMonths, cycleDueDate, chaseTitle, chaseDescription,
  chasePriority, sortChaseCycles, isOverdue, daysLate, addMonths, monthStart,
  FETCH_FLOOR_MONTHS,
} from '@/lib/renewals/cycles'
import { daysBetween } from '@/lib/utils'
import type { Database, RenewalCycle, RenewalSetting, Task } from '@/lib/supabase/types'

// ────────────────────────────────────────────────────────────
// RENEWAL SYNC — nightly (app/api/renewals/sync, see vercel.json)
//
// Three idempotent passes:
//   1. GENERATE — every enabled property has a renewal_cycles row for the
//      current month through +6, due date snapshotted from that
//      property's lead_days.
//   2. REFRESH  — cadence/source changes reach cycles that haven't run
//      yet: due_date is re-stamped on legless cycles that aren't yet due
//      (history is never rewritten once a cycle is late or has activity),
//      and source/source_url follow the settings until offers arrive.
//   3. CHASE    — one task per PROPERTY with overdue offer months
//      (source_record_id = property id), covering all months owed —
//      a chase is one email to one PM. Marking offers received
//      auto-resolves it; a hand-closed task for the same chase
//      generation is never resurrected.
//
// The app tracks email traffic and never sends any of it: a chase task
// tells Nick to go write the email himself.
//
// Deliberately its own route and its own cron line rather than a branch
// of the obligations engine — that engine is PAUSED pending refinement,
// and turning it back on would dump its whole backlog. This route shares
// its reconciliation shape (and lib/tasks/auto-resolve) but none of its
// schedule.
// ────────────────────────────────────────────────────────────

type Counts = {
  cyclesCreated: number
  cyclesRefreshed: number
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

// The server's UTC date and the user's local date disagree for a few
// evening hours. The board passes its own today (?today=YYYY-MM-DD) so a
// manual sync agrees with the screen the user is looking at; the value is
// only trusted within a day of server time — this is a clock-skew
// accommodation, not a time machine. Cron runs on the UTC date (07:00
// UTC = middle of the night in Denver, where the two dates agree).
function resolveToday(req: NextRequest): string {
  const serverToday = new Date().toISOString().slice(0, 10)
  const param = req.nextUrl.searchParams.get('today')
  if (!param || !/^\d{4}-\d{2}-\d{2}$/.test(param)) return serverToday
  return Math.abs(daysBetween(param, serverToday)) <= 1 ? param : serverToday
}

export async function GET(req: NextRequest) {
  if (!(await authorize(req))) return unauthorized()

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    const today = resolveToday(req)
    const floor = addMonths(monthStart(today), -FETCH_FLOOR_MONTHS)
    const counts: Counts = {
      cyclesCreated: 0, cyclesRefreshed: 0, chasesCreated: 0,
      chasesUpdated: 0, chasesResolved: 0, chasesUnchanged: 0,
    }

    // ── Load (bounded — see FETCH_FLOOR_MONTHS) ────────────────
    const [propertiesRes, settingsRes, cyclesRes, tasksRes] = await Promise.all([
      supabase.from('properties').select('id, name, status').eq('status', 'active'),
      supabase.from('renewal_settings').select('*'),
      supabase.from('renewal_cycles').select('*').gte('expiration_month', floor),
      supabase.from('tasks').select('*').eq('auto_source', RENEWAL_SOURCE)
        .gte('due_date', addMonths(floor, -13)),
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
          source: cadence.source,
          source_url: cadence.sourceUrl,
        })
      }
    }

    if (toInsert.length > 0) {
      // Upsert + ignoreDuplicates: a concurrent run (cron racing "Sync
      // now" on the first of a month) computes the same rows; the loser's
      // duplicates are dropped row-by-row instead of 23505-aborting the
      // whole batch and skipping the chase pass.
      const { data, error } = await supabase.from('renewal_cycles')
        .upsert(toInsert, { onConflict: 'property_id,expiration_month', ignoreDuplicates: true })
        .select('*')
      if (error) throw error
      cycles.push(...((data ?? []) as RenewalCycle[]))
      counts.cyclesCreated = data?.length ?? 0
    }

    // ── 2. Refresh unrun cycles from current settings ──────────
    // A cadence change must not sit invisible for the whole generated
    // horizon. Rules, per cycle with NO legs recorded:
    //   due_date    — re-stamped only while the cycle isn't yet late
    //                 under EITHER date (once something is overdue,
    //                 that's history; rewriting it would change whether
    //                 last quarter's offers "were late").
    //   source/url  — follow settings until offers arrive: an overdue
    //                 sheet-property cycle should chase as "review the
    //                 sheet", not as a leftover email chase.
    for (const cycle of cycles) {
      if (cycle.offer_received_at || cycle.approved_at || cycle.partner_approved_at) continue
      const cadence = cadenceOf(settingsByProperty.get(cycle.property_id))
      if (!cadence.enabled) continue

      const patch: Partial<RenewalCycle> = {}
      const wantDue = cycleDueDate(cycle.expiration_month, cadence.leadDays)
      if (wantDue !== cycle.due_date && cycle.due_date >= today && wantDue >= today) {
        patch.due_date = wantDue
      }
      if (cadence.source !== cycle.source) patch.source = cadence.source
      if ((cadence.sourceUrl ?? null) !== (cycle.source_url ?? null)) {
        patch.source_url = cadence.sourceUrl
      }
      if (Object.keys(patch).length === 0) continue

      const { error } = await supabase.from('renewal_cycles')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', cycle.id)
      if (error) throw error
      Object.assign(cycle, patch)
      counts.cyclesRefreshed++
    }

    // ── 3. Reconcile chase tasks (one per property) ────────────
    const propertyName = new Map(properties.map(p => [p.id, p.name]))
    const pendingByProperty = new Map<string, Task>()
    const doneByProperty = new Map<string, Task[]>()
    for (const t of tasksRes.data ?? []) {
      if (!t.source_record_id) continue
      if (t.status === 'done') {
        const list = doneByProperty.get(t.source_record_id) ?? []
        list.push(t)
        doneByProperty.set(t.source_record_id, list)
      } else {
        pendingByProperty.set(t.source_record_id, t)
      }
    }

    // Group this run's overdue cycles by property.
    const overdueByProperty = new Map<string, RenewalCycle[]>()
    for (const cycle of cycles) {
      const cadence = cadenceOf(settingsByProperty.get(cycle.property_id))
      if (!cadence.enabled || !propertyName.has(cycle.property_id)) continue
      if (!isOverdue(cycle, today)) continue
      const list = overdueByProperty.get(cycle.property_id) ?? []
      list.push(cycle)
      overdueByProperty.set(cycle.property_id, list)
    }

    // Properties with a pending chase but nothing overdue → resolve.
    for (const [propertyId, pending] of Array.from(pendingByProperty.entries())) {
      if (overdueByProperty.has(propertyId)) continue
      const { error } = await autoResolveTask(supabase, pending, 'offers received / no longer overdue')
      if (error) throw error
      counts.chasesResolved++
    }

    // Properties owing offers → create or refresh their chase task.
    for (const [propertyId, overdue] of Array.from(overdueByProperty.entries())) {
      const name = propertyName.get(propertyId)!
      const sorted = sortChaseCycles(overdue)
      const oldest = sorted[0]
      const title = chaseTitle(sorted, name)
      const description = chaseDescription(sorted, today)
      const priority = chasePriority(daysLate(oldest, today))

      const pending = pendingByProperty.get(propertyId)
      if (pending) {
        // Refresh as months accumulate and escalation climbs. due_date
        // pins the OLDEST overdue month so the agenda shows true age.
        const changed = pending.priority !== priority
          || pending.title !== title
          || pending.due_date !== oldest.due_date
          || pending.description !== description
        if (changed) {
          const { error } = await supabase.from('tasks')
            .update({ priority, title, due_date: oldest.due_date, description })
            .eq('id', pending.id)
          if (error) throw error
          counts.chasesUpdated++
        } else {
          counts.chasesUnchanged++
        }
        continue
      }

      // A done task for the same chase generation (same oldest-overdue
      // due date) that a PERSON closed stays closed — "I dealt with this
      // by phone" must not resurrect every night. Two things do reopen a
      // chase: a machine-closed task (its close reason — offers received
      // — was undone, so the close no longer describes the world), and a
      // NEW oldest month going overdue (a genuinely new chase). A
      // hand-DELETED task recreates by design: the row is gone, and the
      // task explains itself as auto-managed.
      const handClosedTwin = (doneByProperty.get(propertyId) ?? []).some(t =>
        t.due_date === oldest.due_date && !wasAutoResolved(t))
      if (handClosedTwin) {
        counts.chasesUnchanged++
        continue
      }

      const { data: created, error } = await supabase.from('tasks').insert({
        title,
        description,
        property_id: propertyId,
        due_date: oldest.due_date,
        priority,
        status: 'next_action',
        auto_source: RENEWAL_SOURCE,
        source_record_id: propertyId,
      }).select('id').single()
      if (error) throw error
      counts.chasesCreated++

      // Back-link every overdue cycle so the board can jump to the task.
      // Best-effort: the task exists either way.
      if (created?.id) {
        await supabase.from('renewal_cycles')
          .update({ chase_task_id: created.id })
          .in('id', sorted.map(c => c.id))
      }
    }

    return NextResponse.json({ success: true, ...counts })
  } catch (err) {
    console.error('Renewal sync failed:', err)
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Renewal sync failed', detail }, { status: 500 })
  }
}
