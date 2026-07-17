'use client'

// Minimal shared overlay chrome for the capture sheet and the command
// palette: fixed backdrop that closes on click, a panel that swallows
// clicks, and Escape-to-close (a focused input/textarea blurs first,
// so Escape inside a field backs out in two presses). Modal keeps its
// own markup — this covers the lighter, alignment-variant surfaces.

import { useEffect } from 'react'
import { cn } from '@/lib/utils'

const ALIGN = {
  // Bottom sheet on mobile, centered panel on md+ (capture sheet)
  sheet: 'items-end md:items-center justify-center',
  // Pinned near the top of the viewport (command palette)
  top: 'items-start justify-center px-4 pt-[12vh]',
}

export function Overlay({ onClose, align, backdropClassName = 'bg-black/50', panelClassName, children }: {
  onClose: () => void
  align: keyof typeof ALIGN
  backdropClassName?: string
  panelClassName?: string
  children: React.ReactNode
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) { el.blur(); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={cn('fixed inset-0 z-[60] flex', ALIGN[align], backdropClassName)}
      onClick={onClose}>
      <div className={panelClassName} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
