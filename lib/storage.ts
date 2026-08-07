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
// Long-lived URLs for links that leave the app (report-email photo links —
// a PM opening the email a week later must not hit a 403).
export const LONG_SIGNED_URL_TTL_S = 60 * 60 * 24 * 30 // 30 days

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

// Long-lived signed URLs for a batch of stored files, keyed by path —
// built for links that outlive the app session (the email-body report's
// photo hyperlinks). Total API failure surfaces as `error` so the caller
// can fail loud instead of sending an email with silently dead links;
// individually unsignable paths are simply absent from `urls` (the
// caller counts and discloses them).
export async function longSignedUrls(
  supabase: Pick<SupabaseClient, 'storage'>,
  paths: string[],
): Promise<{ urls: Record<string, string>; error: string | null }> {
  if (paths.length === 0) return { urls: {}, error: null }
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrls(paths, LONG_SIGNED_URL_TTL_S)
  if (error) return { urls: {}, error: error.message }
  const urls: Record<string, string> = {}
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl
  }
  return { urls, error: null }
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
