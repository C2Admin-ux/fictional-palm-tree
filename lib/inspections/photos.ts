import type { createClient } from '@/lib/supabase/client'

type SupabaseClient = ReturnType<typeof createClient>

// Photos live in the existing private `c2-documents` bucket, alongside
// contract/insurance files, at:
//   ${propertyId}/inspections/${inspectionId}/${stamp}-${i}-${rand}.${ext}
// (Compression itself lives in ./compress.ts — client-only Worker code —
// and uploading in ./upload-queue.ts; this module owns the storage layout
// and signed-URL/removal helpers, and is safe to import server-side.)
export const BUCKET = 'c2-documents'
const SIGNED_URL_TTL_S = 3600
// Treat a signed URL as stale 5 minutes before it actually expires so a
// thumbnail never 403s mid-view.
const SIGNED_URL_SAFETY_MS = 5 * 60 * 1000

// A signed display URL plus the time we should stop trusting it.
export type SignedPhotoUrl = { url: string; expiresAt: number }

// Storage path for a new finding photo. Random suffix: two rapid batches
// can share Date.now(), and a batch shares one stamp — the (stamp, index,
// rand) triple keeps every path unique. The upload queue generates a path
// ONCE per queued photo and reuses it across retries, so a retry can never
// overwrite a different photo and a re-upload of the same photo is
// idempotent ("already exists" counts as success).
export function newInspectionPhotoPath(
  propertyId: string,
  inspectionId: string,
  stamp: number,
  index: number,
  ext: string,
): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${propertyId}/inspections/${inspectionId}/${stamp}-${index}-${rand}.${ext}`
}

// Signed display URLs (private bucket, 1hr) keyed by storage path, each
// carrying the timestamp after which it should be re-signed. Throws on a
// total API failure so the caller can retry instead of silently rendering
// placeholders forever.
export async function signedPhotoUrls(
  supabase: SupabaseClient,
  paths: string[],
): Promise<Record<string, SignedPhotoUrl>> {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_S)
  if (error) throw new Error(`Could not load photos: ${error.message}`)
  const expiresAt = Date.now() + SIGNED_URL_TTL_S * 1000 - SIGNED_URL_SAFETY_MS
  const map: Record<string, SignedPhotoUrl> = {}
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) map[entry.path] = { url: entry.signedUrl, expiresAt }
  }
  return map
}

// Signed URL for a single stored file (e.g. the generated report PDF) —
// used by the "View PDF"/"View report" buttons to open the private bucket
// file in a new tab. Returns the URL or the error message, never throws.
export async function signedFileUrl(
  supabase: SupabaseClient,
  path: string,
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_S)
  return { url: data?.signedUrl ?? null, error: error?.message ?? null }
}

// Best-effort storage cleanup when a finding (or one of its photos) is
// deleted. Non-fatal: orphaned files are acceptable, lost DB rows are not.
export async function removeInspectionPhotos(
  supabase: SupabaseClient,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return
  try { await supabase.storage.from(BUCKET).remove(paths) } catch { /* non-fatal */ }
}
