'use client'

import { Loader2 } from 'lucide-react'

// ── ExtractingOverlay ────────────────────────────────────────
// Full-screen busy overlay shown while an uploaded PDF is being
// read/extracted. Mirrors the "Reading your document…" overlay.

export function ExtractingOverlay({
  title = 'Reading your document',
  status = '',
}: {
  title?: string
  status?: string
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl px-8 py-6 shadow-xl text-center max-w-sm">
        <Loader2 size={32} className="text-blue-500 mx-auto mb-3 animate-spin" />
        <div className="text-base font-semibold text-slate-800">{title}</div>
        {status && <div className="text-sm text-slate-500 mt-1">{status}</div>}
      </div>
    </div>
  )
}
