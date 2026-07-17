'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOverlayOpen } from '@/lib/ui/overlay'

// ── Modal ────────────────────────────────────────────────────
// Overlay + centered panel with a sticky header (title + X close).
// Mirrors the modal markup used in the documents / contracts pages.

const MAX_WIDTH: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
}

export function Modal({
  title, onClose, children, maxWidth = '2xl', headerRight,
}: {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  maxWidth?: keyof typeof MAX_WIDTH
  headerRight?: React.ReactNode
}) {
  // Mounted only while visible — register for the whole lifetime, so
  // global shortcuts (the layout's `n`) stay inert underneath.
  useOverlayOpen(true)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={cn('bg-white rounded-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto', MAX_WIDTH[maxWidth])}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            {typeof title === 'string'
              ? <h2 className="font-semibold text-slate-900 truncate">{title}</h2>
              : title}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {headerRight}
            <button onClick={onClose} aria-label="Close">
              <X size={18} className="text-slate-400 hover:text-slate-700" />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
