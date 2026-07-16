import type { createClient } from '@/lib/supabase/client'

type SupabaseClient = ReturnType<typeof createClient>

// Photos live in the existing private `c2-documents` bucket, alongside
// contract/insurance files, at:
//   ${propertyId}/inspections/${inspectionId}/${stamp}-${i}-${rand}.${ext}
export const BUCKET = 'c2-documents'
const MAX_EDGE_PX = 1600
const JPEG_QUALITY = 0.8
const SIGNED_URL_TTL_S = 3600
// Treat a signed URL as stale 5 minutes before it actually expires so a
// thumbnail never 403s mid-view.
const SIGNED_URL_SAFETY_MS = 5 * 60 * 1000

// A signed display URL plus the time we should stop trusting it.
export type SignedPhotoUrl = { url: string; expiresAt: number }

// What upload actually sends: the (possibly re-encoded) bytes plus the
// content type / extension they must be stored under.
type CompressedPhoto = { blob: Blob; contentType: string; ext: string }

// Image types a browser can plausibly display without re-encoding. Anything
// else that fails canvas decode is rejected rather than uploaded as fake
// JPEG bytes nothing can render later.
const DISPLAYABLE_IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// Downscale + re-encode a photo client-side before upload so flaky onsite
// connections aren't pushing 8MB camera originals. Longest edge capped at
// 1600px, JPEG q0.8. If decoding fails, falls back to the ORIGINAL file
// under its own content type — but only when the browser could plausibly
// display it; otherwise throws so the form keeps state and surfaces it.
export async function compressImage(file: File): Promise<CompressedPhoto> {
  const fallback = (): CompressedPhoto => {
    const ext = DISPLAYABLE_IMAGE_EXT[file.type]
    if (!ext) throw new Error('Unsupported photo format')
    return { blob: file, contentType: file.type, ext }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not decode image'))
      el.src = objectUrl
    })

    const scale = Math.min(1, MAX_EDGE_PX / Math.max(img.width, img.height))
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return fallback()
    ctx.drawImage(img, 0, 0, width, height)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    return blob ? { blob, contentType: 'image/jpeg', ext: 'jpg' } : fallback()
  } catch (e) {
    if (e instanceof Error && e.message === 'Unsupported photo format') throw e
    return fallback()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// Compress + upload a batch of finding photos in parallel. Returns the
// storage paths in the same order as `files`. Rejects on the first failed
// compress/upload so the caller keeps the form populated and Nick retries;
// any files that did land are acceptable orphans (orphaned storage files
// are fine, lost DB rows are not).
export async function uploadInspectionPhotos(
  supabase: SupabaseClient,
  propertyId: string,
  inspectionId: string,
  files: File[],
): Promise<string[]> {
  const stamp = Date.now()
  return Promise.all(files.map(async (file, i) => {
    const { blob, contentType, ext } = await compressImage(file)
    // Random suffix: two rapid batches can share Date.now(), and retries
    // must never overwrite a photo that already landed.
    const rand = Math.random().toString(36).slice(2, 8)
    const path = `${propertyId}/inspections/${inspectionId}/${stamp}-${i}-${rand}.${ext}`
    const { error } = await supabase.storage.from(BUCKET)
      .upload(path, blob, { contentType })
    if (error) throw new Error(`Photo upload failed: ${error.message}`)
    return path
  }))
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
