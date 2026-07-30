import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isCronRequest, unauthorized } from '@/lib/api-auth'
import { CONTRACT_SOURCE, INSURANCE_SOURCE, OBLIGATION_SOURCES, SEASONAL_BID_SOURCES } from '@/lib/tasks/vocab'
import {
  OBLIGATION_LEAD_DAYS_KEY, SEASONS, contractResolvesSeasonalTask,
  parseLeadDaysSetting, resolveSeasonConfig, seasonDueDate, seasonYearOf,
  seasonalPriority, seasonalTitle,
} from '@/lib/tasks/seasonal'
import type { Contract, Database, InsurancePolicy, Task } from '@/lib/supabase/types'

// ────────────────────────────────────────────────────────────
// OBLIGATIONS ENGINE — nightly task auto-generation (Sprint 5)
//
// BACK ON as of this change: the nightly cron is restored in vercel.json
// ({ "path": "/api/tasks/expiration", "schedule": "0 6 * * *" } — 6am UTC).
// The old DB RPC `create_expiration_tasks` is no longer called; the sync
// logic now lives here, in version-controlled TypeScript.
//
// This route is an idempotent two-way SYNC between source records
// (insurance_policies, contracts) and their auto-generated tasks, keyed by
// (auto_source, source_record_id):
//   • qualifying record without a pending task  → create task
//   • deadline/priority/title drifted           → update the pending task
//   • record renewed/closed but task pending    → auto-resolve (mark done)
//   • done tasks are never touched; a NEW future deadline on the same
//     record (renewal cycle) correctly gets a fresh task
//
// NOTE (carried over from the pre-hold route): the deleted cron also used
// to clear expired task snoozes (update tasks set snoozed_until=null where
// snoozed_until <= today). Nothing does that today — harmless while no view
// filters on snoozed_until, but if snooze-hiding is ever built, recreate
// that step here.
// ────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

// Lead time before a deadline that an obligation task appears. 120 days for
// both insurance expirations and contract cancellations/expirations, so Nick
// has runway to shop replacements. Priority still escalates as it nears.
// Overridable via the global 'obligation_lead_days' alert_settings row
// (Settings → Alerts); this constant is the fallback.
const DEFAULT_LEAD_DAYS = 120

// What the sync wants a task to look like for one qualifying source record.
type DesiredTask = {
  auto_source: string
  source_record_id: string
  title: string
  property_id: string | null
  due_date: string // YYYY-MM-DD
  priority: Task['priority']
}

type Counts = { created: number; updated: number; resolved: number; unchanged: number }

