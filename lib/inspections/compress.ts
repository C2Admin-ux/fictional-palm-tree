// Client-side photo compression for inspection findings — single source of
// truth for how a camera original becomes the bytes we upload.
//
// Preferred path: a Web Worker (createImageBitmap + OffscreenCanvas) so
// decoding/drawing 8MB originals never janks the capture UI. Fallback:
// the original main-thread Image+canvas path where those APIs are missing
// — and that path also owns the HEIC-safety semantics (a file no canvas
// can decode uploads as the ORIGINAL when the browser could plausibly
// display it, otherwise throws 'Unsupported photo format' so the form
// keeps state and surfaces it).
//
// This module is client-only (Worker/DOM APIs); keep it out of server
// imports — storage concerns live in ./photos.ts.

// Report PDFs render photos small — 1280px/q0.75 roughly halves field
// upload bytes vs the old 1600px/q0.8 with no visible loss in the report.
export const MAX_EDGE_PX = 1280
export const JPEG_QUALITY = 0.75

// What upload actually sends: the (possibly re-encoded) bytes plus the
// content type / extension they must be stored under.
export type CompressedPhoto = { blob: Blob; contentType: string; ext: string }

// Image types a browser can plausibly display without re-encoding. Anything
// else that fails canvas decode is rejected rather than uploaded as fake
// JPEG bytes nothing can render later.
const DISPLAYABLE_IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// ── Worker plumbing ──────────────────────────────────────────

type WorkerResponse = { id: number; ok: boolean; blob?: Blob; message?: string }

// If a worker job somehow never responds, release the save flow to the
// main-thread fallback instead of hanging it.
const WORKER_JOB_TIMEOUT_MS = 30_000

let worker: Worker | null = null
let workerBroken = false
let nextJobId = 1
const jobs = new Map<number, { resolve: (blob: Blob) => void; reject: (e: Error) => void }>()

function canUseWorker(): boolean {
  return !workerBroken
    && typeof window !== 'undefined'
    && typeof Worker !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined'
    && typeof createImageBitmap !== 'undefined'
}

function failAllJobs(message: string) {
  const pending = Array.from(jobs.values())
  jobs.clear()
  for (const job of pending) job.reject(new Error(message))
}

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new Worker(new URL('./compress.worker.ts', import.meta.url))
  } catch {
    workerBroken = true
    return null
  }
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const job = jobs.get(event.data.id)
    if (!job) return
    jobs.delete(event.data.id)
    if (event.data.ok && event.data.blob) job.resolve(event.data.blob)
    else job.reject(new Error(event.data.message ?? 'Worker compression failed'))
  }
  worker.onerror = () => {
    // Worker infrastructure broke (load/parse/crash) — fail pending jobs so
    // they fall back to the main thread, and stop trying the worker.
    workerBroken = true
    failAllJobs('Compression worker crashed')
    worker?.terminate()
    worker = null
  }
  return worker
}

function compressInWorker(file: File): Promise<Blob> {
  const w = getWorker()
  if (!w) return Promise.reject(new Error('Compression worker unavailable'))
  return new Promise<Blob>((resolve, reject) => {
    const id = nextJobId++
    const timer = setTimeout(() => {
      if (!jobs.has(id)) return
      jobs.delete(id)
      reject(new Error('Compression worker timed out'))
    }, WORKER_JOB_TIMEOUT_MS)
    jobs.set(id, {
      resolve: blob => { clearTimeout(timer); resolve(blob) },
      reject: e => { clearTimeout(timer); reject(e) },
    })
    w.postMessage({ id, file, maxEdgePx: MAX_EDGE_PX, quality: JPEG_QUALITY })
  })
}

// ── Main-thread fallback (original path) ─────────────────────

async function compressOnMainThread(file: File): Promise<CompressedPhoto> {
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

// ── Public API ───────────────────────────────────────────────

// Downscale + re-encode a photo client-side before upload so flaky onsite
// connections aren't pushing 8MB camera originals. Longest edge capped at
// MAX_EDGE_PX, JPEG at JPEG_QUALITY. Off the main thread where supported;
// ANY worker miss (decode failure, crash, hang, unsupported APIs) retries
// on the main-thread path so the HEIC-safety semantics above hold exactly.
export async function compressImage(file: File): Promise<CompressedPhoto> {
  if (canUseWorker()) {
    try {
      const blob = await compressInWorker(file)
      return { blob, contentType: 'image/jpeg', ext: 'jpg' }
    } catch {
      // Fall through to the main-thread path.
    }
  }
  return compressOnMainThread(file)
}
