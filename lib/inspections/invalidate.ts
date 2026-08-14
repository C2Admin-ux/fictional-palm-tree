// Cross-inspection report invalidation. The rule (see the inspection
// detail page): an existing stored PDF is invalidated by ANY change to
// the findings it renders — and finding mutations don't only happen on
// the inspection's own page. The watch loop resolves PRIOR walks'
// findings from the capture screen, and completing a task resolves its
// linked findings from the Tasks page. This helper lets every one of
// those surfaces clear the now-stale report on whichever inspection the
// mutated finding belongs to.
//
// Per inspection: clear report_file_path (+ best-effort storage remove
// of the orphaned PDF), null report_sent_at, and revert a 'report_sent'
// status to 'submitted'. Idempotent (an inspection with nothing to clear
// is skipped) and best-effort per row — one failure never blocks the
// rest. Callable from client or server code; RLS applies to the client
// the caller passes in.
//
// The photo sheet (photo_sheet_path) is invalidated by the same rule and
// for a sharper reason: deleting a finding deletes its photos from
// storage, so a stored sheet can outlive the images it was rendered
// from. photo_sheet_paths — the picker's remembered selection — is
// deliberately KEPT: paths that no longer exist are filtered out when the
// picker reopens, and remembering the rest beats making a whole walk get
// re-picked over one deleted photo.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { BUCKET } from '@/lib/inspections/photos'

type Client = SupabaseClient<Database>

export async function invalidateInspectionReports(
  supabase: Client,
  inspectionIds: string[],
): Promise<{ failed: string[] }> {
  const ids = Array.from(new Set(inspectionIds.filter(Boolean)))
  if (ids.length === 0) return { failed: [] }

  const { data, error } = await supabase.from('inspections')
    .select('id, status, report_file_path, report_sent_at, photo_sheet_path')
    .in('id', ids)
  if (error) {
    console.warn('Could not load inspections to invalidate reports:', error.message)
    return { failed: ids }
  }

  const failed: string[] = []
  for (const insp of data ?? []) {
    if (insp.report_file_path == null && insp.report_sent_at == null
      && insp.photo_sheet_path == null && insp.status !== 'report_sent') {
      continue // nothing stale to clear — idempotent no-op
    }
    const patch = {
      report_file_path: null,
      report_sent_at: null,
      photo_sheet_path: null,
      ...(insp.status === 'report_sent' ? { status: 'submitted' as const } : {}),
    }
    const { error: updateError } = await supabase.from('inspections')
      .update(patch).eq('id', insp.id)
    if (updateError) {
      console.warn(`Could not invalidate the report on inspection ${insp.id}:`, updateError.message)
      failed.push(insp.id)
      continue
    }
    // Storage cleanup is best-effort: an orphaned PDF file is acceptable,
    // a stale sent badge is not.
    const orphaned = [insp.report_file_path, insp.photo_sheet_path]
      .filter((p): p is string => !!p)
    if (orphaned.length > 0) {
      try { await supabase.storage.from(BUCKET).remove(orphaned) } catch { /* non-fatal */ }
    }
  }
  return { failed }
}