export async function GET(req: NextRequest) {
  // Vercel Cron / server-to-server only; fail closed (see lib/api-auth.ts).
  if (!isCronRequest(req)) return unauthorized()

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    const today = new Date().toISOString().slice(0, 10)

    // ── 0. Load alert_settings overrides (one query per run) ──
    // Feeds the insurance query's lead window below, so it loads first.
    // Settings must never take the cron down: a failed load (e.g. the 0007
    // migration not applied yet) logs and runs on code defaults, and every
    // value is parsed defensively in lib/tasks/seasonal.ts.
    let alertSettings: { property_id: string | null; setting_key: string; value: unknown }[] = []
    {
      const res = await supabase.from('alert_settings').select('property_id, setting_key, value')
      if (res.error) console.error('alert_settings load failed; using code defaults:', res.error.message)
      else alertSettings = res.data
    }
    const globalSetting = (key: string) =>
      alertSettings.find(s => s.setting_key === key && s.property_id === null)?.value
    const propertySetting = (key: string, propertyId: string) =>
      alertSettings.find(s => s.setting_key === key && s.property_id === propertyId)?.value
    const leadDays = parseLeadDaysSetting(globalSetting(OBLIGATION_LEAD_DAYS_KEY)) ?? DEFAULT_LEAD_DAYS

    // ── 1. Load source records + all existing auto-tasks ──────
    const [policiesRes, contractsRes, tasksRes, propertiesRes] = await Promise.all([
      supabase.from('insurance_policies')
        .select('*')
        .eq('status', 'active')
        .lte('expiry_date', addDays(today, leadDays)),
      supabase.from('contracts')
        .select('*')
        .eq('status', 'active'),
      supabase.from('tasks')
        .select('*')
        .in('auto_source', OBLIGATION_SOURCES),
      supabase.from('properties')
        .select('id, name, status')
        .eq('status', 'active'),
    ])
    if (policiesRes.error) throw policiesRes.error
    if (contractsRes.error) throw contractsRes.error
    if (tasksRes.error) throw tasksRes.error
    if (propertiesRes.error) throw propertiesRes.error

    // ── 2. Compute the desired state ───────────────────────────
    const desired: DesiredTask[] = [
      ...(policiesRes.data ?? []).map(p => desiredInsuranceTask(p, today)),
      ...(contractsRes.data ?? [])
        .map(c => desiredContractTask(c, today, leadDays))
        .filter((d): d is DesiredTask => d !== null),
    ]
    const desiredByKey = new Map(desired.map(d => [taskKey(d), d]))

    // Existing auto-tasks grouped by (auto_source, source_record_id).
    // Seasonal bid tasks are keyed differently (their season YEAR matters,
    // and they resolve on a signed contract, not on the source record
    // changing) so they're split out and reconciled in step 4 — they must
    // NOT enter pendingByKey or the generic resolve loop would close them.
    const pendingByKey = new Map<string, Task>()
    const doneByKey = new Map<string, Task[]>()
    const seasonalTasks: Task[] = []
    for (const t of tasksRes.data ?? []) {
      if (t.auto_source != null && SEASONAL_BID_SOURCES.includes(t.auto_source)) {
        seasonalTasks.push(t)
        continue
      }
      if (t.status === 'done') {
        const list = doneByKey.get(taskKey(t)) ?? []
        list.push(t)
        doneByKey.set(taskKey(t), list)
      } else {
        pendingByKey.set(taskKey(t), t)
      }
    }

    // ── 3. Reconcile ───────────────────────────────────────────
    const counts: Counts = { created: 0, updated: 0, resolved: 0, unchanged: 0 }
    const createdTitles: string[] = []

    for (const d of desired) {
      const key = taskKey(d)
      const pending = pendingByKey.get(key)

      if (pending) {
        // Pending task exists → refresh due_date / priority / title if drifted.
        const changed =
          pending.due_date !== d.due_date ||
          pending.priority !== d.priority ||
          pending.title !== d.title
        if (changed) {
          const { error } = await supabase.from('tasks')
            .update({ due_date: d.due_date, priority: d.priority, title: d.title })
            .eq('id', pending.id)
          if (error) throw error
          counts.updated++
        } else {
          counts.unchanged++
        }
        continue
      }

      // No pending task. A done task for the same key with the SAME deadline
      // means the obligation was already handled — never recreate it. A done
      // task with a DIFFERENT (older) deadline means the record rolled into a
      // new cycle, so a fresh task is correct.
      const doneTwin = (doneByKey.get(key) ?? []).some(t => t.due_date === d.due_date)
      if (doneTwin) {
        counts.unchanged++
        continue
      }

      const { error } = await supabase.from('tasks').insert({
        title: d.title,
        property_id: d.property_id,
        due_date: d.due_date,
        priority: d.priority,
        status: 'next_action',
        auto_source: d.auto_source,
        source_record_id: d.source_record_id,
      })
      if (error) throw error
      counts.created++
      createdTitles.push(d.title)
    }

    // Pending auto-tasks whose source record no longer qualifies (renewed:
    // deadline moved out of window; or status no longer active) → resolve.
    for (const [key, pending] of Array.from(pendingByKey.entries())) {
      if (desiredByKey.has(key)) continue
      const description = [pending.description, '(auto-resolved: record renewed/closed)']
        .filter(Boolean).join('\n')
      const { error } = await supabase.from('tasks')
        .update({ status: 'done', completed_at: new Date().toISOString(), description })
        .eq('id', pending.id)
      if (error) throw error
      counts.resolved++
    }

    // ── 4. Seasonal bid cycles (snow removal / landscaping) ────
    // Calendar-driven, not record-driven: inside each season's creation
    // window every ACTIVE property gets a "gather bids" task, deduped per
    // (auto_source, property, season year) — the year lives in due_date,
    // so next year's cycle gets a fresh task and a done task never blocks
    // it. Open tasks escalate as the due date nears, and auto-resolve when
    // the property gains an active contract of the matching type that
    // postdates the task (the bid cycle concluded in a signed contract).
    // Done tasks are never touched. All logic in lib/tasks/seasonal.ts.
    //
    // Windows resolve per property from alert_settings (property row →
    // global row → code defaults). enabled=false at the property level
    // skips that property (e.g. in-house snow removal); at the global
    // level it stops CREATION for the whole cycle — existing open tasks
    // still escalate and auto-resolve below either way.
    const activeContracts = contractsRes.data ?? []

    for (const spec of SEASONS) {
      const globalValue = globalSetting(spec.setting_key)

      for (const prop of propertiesRes.data ?? []) {
        const cfg = resolveSeasonConfig(spec, globalValue, propertySetting(spec.setting_key, prop.id))
        if (!cfg.enabled) continue
        const dueDate = seasonDueDate(cfg, today) // null outside the creation window
        if (!dueDate) continue
        const seasonYear = seasonYearOf(dueDate)

        // Any task (open OR done) for this source + property + season year
        // means the cycle already exists / was handled — never recreate.
        // Keyed on the due date's YEAR (= window start's year, enforced in
        // parseSeasonSetting), so moving a window mid-season updates
        // nothing retroactively and never duplicates the year's task.
        const exists = seasonalTasks.some(t =>
          t.auto_source === spec.auto_source &&
          t.source_record_id === prop.id &&
          t.due_date != null && seasonYearOf(t.due_date) === seasonYear
        )
        if (exists) continue

        const { error } = await supabase.from('tasks').insert({
          title: seasonalTitle(spec, prop.name),
          property_id: prop.id,
          due_date: dueDate,
          priority: seasonalPriority(today, dueDate),
          status: 'next_action',
          auto_source: spec.auto_source,
          source_record_id: prop.id,
        })
        if (error) throw error
        counts.created++
        createdTitles.push(seasonalTitle(spec, prop.name))
      }
    }

    // Reconcile OPEN seasonal tasks (any season year, year-round):
    // auto-resolve on a matching signed contract, else refresh escalation.
    // due_date is never rewritten — it carries the season-year key.
    const propNameById = new Map((propertiesRes.data ?? []).map(p => [p.id, p.name]))
    for (const t of seasonalTasks) {
      if (t.status === 'done') continue
      const spec = SEASONS.find(s => s.auto_source === t.auto_source)
      if (!spec) continue

      const signed = activeContracts.some(c => contractResolvesSeasonalTask(c, t, spec))
      if (signed) {
        const description = [t.description, `(auto-resolved: ${spec.label} contract signed for the season)`]
          .filter(Boolean).join('\n')
        const { error } = await supabase.from('tasks')
          .update({ status: 'done', completed_at: new Date().toISOString(), description })
          .eq('id', t.id)
        if (error) throw error
        counts.resolved++
        continue
      }

      const propName = t.source_record_id != null ? propNameById.get(t.source_record_id) : undefined
      const wantTitle = propName ? seasonalTitle(spec, propName) : t.title
      const wantPriority = t.due_date ? seasonalPriority(today, t.due_date) : t.priority
      if (t.priority !== wantPriority || t.title !== wantTitle) {
        const { error } = await supabase.from('tasks')
          .update({ priority: wantPriority, title: wantTitle })
          .eq('id', t.id)
        if (error) throw error
        counts.updated++
      } else {
        counts.unchanged++
      }
    }

    return NextResponse.json({
      success: true,
      counts,
      created_titles: createdTitles,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('Expiration task sync failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ── Desired-state builders ───────────────────────────────────

function desiredInsuranceTask(policy: InsurancePolicy, today: string): DesiredTask {
  const days = daysBetween(today, policy.expiry_date)
  return {
    auto_source: INSURANCE_SOURCE,
    source_record_id: policy.id,
    title: `Renew insurance: ${policy.carrier} ${policy.policy_type} — expires ${policy.expiry_date}`,
    property_id: policy.property_id,
    due_date: policy.expiry_date,
    // Escalates as the expiry approaches; recomputed on every run.
    priority: days > 60 ? 'medium' : days > 30 ? 'high' : 'urgent',
  }
}

function desiredContractTask(contract: Contract, today: string, leadDays: number): DesiredTask | null {
  // Cancel window is the actionable deadline when present; otherwise the
  // contract's expiration. Both surface leadDays (default 120d) ahead.
  const deadline = contract.cancel_deadline ?? contract.expiration_date
  if (!deadline) return null
  if (deadline > addDays(today, leadDays)) return null

  const days = daysBetween(today, deadline)
  const kind = contract.cancel_deadline ? 'cancel window' : 'expiration'
  return {
    auto_source: CONTRACT_SOURCE,
    source_record_id: contract.id,
    title: `Contract ${kind}: ${contract.vendor_name} — ${contract.title}`,
    property_id: contract.property_id,
    due_date: deadline,
    priority: days <= 14 ? 'urgent' : days <= 30 ? 'high' : 'medium',
  }
}

// ── Helpers ──────────────────────────────────────────────────

function taskKey(t: { auto_source: string | null; source_record_id: string | null }): string {
  return `${t.auto_source}:${t.source_record_id}`
}

/** Whole days from date-only string `from` to `to` (UTC; negative if past). */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)
}

/** Date-only string `days` after date-only string `date`. */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10)
}
