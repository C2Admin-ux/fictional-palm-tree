'use client'

import { useCallback, useState } from 'react'

// ── fileToBase64 ─────────────────────────────────────────────
// Read a File into a base64 string (no data: prefix), as expected
// by the /api/*/extract endpoints.

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

// ── Payload size guard ───────────────────────────────────────
// Vercel caps request bodies at 4.5 MB, and base64 inflates the PDF
// by ~33% (plus JSON envelope). Anything over ~3.2 MB raw would be
// rejected server-side with an opaque FUNCTION_PAYLOAD_TOO_LARGE
// error, so refuse it client-side with a helpful message instead.

export const MAX_EXTRACTION_PDF_BYTES = 3.2 * 1024 * 1024

export function pdfTooLargeMessage(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1)
  return `This PDF is too large to process (${mb} MB — limit ~3 MB). Compress it or split it and try again.`
}

/** True when `message` is the size-limit error — pages that wrap errors in an "Extraction failed —" alert should show it verbatim. */
export function isPdfTooLargeError(message: string): boolean {
  return message.startsWith('This PDF is too large')
}

// ── usePdfExtraction ─────────────────────────────────────────
// Encapsulates the drag/drop + fileToBase64 + POST /api/*/extract
// flow used by the documents and PCA pages. On success it calls
// `onSuccess` with the parsed response and the file meta.
//
//   const pdf = usePdfExtraction<{ contracts: any[] }>({
//     endpoint: '/api/contracts/extract',
//     onSuccess: (data, file) => setReview({ ...data, file }),
//   })
//   <div {...pdf.dragProps}> … </div>
//   {pdf.dragOver && <DragOverlay />}
//   {pdf.extracting && <ExtractingOverlay status={pdf.status} />}

export type ExtractResponse = {
  success?: boolean
  error?: string
  detail?: unknown
  [key: string]: unknown
}

export function usePdfExtraction<T extends ExtractResponse = ExtractResponse>({
  endpoint,
  onSuccess,
  readingMessage = 'Reading document…',
  extractingMessage = 'Extracting details with AI…',
  notPdfMessage = 'Please drop a PDF file',
}: {
  endpoint: string
  onSuccess?: (data: T, file: { name: string; base64: string }) => void
  readingMessage?: string
  extractingMessage?: string
  notPdfMessage?: string
}) {
  const [dragOver, setDragOver] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)

  const extractFile = useCallback(async (file: File): Promise<T | null> => {
    // Pre-check before reading/uploading: oversized PDFs can never make it
    // through Vercel's body-size cap, so fail fast with a clear message.
    if (file.size > MAX_EXTRACTION_PDF_BYTES) {
      setError(pdfTooLargeMessage(file.size))
      return null
    }
    setError(null)
    setExtracting(true)
    setStatus(readingMessage)
    try {
      const base64 = await fileToBase64(file)
      setStatus(extractingMessage)
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: base64, filename: file.name }),
      })

      // Sessions expire while pages sit open — a 401 here means the user
      // needs to sign in again, not that extraction failed.
      if (res.status === 401) {
        window.location.href = '/auth/login'
        return null
      }

      // Defense in depth: if an oversized body slips past the pre-check,
      // Vercel rejects it with a 413 whose body is plain text
      // (FUNCTION_PAYLOAD_TOO_LARGE), not JSON — map it to the same
      // friendly message instead of surfacing a raw JSON-parse error.
      if (res.status === 413) {
        setError(pdfTooLargeMessage(file.size))
        return null
      }

      const raw = await res.text()
      let data: T
      try {
        data = JSON.parse(raw) as T
      } catch {
        setError(raw.includes('FUNCTION_PAYLOAD_TOO_LARGE')
          ? pdfTooLargeMessage(file.size)
          : `Server error (${res.status}): ${raw.slice(0, 120)}`)
        return null
      }

      if (!data.success) {
        const reason = data.detail
          ? `${data.error}: ${typeof data.detail === 'string' ? data.detail.slice(0, 200) : JSON.stringify(data.detail).slice(0, 200)}`
          : (data.error ?? 'unknown error')
        setError(reason)
        return data
      }

      onSuccess?.(data, { name: file.name, base64 })
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      return null
    } finally {
      setExtracting(false)
      setStatus('')
    }
  }, [endpoint, onSuccess, readingMessage, extractingMessage])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!extracting) setDragOver(true)
  }, [extracting])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = Array.from(e.dataTransfer.files).find(isPdf)
    if (!file) { setError(notPdfMessage); return }
    void extractFile(file)
  }, [extractFile, notPdfMessage])

  // Handler for a hidden <input type="file"> — resets the input after use.
  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void extractFile(file)
    e.target.value = ''
  }, [extractFile])

  return {
    dragOver,
    extracting,
    status,
    error,
    setError,
    extractFile,
    onInputChange,
    /** Spread onto the drop-zone element. */
    dragProps: { onDragOver, onDragLeave, onDrop },
  }
}
