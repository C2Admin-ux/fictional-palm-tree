'use client'

// Tiny module-level registry of open blocking overlays (modals, the
// capture sheet, the command palette). Global shortcuts consult it so
// e.g. the layout's `n` never stacks the capture sheet on top of an
// already-open overlay. A counter (not a boolean) because overlays can
// nest — a modal above a modal must keep the registry "open" until the
// last one closes.

import { useEffect } from 'react'

let openCount = 0

export function isOverlayOpen(): boolean {
  return openCount > 0
}

// Register an overlay for as long as `open` is true. Components that
// mount only while visible (Modal) pass `true`; components that stay
// mounted and gate on state (palette, capture sheet) pass their flag.
export function useOverlayOpen(open: boolean): void {
  useEffect(() => {
    if (!open) return
    openCount++
    return () => { openCount = Math.max(0, openCount - 1) }
  }, [open])
}
