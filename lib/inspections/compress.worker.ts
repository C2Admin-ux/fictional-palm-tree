// Web Worker: downscale + re-encode an inspection photo off the main
// thread. createImageBitmap + OffscreenCanvas decode and draw without
// touching the DOM, so batches of 8MB camera originals stop janking the
// capture UI (slow camera-button response while a batch processes).
//
// Message contract (see compressInWorker in ./compress.ts):
//   request  { id, file, maxEdgePx, quality }
//   response { id, ok: true, blob } | { id, ok: false, message }
// A decode failure here is NOT fatal to the photo — the caller falls back
// to the main-thread path, which owns the HEIC-safety semantics.

type CompressRequest = { id: number; file: Blob; maxEdgePx: number; quality: number }

self.onmessage = async (event: MessageEvent<CompressRequest>) => {
  const { id, file, maxEdgePx, quality } = event.data
  try {
    const bitmap = await createImageBitmap(file)
    try {
      const scale = Math.min(1, maxEdgePx / Math.max(bitmap.width, bitmap.height))
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('No 2d context in worker')
      ctx.drawImage(bitmap, 0, 0, width, height)
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
      self.postMessage({ id, ok: true, blob })
    } finally {
      bitmap.close()
    }
  } catch (e) {
    self.postMessage({ id, ok: false, message: e instanceof Error ? e.message : 'Worker compression failed' })
  }
}

export {}
