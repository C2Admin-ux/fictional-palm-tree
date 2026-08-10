// Shared finding selection for report outputs — the email builder
// (lib/inspections/report-email) and the PDF report (lib/inspections/
// report + its route) both pull their lead blocks from these selectors,
// so the two documents can never disagree about WHICH findings a PM is
// being asked to act on.

import { PRIORITY_LABELS, type ActionPriority } from '@/lib/inspections/templates'
import { daysSince, isSettled, normalizeDisposition } from '@/lib/inspections/dispositions'

// Minimal finding shape — satisfied by InspectionItem, EmailFinding and
// ReportItem.
export type SelectableFinding = {
  requires_action: boolean
  action_priority: string | null
  disposition?: string | null
  disposition_at?: string | null
}

export const PRIORITY_ORDER: Record<ActionPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

// A requires_action item with an unknown/null priority reads as medium —
// the same default the score deduction uses.
export function itemPriority(item: { action_priority: string | null }): ActionPriority {
  const p = item.action_priority
  return p && p in PRIORITY_LABELS ? p as ActionPriority : 'medium'
}

// ACTION ITEMS recap: follow-ups still outstanding — requires_action
// minus settled (accepted/resolved) findings, highest priority first. A
// resolved follow-up stays in the grouped findings listing but must not
// read as something the PM still owes.
export function selectActionItems<T extends SelectableFinding>(items: T[]): T[] {
  return items
    .filter(i => i.requires_action && !isSettled(i.disposition))
    .sort((a, b) => PRIORITY_ORDER[itemPriority(a)] - PRIORITY_ORDER[itemPriority(b)])
}

// "Flagged for your action": findings triaged 'flagged' — the verb for
// "the PM must act on this" (observations included; flagging IS the ask).
// Priority first, then oldest flag first (the ones waiting longest
// deserve the top).
export function selectFlagged<T extends SelectableFinding>(items: T[]): T[] {
  return items
    .filter(i => normalizeDisposition(i.disposition) === 'flagged')
    .sort((a, b) =>
      (PRIORITY_ORDER[itemPriority(a)] - PRIORITY_ORDER[itemPriority(b)])
      || ((daysSince(b.disposition_at) ?? 0) - (daysSince(a.disposition_at) ?? 0)))
}

// "flagged 4d ago" / "flagged today" — one phrasing across email + PDF.
export function flaggedAgeLabel(item: { disposition_at?: string | null }): string {
  const d = daysSince(item.disposition_at)
  return d == null ? 'flagged' : d === 0 ? 'flagged today' : `flagged ${d}d ago`
}
