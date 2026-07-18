// Shared style/label maps for the Calls module (list page, detail page,
// agenda). Same badge grammar as the rest of the app: slate neutrals,
// traffic-light accents.

import type { CallItem } from '@/lib/supabase/types'

export const CALL_STATUS_STYLES: Record<string, string> = {
  draft:     'text-amber-700 bg-amber-50 border-amber-200',
  processed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
}

export const CALL_STATUS_LABELS: Record<string, string> = {
  draft:     'Draft',
  processed: 'Processed',
}

export const CALL_SOURCE_LABELS: Record<string, string> = {
  paste: 'Pasted',
  email: 'Email',
}

// Kind chips: action blue, update slate, issue amber, decision violet.
export const CALL_ITEM_KIND_STYLES: Record<CallItem['kind'], string> = {
  action:   'text-blue-700 bg-blue-50 border-blue-200',
  update:   'text-slate-600 bg-slate-50 border-slate-200',
  issue:    'text-amber-700 bg-amber-50 border-amber-200',
  decision: 'text-violet-700 bg-violet-50 border-violet-200',
}

export const CALL_ITEM_KIND_LABELS: Record<CallItem['kind'], string> = {
  action:   'Action',
  update:   'Update',
  issue:    'Issue',
  decision: 'Decision',
}

export const CALL_ITEM_KINDS = ['action', 'update', 'issue', 'decision'] as const

export const CALL_OWNER_LABELS: Record<string, string> = {
  pm:    'PM',
  owner: 'Owner',
}
