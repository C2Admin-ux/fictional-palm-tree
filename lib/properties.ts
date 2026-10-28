import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Property } from '@/lib/supabase/types'

// ── Property status + archive ────────────────────────────────
// One place that knows what "archived" means, so no page can forget it.
//
//   active       owned and operating — the normal state
//   watchlist    owned, being watched (excluded from capture/coverage)
//   disposition  owned, being sold (excluded from capture/coverage)
//   archived     gone — deal dropped or asset sold. Hidden from the
//                sidebar, every picker/filter, the dashboard and all
//                auto-task engines, but its records stay reachable at
//                /properties/{id} and it can be unarchived.
//
// Archive is NOT a dropdown value: it is an action (archiveProperty →
// the archive_property DB function) that stamps archived_at /
// archive_reason, flips auto_tasks_exempt and disables renewals so the
// engines stop immediately. The DB check constraint keeps status and
// archived_at in lockstep.

type Client = SupabaseClient<Database>

/** The statuses a property can be SET to from the status dropdowns. */
export const SETTABLE_STATUSES: Exclude<Property['status'], 'archived'>[] =
  ['active', 'watchlist', 'disposition']

export function isArchived(p: { status: Property['status'] } | null | undefined): boolean {
  return p?.status === 'archived'
}

/** Drop archived rows from an already-loaded list (for pickers built off a full fetch). */
export function withoutArchived<T extends { status: Property['status'] }>(list: T[]): T[] {
  return list.filter(p => p.status !== 'archived')
}

/**
 * The standard property list query. Excludes archived properties unless
 * `includeArchived` is passed — pickers, filters and name lookups all
 * want the live portfolio, and archived properties should only surface
 * where someone asks for them (Settings, the sidebar's collapsed group).
 */
export function propertiesQuery(
  supabase: Client,
  { includeArchived = false }: { includeArchived?: boolean } = {},
) {
  const q = supabase.from('properties').select('*').order('name')
  return includeArchived ? q : q.neq('status', 'archived')
}

/**
 * Both go through the DB functions (migration 0026) so the side effects
 * live in one place: archive_property stamps archived_at/reason, sets
 * auto_tasks_exempt, prepends an ARCHIVED line to notes and disables the
 * property's renewal engine; unarchive_property clears the archive
 * fields and restores the chosen status.
 */
export async function archiveProperty(supabase: Client, id: string, reason: string) {
  return supabase.rpc('archive_property', { p_property_id: id, p_reason: reason.trim() || null })
}

export async function unarchiveProperty(supabase: Client, id: string, status: Exclude<Property['status'], 'archived'> = 'active') {
  return supabase.rpc('unarchive_property', { p_property_id: id, p_status: status })
}

export function formatArchivedLine(p: { archived_at: string | null; archive_reason: string | null }): string {
  const when = p.archived_at
    ? new Date(p.archived_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  const parts = [when ? `Archived ${when}` : 'Archived', p.archive_reason].filter(Boolean)
  return parts.join(' — ')
}
