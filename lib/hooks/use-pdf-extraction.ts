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
      const data = (await res.json()) as T

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
