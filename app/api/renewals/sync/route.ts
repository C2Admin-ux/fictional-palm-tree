import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isCronRequest, getSessionUser, unauthorized } from '@/lib/api-auth'
import { RENEWAL_SOURCE, RENEWAL_RATE_SOURCE } from '@/lib/tasks/vocab'
import { autoResolveTask, wasAutoResolved } from '@/lib/tasks/auto-resolve'
import {
  cadenceOf, horizonMonths, cycleDueDate, chaseTitle, chaseDescription,
  chasePriority, isOverdue, daysLate, addMonths, monthStart,
  lastClosedMonth, rateTaskTitle, rateTaskDescription, rateTaskDueDate,
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
//   3. CHASE    — one task per PROPERTY per overdue MONTH
//      (source_record_id = cycle id) — Nick's explicit shape, matching
//      the P&L and rate-entry cadence. Marking that month's offers
//      received auto-resolves its task; a hand-closed task for the
//      same month is never resurrected.
//   4. RATES    — one entry task per property when a month closes with
//      no renewal_rate entered (source_record_id = cycle id; per
//      property by Nick's explicit choice — PMs report at different
//      times). Entering the rate auto-resolves it.
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
  rateTasksCreated: number
  rateTasksResolved: number
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
      rateTasksCreated: 0, rateTasksResolved: 0,
    }

    // ── Load (bounded — see FETCH_FLOOR_MONTHS) ────────────────
    const [propertiesRes, settingsRes, cyclesRes, tasksRes] = await Promise.all([
      supabase.from('properties').select('id, name, status').eq('status', 'active'),
      supabase.from('renewal_settings').select('*'),
      supabase.from('renewal_cycles').select('*').gte('expiration_month', floor),
      supabase.from('tasks').select('*')
        .in('auto_source', [RENEWAL_SOURCE, RENEWAL_RATE_SOURCE])
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
    // The last CLOSED month rides along with the forward horizon: the
    // rate-entry pass (step 4) needs its rows to exist, and history
    // seeded by hand doesn't cover every property.
    const existing = new Set(cycles.map(c => `${c.property_id}|${c.expiration_month}`))
    const months = [lastClosedMonth(today), ...horizonMonths(today)]
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

    // ── 3. Reconcile chase tasks (one per property per month) ──
    const propertyName = new Map(properties.map(p => [p.id, p.name]))
    const pendingChaseByCycle = new Map<string, Task>()
    const doneChaseByCycle = new Map<string, Task[]>()
    const pendingRateByCycle = new Map<string, Task>()
    const doneRateByCycle = new Map<string, Task[]>()
    const supersededChases: Task[] = []
    const cycleIds = new Set(cycles.map(c => c.id))
    for (const t of tasksRes.data ?? []) {
      if (!t.source_record_id) continue
      // Chase tasks from before 2026-08-16 were keyed one-per-property
      // (source_record_id = property id, covering several months).
      // They can't reconcile against the per-month shape — retire them
      // below rather than leaving them to double what this pass creates.
      if (t.auto_source === RENEWAL_SOURCE && !cycleIds.has(t.source_record_id)) {
        if (t.status !== 'done') supersededChases.push(t)
        continue
      }
      const [pending, done] = t.auto_source === RENEWAL_RATE_SOURCE
        ? [pendingRateByCycle, doneRateByCycle]
        : [pendingChaseByCycle, doneChaseByCycle]
      if (t.status === 'done') {
        const list = done.get(t.source_record_id) ?? []
        list.push(t)
        done.set(t.source_record_id, list)
      } else {
        pending.set(t.source_record_id, t)
      }
    }

    for (const stale of supersededChases) {
      const { error } = await autoResolveTask(supabase, stale, 'superseded by per-month chase tasks')
      if (error) throw error
      counts.chasesResolved++
    }

    // This run's chaseable cycles. Only months that can still be acted
    // on: an expiration month already behind us can't get offers anymore
    // — it shows as a gap in the history and the rate table, not in a
    // chase email. (Closed months are loaded/generated for the rate pass
    // below, so this line is load-bearing.)
    const currentMonth = monthStart(today)
    const chaseable = new Map<string, RenewalCycle>()
    for (const cycle of cycles) {
      if (cycle.expiration_month < currentMonth) continue
      const cadence = cadenceOf(settingsByProperty.get(cycle.property_id))
      if (!cadence.enabled || !propertyName.has(cycle.property_id)) continue
      if (!isOverdue(cycle, today)) continue
      chaseable.set(cycle.id, cycle)
    }

    // Pending chases whose month is no longer owed → resolve.
    for (const [cycleId, pending] of Array.from(pendingChaseByCycle.entries())) {
      if (chaseable.has(cycleId)) continue
      const { error } = await autoResolveTask(supabase, pending, 'offers received / no longer overdue')
      if (error) throw error
      counts.chasesResolved++
    }

    // Months owed → create or refresh each month's chase task.
    for (const cycle of Array.from(chaseable.values())) {
      const name = propertyName.get(cycle.property_id)!
      const title = chaseTitle(cycle, name)
      const description = chaseDescription(cycle, today)
      const priority = chasePriority(daysLate(cycle, today))

      const pending = pendingChaseByCycle.get(cycle.id)
      if (pending) {
        // Refresh escalation (and the lateness line in the description).
        const changed = pending.priority !== priority
          || pending.title !== title
          || pending.due_date !== cycle.due_date
          || pending.description !== description
        if (changed) {
          const { error } = await supabase.from('tasks')
            .update({ priority, title, due_date: cycle.due_date, description })
            .eq('id', pending.id)
          if (error) throw error
          counts.chasesUpdated++
        } else {
          counts.chasesUnchanged++
        }
        continue
      }

      // A done task for this month that a PERSON closed stays closed —
      // "I dealt with this by phone" must not resurrect every night. A
      // machine-closed one may recreate: its close reason (offers
      // received) was undone, so the close no longer describes the
      // world. A hand-DELETED task recreates by design: the row is
      // gone, and the task explains itself as auto-managed.
      const handClosedTwin = (doneChaseByCycle.get(cycle.id) ?? []).some(t => !wasAutoResolved(t))
      if (handClosedTwin) {
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
      // task exists either way.
      if (created?.id) {
        await supabase.from('renewal_cycles')
          .update({ chase_task_id: created.id })
          .eq('id', cycle.id)
      }
    }

    // ── 4. Renewal-rate entry tasks ────────────────────────────
    // Resolve first: a pending entry task closes the moment its cycle
    // has a rate — regardless of which month it was for.
    const cycleById = new Map(cycles.map(c => [c.id, c]))
    for (const [cycleId, pending] of Array.from(pendingRateByCycle.entries())) {
      const cycle = cycleById.get(cycleId)
      if (!cycle || cycle.renewal_rate == null) continue
      const { error } = await autoResolveTask(supabase, pending, 'rate entered')
      if (error) throw error
      counts.rateTasksResolved++
    }

    // Create for the most recent closed month only — never for the
    // seeded back-history (a first run must not dump a year of entry
    // tasks; older gaps are visible as blanks in the rate table).
    const entryMonth = lastClosedMonth(today)
    for (const cycle of cycles) {
      if (cycle.expiration_month !== entryMonth || cycle.renewal_rate != null) continue
      const cadence = cadenceOf(settingsByProperty.get(cycle.property_id))
      const name = propertyName.get(cycle.property_id)
      if (!cadence.enabled || !name) continue
      if (pendingRateByCycle.has(cycle.id)) continue
      // A hand-closed entry task means "not entering this one" — final.
      // A machine-closed one only exists if the rate was entered then
      // cleared; recreating is correct.
      const handClosed = (doneRateByCycle.get(cycle.id) ?? []).some(t => !wasAutoResolved(t))
      if (handClosed) continue

      const due = rateTaskDueDate(cycle.expiration_month)
      const { error } = await supabase.from('tasks').insert({
        title: rateTaskTitle(cycle.expiration_month, name),
        description: rateTaskDescription(cycle.expiration_month, name),
        property_id: cycle.property_id,
        due_date: due,
        priority: 'medium',
        status: 'next_action',
        auto_source: RENEWAL_RATE_SOURCE,
        source_record_id: cycle.id,
      })
      if (error) throw error
      counts.rateTasksCreated++
    }

    return NextResponse.json({ success: true, ...counts })
  } catch (err) {
    console.error('Renewal sync failed:', err)
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Renewal sync failed', detail }, { status: 500 })
  }
}
