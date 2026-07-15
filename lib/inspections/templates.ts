// Rough section templates for onsite inspections. These are deliberate
// code constants (no DB, no template editor): sections are chips Nick taps
// between freely while walking a property — capture follows how he walks,
// the template never forces an order. Duplicable sections get one chip
// instance per unit (e.g. "Vacant Unit · 204").

export type InspectionType = 'site_visit' | 'annual'

export type TemplateSection = { name: string; duplicable?: boolean }

// Regular walk-through.
export const SITE_VISIT_SECTIONS: TemplateSection[] = [
  { name: 'Exterior & Grounds' },
  { name: 'Roof' },
  { name: 'Common Areas' },
  { name: 'Mechanical / Boiler Room' },
  { name: 'Laundry' },
  { name: 'Vacant Unit', duplicable: true },
  { name: 'Occupied Unit', duplicable: true },
  { name: 'Office / Leasing' },
  { name: 'Other' },
]

// Comprehensive annual: everything in a site visit plus the deeper systems
// walk. "Other" stays last as the catch-all.
export const ANNUAL_SECTIONS: TemplateSection[] = [
  ...SITE_VISIT_SECTIONS.filter(s => s.name !== 'Other'),
  { name: 'Electrical / Panels' },
  { name: 'Plumbing' },
  { name: 'Life Safety (extinguishers, egress, detectors)' },
  { name: 'Parking / Asphalt' },
  { name: 'Signage & Lighting' },
  { name: 'Landscaping / Irrigation' },
  { name: 'Building Exterior', duplicable: true },
  { name: 'Other' },
]

export const TEMPLATE_SECTIONS: Record<InspectionType, TemplateSection[]> = {
  site_visit: SITE_VISIT_SECTIONS,
  annual: ANNUAL_SECTIONS,
}

export const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  site_visit: 'Site Visit',
  annual: 'Annual',
}

export const INSPECTION_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  report_sent: 'Report Sent',
}

// Follow-up priorities reuse the app's task priority vocabulary
// (tasks.priority) so colors/labels stay consistent — see
// PRIORITY_STYLES / PRIORITY_DOT in lib/utils.
export const ACTION_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type ActionPriority = (typeof ACTION_PRIORITIES)[number]
