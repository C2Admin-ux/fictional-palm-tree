import type { createClient } from '@/lib/supabase/client'
import { BUCKET } from '@/lib/storage'

type SupabaseClient = ReturnType<typeof createClient>

// Server-only storage helpers. Kept out of lib/storage.ts because this
// module deals in Node Buffers — lib/storage.ts is imported by client
// components and must stay browser-safe.

// @react-pdf/renderer embeds JPEG and PNG only.
export type EmbeddableImage = { data: Buffer; format: 'jpg' | 'png' }

// How many downloads run at once: enough parallelism to matter on a
// photo-heavy annual walk, bounded enough to keep serverless memory sane
// (photos are compressed client-side to ~1280px JPEG, a few hundred KB).
const DOWNLOAD_CONCURRENCY = 4

function embeddableFormat(path: string): 'jpg' | 'png' | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg'
  if (ext === 'png') return 'png'
  return null
}

// Download photo bytes for PDF embedding, keyed by storage path.
//
// Paths that aren't JPEG/PNG (rare webp/gif fallback uploads) and paths
// whose download fails are SKIPPED and counted, never thrown — one dead
// photo must not cost the whole document. Callers disclose `omitted` on
// the rendered page rather than silently shipping a gap. Requires a
// service-role client: these run server-side against a private bucket.
export async function downloadEmbeddableImages(
  supabase: Pick<SupabaseClient, 'storage'>,
  paths: string[],
): Promise<{ images: Record<string, EmbeddableImage>; omitted: number }> {
  const images: Record<string, EmbeddableImage> = {}
  const unique = Array.from(new Set(paths))
  let omitted = 0

  const queue = [...unique]
  const worker = async () => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      const format = embeddableFormat(path)
      if (!format) { omitted++; continue }
      const { data: blob, error } = await supabase.storage.from(BUCKET).download(path)
      if (error || !blob) { omitted++; continue }
      images[path] = { data: Buffer.from(await blob.arrayBuffer()), format }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, unique.length) }, worker),
  )

  return { images, omitted }
}
