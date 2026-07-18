'use client'

import { cn } from '@/lib/utils'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'

// ── ErrorState ───────────────────────────────────────────────
// Centered fetch-failure block with a Retry button — the "could not
// load" counterpart of EmptyState. Callers own the outer layout
// (card chrome, page padding) via className or a wrapper.

export function ErrorState({ message, onRetry, className = '' }: {
  message: string
  onRetry: () => void
  className?: string
}) {
  return (
    <div className={cn('text-center space-y-3', className)}>
      <p className="text-sm text-red-600 flex items-center justify-center gap-1.5">
        <AlertTriangle size={14} className="flex-shrink-0" />{message}
      </p>
      <button onClick={onRetry} className="btn-secondary">
        <RotateCcw size={14} />Retry
      </button>
    </div>
  )
}

// ── ActionError ──────────────────────────────────────────────
// Inline dismissible mutation-error line — failed writes surface here
// instead of silently pretending success.

export function ActionError({ message, onDismiss }: {
  message: string
  onDismiss: () => void
}) {
  return (
    <p className="text-xs text-red-600 flex items-center gap-1.5">
      <AlertTriangle size={12} className="flex-shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss error"
        className="text-red-400 hover:text-red-600 flex-shrink-0">
        <X size={12} />
      </button>
    </p>
  )
}
