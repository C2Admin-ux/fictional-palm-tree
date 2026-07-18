// Required-coverage rules, one source of truth per rule:
//   - Insurance: every property should carry an active GL and an active
//     Property policy (insurance_policies.policy_type 'gl' / 'property').
//   - Contracts: every property should have an active trash/waste contract
//     (contracts.contract_type 'trash').
// A missing record more likely means it was never entered than that the
// property is uncovered — surfaces phrase these as amber data-hygiene
// nudges, not red errors.

import { todayISO } from '@/lib/utils'

type PropertyLike = { id: string }

// Generic shape both domains normalize into.
type RecordFacts = { property_id: string | null; type: string; status: string; expires: string | null }

/**
 * Generic core: for each property, which of `requiredTypes` lack an
 * in-force record ("in force" = status 'active' and not past expiry).
 * Portfolio-wide records (property_id null — how blanket policies and
 * portfolio contracts are entered) count as covering every property.
 */
function missingByProperty(
  properties: readonly PropertyLike[],
  records: readonly RecordFacts[],
  requiredTypes: readonly string[],
): Record<string, Set<string>> {
  const today = todayISO()
  const active = records.filter(r => r.status === 'active' && (r.expires == null || r.expires >= today))
  const blanket = new Set(active.filter(r => r.property_id == null).map(r => r.type))

  const out: Record<string, Set<string>> = {}
  for (const prop of properties) {
    const own = new Set(active.filter(r => r.property_id === prop.id).map(r => r.type))
    out[prop.id] = new Set(requiredTypes.filter(t => !blanket.has(t) && !own.has(t)))
  }
  return out
}

// ── Insurance rule ───────────────────────────────────────────────────────────

export type CoverageGap = { missingGl: boolean; missingProperty: boolean }

// Structural subset so client pages (full rows) and server components
// (narrow selects) can both call in without casting.
type PolicyLike = { property_id: string | null; policy_type: string; status: string; expiry_date: string | null }

/** Per-property insurance gaps (GL + Property policies), keyed by property id. */
export function coverageGaps(
  properties: readonly PropertyLike[],
  policies: readonly PolicyLike[],
): Record<string, CoverageGap> {
  const missing = missingByProperty(
    properties,
    policies.map(p => ({ property_id: p.property_id, type: p.policy_type, status: p.status, expires: p.expiry_date })),
    ['gl', 'property'],
  )
  const gaps: Record<string, CoverageGap> = {}
  for (const prop of properties) {
    gaps[prop.id] = { missingGl: missing[prop.id].has('gl'), missingProperty: missing[prop.id].has('property') }
  }
  return gaps
}

export function hasGap(gap: CoverageGap | undefined): boolean {
  return !!gap && (gap.missingGl || gap.missingProperty)
}

/**
 * Short label for an insurance gap — "No active GL policy", "No active
 * Property policy", "No active GL or Property policy" — or null when covered.
 */
export function describeGaps(gap: CoverageGap): string | null {
  if (gap.missingGl && gap.missingProperty) return 'No active GL or Property policy'
  if (gap.missingGl) return 'No active GL policy'
  if (gap.missingProperty) return 'No active Property policy'
  return null
}

// ── Trash-contract rule ──────────────────────────────────────────────────────

type ContractLike = { property_id: string | null; contract_type: string; status: string; expiration_date: string | null }

export const TRASH_GAP_LABEL = 'No active trash/waste contract'

/** Per-property trash-contract gaps: true when no active trash contract covers the property. */
export function trashContractGaps(
  properties: readonly PropertyLike[],
  contracts: readonly ContractLike[],
): Record<string, boolean> {
  const missing = missingByProperty(
    properties,
    contracts.map(c => ({ property_id: c.property_id, type: c.contract_type, status: c.status, expires: c.expiration_date })),
    ['trash'],
  )
  const gaps: Record<string, boolean> = {}
  for (const prop of properties) gaps[prop.id] = missing[prop.id].has('trash')
  return gaps
}
