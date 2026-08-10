// "Actionable now" predicates — extracted from the tasks page Agenda
// view so the dashboard Today lane runs the SAME definitions of
// MINE / AWAKE / UNBLOCKED (one implementation, never a fork):
//
//   mine      — unassigned or assigned to me (solo-operator default:
//               an unowned task is my task)
//   awake     — not snoozed, or the snooze date has arrived
//   unblocked — no blocker, or the blocker is gone/done (a dangling
//               blocker id never blocks — same rule the row chip uses)
//
// Pure, no fetching: callers pass today (local yyyy-MM-dd) and a
// task-by-id lookup built from whatever list they already hold.

import type { Task } from '@/lib/supabase/types'

export function isMine(t: Pick<Task, 'assigned_to'>, userId: string | null): boolean {
  return !t.assigned_to || t.assigned_to === userId
}

export function isAwake(t: Pick<Task, 'snoozed_until'>, today: string): boolean {
  return !t.snoozed_until || t.snoozed_until <= today
}

export function isUnblocked(
  t: Pick<Task, 'blocked_by_task_id'>,
  taskById: ReadonlyMap<string, Pick<Task, 'status'>>
): boolean {
  if (!t.blocked_by_task_id) return true
  const blocker = taskById.get(t.blocked_by_task_id)
  return !blocker || blocker.status === 'done'
}
