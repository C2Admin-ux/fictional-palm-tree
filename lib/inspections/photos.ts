import type { createClient } from '@/lib/supabase/client'

type SupabaseClient = ReturnType<typeof createClient>

// Photos live in the existing private `c2-documents` bucket, alongside
// contract/insurance files, at:
//   ${propertyId}/inspections/${inspectionId}/${Date.now()}-${i}.jpg
const BUCKET = 'c2-documents'
const MAX_EDGE_PX = 1600
const JPEG_QUALITY = 0.8
const SIGNED_URL_TTL_S = 3600

// Downscale + re-encode a photo client-side before upload so flaky onsite
// connections aren't pushing 8MB camera originals. Longest edge capped at
// 1600px, JPEG q0.8. Falls back to the original file if decoding fails
// (e.g. an unsupported format) — better to upload big than lose the photo.
export async function compressImage(file: File): Promise<Blob> {
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
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, width, height)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    return blob ?? file
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// Compress + upload a batch of finding photos. Returns the storage paths
// to persist on the item. Throws on the first failed upload so the caller
// can keep the form populated and let Nick retry.
export async function uploadInspectionPhotos(
  supabase: SupabaseClient,
  propertyId: string,
  inspectionId: string,
  files: File[],
): Promise<string[]> {
  const stamp = Date.now()
  const paths: string[] = []
  for (let i = 0; i < files.length; i++) {
    const blob = await compressImage(files[i])
    const path = `${propertyId}/inspections/${inspectionId}/${stamp}-${i}.jpg`
    const { error } = await supabase.storage.from(BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg' })
    if (error) throw new Error(`Photo upload failed: ${error.message}`)
    paths.push(path)
  }
  return paths
}

// Signed display URLs (private bucket, 1hr) keyed by storage path.
export async function signedPhotoUrls(
  supabase: SupabaseClient,
  paths: string[],
): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data } = await supabase.storage.from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_S)
  const map: Record<string, string> = {}
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) map[entry.path] = entry.signedUrl
  }
  return map
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
