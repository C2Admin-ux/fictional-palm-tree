'use client'

// Touch swipe wrapper for task rows: swipe right → complete, swipe
// left → snooze. Pointer-event based with a translateX transform and a
// colored reveal underlay (emerald check right, amber clock left).
// Vertical scrolling is preserved: we only capture the gesture once
// horizontal intent is clear (|dx| > |dy| and |dx| > 12px), and
// touch-action: pan-y leaves vertical pans to the browser.
//
// Perf: the per-move travel lives in a ref and is written straight to
// style.transform (rAF-throttled) — React state only changes on the
// discrete transitions (drag start/end, direction, threshold crossing),
// so dragging doesn't re-render the row on every pointer event.

import { useEffect, useRef, useState } from 'react'
import { Check, Moon } from 'lucide-react'

const INTENT_PX = 12    // movement before we decide the gesture is horizontal
const TRIGGER_PX = 72   // travel needed to fire the action on release
const MAX_PX = 120      // soft cap on row travel

type DragUi = {
  active: boolean            // mid-gesture (controls overflow clipping + underlay)
  dir: 'right' | 'left' | null
  armed: boolean             // past the trigger threshold
}

const IDLE: DragUi = { active: false, dir: null, armed: false }

export function SwipeRow({ onSwipeRight, onSwipeLeft, disabled = false, children }: {
  onSwipeRight: () => void
  onSwipeLeft: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  const [ui, setUi] = useState<DragUi>(IDLE)
  const rowRef = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const intent = useRef<'none' | 'horizontal' | 'vertical'>('none')
  const dxRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
  }, [])

  function scheduleTransform() {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = rowRef.current
      if (el) el.style.transform = `translateX(${dxRef.current}px)`
    })
  }

  function reset() {
    start.current = null
    intent.current = 'none'
    dxRef.current = 0
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const el = rowRef.current
    if (el) {
      el.style.transition = 'transform 150ms ease-out'
      el.style.transform = 'translateX(0px)'
    }
    setUi(IDLE)
  }

  function onPointerDown(e: React.PointerEvent) {
    // Touch only — mouse drags would fight text selection / inline edits
    if (disabled || e.pointerType !== 'touch') return
    start.current = { x: e.clientX, y: e.clientY }
    intent.current = 'none'
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!start.current || intent.current === 'vertical') return
    const deltaX = e.clientX - start.current.x
    const deltaY = e.clientY - start.current.y

    if (intent.current === 'none') {
      if (Math.abs(deltaX) > INTENT_PX && Math.abs(deltaX) > Math.abs(deltaY)) {
        intent.current = 'horizontal'
        e.currentTarget.setPointerCapture?.(e.pointerId)
        if (rowRef.current) rowRef.current.style.transition = 'none'
      } else if (Math.abs(deltaY) > INTENT_PX) {
        intent.current = 'vertical' // it's a scroll — leave it alone
        return
      } else {
        return
      }
    }

    // Cap travel so the row feels anchored
    const dx = Math.sign(deltaX) * Math.min(Math.abs(deltaX), MAX_PX)
    dxRef.current = dx
    scheduleTransform()

    const dir = dx > 0 ? 'right' as const : dx < 0 ? 'left' as const : null
    const armed = Math.abs(dx) >= TRIGGER_PX
    setUi(prev =>
      prev.active && prev.dir === dir && prev.armed === armed
        ? prev
        : { active: true, dir, armed }
    )
  }

  function onPointerUp() {
    const travelled = dxRef.current
    if (intent.current === 'horizontal') {
      if (travelled >= TRIGGER_PX) onSwipeRight()
      else if (travelled <= -TRIGGER_PX) onSwipeLeft()
    }
    reset()
  }

  return (
    <div
      // overflow-hidden only mid-gesture — at rest it would clip the
      // row's own dropdowns (snooze presets, priority pip).
      className={ui.active ? 'relative overflow-hidden' : 'relative'}
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}>
      {/* Reveal underlay */}
      {ui.active && ui.dir && (
        <div className="absolute inset-0 flex" aria-hidden="true">
          <div className={`flex-1 flex items-center pl-5 transition-colors ${
            ui.dir === 'right' ? (ui.armed ? 'bg-emerald-500' : 'bg-emerald-300') : 'bg-transparent'
          }`}>
            {ui.dir === 'right' && <Check size={18} className="text-white" />}
          </div>
          <div className={`flex-1 flex items-center justify-end pr-5 transition-colors ${
            ui.dir === 'left' ? (ui.armed ? 'bg-amber-400' : 'bg-amber-200') : 'bg-transparent'
          }`}>
            {ui.dir === 'left' && <Moon size={18} className="text-white" />}
          </div>
        </div>
      )}

      {/* The row itself, sliding over the underlay */}
      <div ref={rowRef} className="relative bg-white">
        {children}
      </div>
    </div>
  )
}
