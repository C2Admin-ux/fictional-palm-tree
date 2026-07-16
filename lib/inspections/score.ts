import type { ActionPriority } from '@/lib/inspections/templates'

// Inspection scoring — pure functions, importable server-side (PDF report,
// send email) and client-side (list/property pages) so a score can never
// disagree with itself across surfaces.
//
// Score = 100 minus a deduction per finding flagged requires_action,
// weighted by priority, floored at 0. Findings without a follow-up flag
// cost nothing — they're observations, not problems.

export const SCORE_DEDUCTIONS: Record<ActionPriority, number> = {
  urgent: 15,
  high: 10,
  medium: 5,
  low: 2,
}

// A requires_action item with an unknown/null priority deducts as medium.
export const DEFAULT_DEDUCTION = SCORE_DEDUCTIONS.medium

// Minimal item shape — satisfied by InspectionItem and the lighter
// embedded selects list pages fetch.
export type ScorableItem = { requires_action: boolean; action_priority: string | null }

export function inspectionScore(items: ScorableItem[]): number {
  const deducted = items.reduce((sum, it) => {
    if (!it.requires_action) return sum
    return sum + (SCORE_DEDUCTIONS[it.action_priority as ActionPriority] ?? DEFAULT_DEDUCTION)
  }, 0)
  return Math.max(0, 100 - deducted)
}

export type ScoreGrade = 'A' | 'B' | 'C' | 'D' | 'F'

export function scoreGrade(score: number): ScoreGrade {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

// Grade colors follow the app's emerald/amber/red traffic-light convention.
// Badge classes for UI surfaces…
export const GRADE_STYLES: Record<ScoreGrade, string> = {
  A: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  B: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  C: 'text-amber-700 bg-amber-50 border-amber-200',
  D: 'text-amber-700 bg-amber-50 border-amber-200',
  F: 'text-red-700 bg-red-50 border-red-200',
}

// …and raw hex for surfaces Tailwind can't reach (PDF report, email HTML).
export const GRADE_HEX: Record<ScoreGrade, string> = {
  A: '#059669', // emerald-600
  B: '#059669',
  C: '#d97706', // amber-600
  D: '#d97706',
  F: '#dc2626', // red-600
}
