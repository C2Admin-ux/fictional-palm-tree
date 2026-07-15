import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isCronRequest, unauthorized } from '@/lib/api-auth'
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
const LEAD_DAYS = 120

const INSURANCE_SOURCE = 'insurance_expiry'
const CONTRACT_SOURCE = 'contract_deadline'

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

    // ── 1. Load source records + all existing auto-tasks ──────
    const [policiesRes, contractsRes, tasksRes] = await Promise.all([
      supabase.from('insurance_policies')
        .select('*')
        .eq('status', 'active')
        .lte('expiry_date', addDays(today, LEAD_DAYS)),
      supabase.from('contracts')
        .select('*')
        .eq('status', 'active'),
      supabase.from('tasks')
        .select('*')
        .in('auto_source', [INSURANCE_SOURCE, CONTRACT_SOURCE]),
    ])
    if (policiesRes.error) throw policiesRes.error
    if (contractsRes.error) throw contractsRes.error
    if (tasksRes.error) throw tasksRes.error

    // ── 2. Compute the desired state ───────────────────────────
    const desired: DesiredTask[] = [
      ...(policiesRes.data ?? []).map(p => desiredInsuranceTask(p, today)),
      ...(contractsRes.data ?? [])
        .map(c => desiredContractTask(c, today))
        .filter((d): d is DesiredTask => d !== null),
    ]
    const desiredByKey = new Map(desired.map(d => [taskKey(d), d]))

    // Existing auto-tasks grouped by (auto_source, source_record_id).
    const pendingByKey = new Map<string, Task>()
    const doneByKey = new Map<string, Task[]>()
    for (const t of tasksRes.data ?? []) {
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

function desiredContractTask(contract: Contract, today: string): DesiredTask | null {
  // Cancel window is the actionable deadline when present; otherwise the
  // contract's expiration. Both surface LEAD_DAYS (120d) ahead.
  const deadline = contract.cancel_deadline ?? contract.expiration_date
  if (!deadline) return null
  if (deadline > addDays(today, LEAD_DAYS)) return null

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
