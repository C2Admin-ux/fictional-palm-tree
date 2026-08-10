// Finding disposition vocabulary (see 0011_finding_dispositions.sql) —
// the triage verb every inspection finding carries. Pure constants +
// helpers, importable server-side (email builder, report) and client-side
// (triage UI, chips) so the vocabulary can never disagree with itself.
//
// A disposition NEVER hides a finding — findings stay reviewable forever;
// the verb records how the risk is being managed:
//   open     — default / untriaged (drains the triage counter)
//   watch    — deliberate deferral: re-confirm on the next walk
//   flagged  — needs the PM's attention (surfaces in the report email
//              and on the call agenda until communicated/resolved)
//   task     — spawned an internal task (inspection_items.task_id)
//   capex    — rolled into a capital project (capex_project_id)
//   accepted — known condition, living with it (note required in the UI)
//   resolved — fixed / verified gone (never "closed" in UI copy)

export const DISPOSITIONS = ['open', 'watch', 'flagged', 'task', 'capex', 'accepted', 'resolved'] as const
export type Disposition = (typeof DISPOSITIONS)[number]

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  open: 'Untriaged',
  watch: 'Watch',
  flagged: 'Flagged',
  task: 'Task',
  capex: 'CapEx',
  accepted: 'Accepted',
  resolved: 'Resolved',
}

// Chip tones per the owner's spec: watch amber-outline, flagged
// red-outline, task blue, capex orange, accepted quiet slate, resolved
// emerald. 'open' renders no chip (untriaged is the absence of a verb).
export const DISPOSITION_CHIP_STYLES: Record<Disposition, string> = {
  open: 'text-slate-500 bg-white border-slate-300',
  watch: 'text-amber-700 bg-white border-amber-400',
  flagged: 'text-red-700 bg-white border-red-400',
  task: 'text-blue-700 bg-blue-50 border-blue-200',
  capex: 'text-orange-700 bg-orange-50 border-orange-200',
  accepted: 'text-slate-500 bg-slate-50 border-slate-200',
  resolved: 'text-emerald-700 bg-emerald-50 border-emerald-200',
}

// Rows written before 0011 (or by defensive fallbacks) read as untriaged.
export function normalizeDisposition(value: string | null | undefined): Disposition {
  return (DISPOSITIONS as readonly string[]).includes(value ?? '') ? value as Disposition : 'open'
}

// Settled dispositions: the risk is no longer outstanding — either a
// deliberate decision to live with it (accepted) or verified gone
// (resolved). Settled findings stay reviewable forever; they just stop
// counting as open.
export const SETTLED_DISPOSITIONS = ['accepted', 'resolved'] as const

export function isSettled(value: string | null | undefined): boolean {
  return (SETTLED_DISPOSITIONS as readonly string[]).includes(normalizeDisposition(value))
}

// THE canonical "open finding" rule — every rollup (inspections list
// badge, property Overview card, property Inspections tab, filter chips)
// counts with this one predicate so the buckets can never drift:
//
//   open finding = NOT settled AND (requires_action OR triaged)
//
// An untriaged pure observation (requires_action false, disposition
// 'open') is NOT an open finding — it's a note, not a problem. Anything
// triaged to watch/flagged/task/capex counts regardless of
// requires_action: assigning a verb is a statement that the finding is
// outstanding and being managed.
export function isOpenFinding(item: { requires_action: boolean; disposition?: string | null }): boolean {
  const d = normalizeDisposition(item.disposition)
  return !isSettled(d) && (item.requires_action === true || d !== 'open')
}

// Server-side candidate set for open-finding queries (everything not
// settled). Pair with `.or('requires_action.eq.true,disposition.neq.open')`
// — or client-side isOpenFinding — to complete the rule above.
export const UNSETTLED_DISPOSITIONS = ['open', 'watch', 'flagged', 'task', 'capex'] as const

// Whole days since a timestamp — drives "flagged Nd" / "communicated Nd
// ago" aging on chips, the agenda, and the report email.
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return Number.isFinite(days) ? Math.max(0, days) : null
}
