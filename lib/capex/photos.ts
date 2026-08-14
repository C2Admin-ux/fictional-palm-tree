import type { createClient } from '@/lib/supabase/client'
import { BUCKET, SIGNED_URL_TTL_S, removeFiles } from '@/lib/storage'

type SupabaseClient = ReturnType<typeof createClient>

// CapEx project photos — scope shots, damage, before/after. Rows live in
// capex_photos (migration 0013); the files themselves live in the same
// private c2-documents bucket as everything else, alongside the project's
// bid PDFs:
//   ${propertyId}/capex/${projectId}/photos/${stamp}-${i}-${rand}.${ext}
//
// This module owns the capex storage layout so the capex UI never reaches
// into lib/inspections — the same separation PR #33 drew when bids were
// built (capex and inspections share lib/storage.ts, nothing more).
export { BUCKET } from '@/lib/storage'

// The one exception, and a deliberate one: image compression is a generic
// browser utility that merely happens to live under lib/inspections. It is
// re-exported here rather than copied — two divergent compressors would be
// worse than one shared import — and rather than moved, because its Worker
// is resolved by relative URL and the field capture path depends on it.
export { compressImage } from '@/lib/inspections/compress'

// Treat a signed URL as stale 5 minutes before it actually expires so a
// thumbnail never 403s mid-view.
const SIGNED_URL_SAFETY_MS = 5 * 60 * 1000

export type SignedPhotoUrl = { url: string; expiresAt: number }

// Storage path for a new project photo. Random suffix: one multi-select
// upload shares a stamp, so the (stamp, index, rand) triple is what keeps
// paths unique.
export function newCapexPhotoPath(
  propertyId: string,
  projectId: string,
  stamp: number,
  index: number,
  ext: string,
): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${propertyId}/capex/${projectId}/photos/${stamp}-${index}-${rand}.${ext}`
}

// Signed display URLs (private bucket, 1hr) keyed by storage path, each
// carrying the timestamp after which it should be re-signed. Throws on a
// total API failure so the caller can retry instead of silently rendering
// placeholders forever.
export async function signedCapexPhotoUrls(
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

// Best-effort storage cleanup when a photo row is deleted. Non-fatal:
// orphaned files are acceptable, lost DB rows are not.
export async function removeCapexPhotos(
  supabase: SupabaseClient,
  paths: string[],
): Promise<void> {
  return removeFiles(supabase, paths)
}
