'use client'

// Portal-based anchored dropdown. Row-level menus (snooze, due) used to
// render inline with `absolute` + z-50, which breaks two ways: an
// ancestor stacking context traps the menu underneath later rows and the
// mobile tab bar (SwipeRow leaves a translateX transform on the row, and
// any transform starts a stacking context), and overflow-x-auto table
// wrappers clip it outright. Rendering into document.body sidesteps every
// ancestor: nothing between the menu and the root can cover or clip it.
//
// Positioning is fixed, measured off the anchor's rect: below the
// trigger, flipped above when the viewport runs out (the batch bar lives
// at the bottom edge), clamped horizontally. Re-measured on scroll
// (capture — inner scrollers too) and resize, plus one delayed pass so a
// swipe-opened menu settles with its row's snap-back animation.
//
// z-[70]: above modals and the command palette backdrop (z-50/z-[60]) so
// the due menu keeps working inside the task edit modal; below toasts
// (z-[100]).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const GAP_PX = 4
const VIEWPORT_PAD_PX = 8

export function AnchoredMenu({
  anchorRef, open, onRequestClose, align = 'right', children,
}: {
  // The trigger's wrapper element; position is derived from its rect and
  // clicks inside it don't count as "outside".
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onRequestClose: () => void
  align?: 'left' | 'right'
  children: React.ReactNode
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const place = useCallback(() => {
    const anchor = anchorRef.current
    const menu = menuRef.current
    if (!anchor || !menu) return
    const a = anchor.getBoundingClientRect()
    const m = menu.getBoundingClientRect()

    let top = a.bottom + GAP_PX
    const overflowsBelow = top + m.height > window.innerHeight - VIEWPORT_PAD_PX
    const fitsAbove = a.top - GAP_PX - m.height >= VIEWPORT_PAD_PX
    if (overflowsBelow && fitsAbove) top = a.top - GAP_PX - m.height

    let left = align === 'right' ? a.right - m.width : a.left
    left = Math.min(
      Math.max(left, VIEWPORT_PAD_PX),
      window.innerWidth - m.width - VIEWPORT_PAD_PX,
    )
    setPos({ top, left })
  }, [anchorRef, align])

  // Measure after the menu exists in the DOM; hidden until then so the
  // first paint never flashes at 0,0.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (anchorRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      onRequestClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    // Swipe-left opens the menu while the row is still sliding back —
    // one late pass once the 150ms snap-back has finished.
    const settle = setTimeout(place, 200)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      clearTimeout(settle)
    }
  }, [open, place, onRequestClose, anchorRef])

  if (!open) return null

  return createPortal(
    <div
      ref={menuRef}
      // Portals bubble React events to the React parent (the row), so a
      // menu click would otherwise also fire the row's own onClick.
      onClick={e => e.stopPropagation()}
      style={pos
        ? { top: pos.top, left: pos.left }
        : { top: 0, left: 0, visibility: 'hidden' }}
      className="fixed z-[70] bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[180px]">
      {children}
    </div>,
    document.body,
  )
}
