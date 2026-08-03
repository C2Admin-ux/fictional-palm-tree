import type { createClient } from '@/lib/supabase/client'

type SupabaseClient = ReturnType<typeof createClient>

// Generic helpers for the single private `c2-documents` bucket — the
// home for every stored file (contracts, insurance COIs, inspection
// photos/reports, capex bid PDFs). Path layout conventions live with
// each feature (e.g. lib/inspections/photos.ts); this module owns the
// bucket name and the signed-URL/removal plumbing. Safe to import
// server-side.
export const BUCKET = 'c2-documents'
export const SIGNED_URL_TTL_S = 3600

// Signed URL for a single stored file (bid PDF, generated report, …) —
// used by "View PDF"-style buttons to open a private-bucket file in a
// new tab. Returns the URL or the error message, never throws.
export async function signedFileUrl(
  supabase: SupabaseClient,
  path: string,
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_S)
  return { url: data?.signedUrl ?? null, error: error?.message ?? null }
}

// Best-effort storage cleanup (row deleted, file replaced, or an upload
// orphaned by a failed row write). Non-fatal by design: orphaned files
// are acceptable, lost DB rows are not.
export async function removeFiles(
  supabase: SupabaseClient,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return
  try { await supabase.storage.from(BUCKET).remove(paths) } catch { /* non-fatal */ }
}
