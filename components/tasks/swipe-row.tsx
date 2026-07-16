'use client'

// Touch swipe wrapper for task rows: swipe right → complete, swipe
// left → snooze. Pointer-event based with a translateX transform and a
// colored reveal underlay (emerald check right, amber clock left).
// Vertical scrolling is preserved: we only capture the gesture once
// horizontal intent is clear (|dx| > |dy| and |dx| > 12px), and
// touch-action: pan-y leaves vertical pans to the browser.

import { useRef, useState } from 'react'
import { Check, Moon } from 'lucide-react'

const INTENT_PX = 12    // movement before we decide the gesture is horizontal
const TRIGGER_PX = 72   // travel needed to fire the action on release
const MAX_PX = 120      // soft cap on row travel

export function SwipeRow({ onSwipeRight, onSwipeLeft, disabled = false, children }: {
  onSwipeRight: () => void
  onSwipeLeft: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const intent = useRef<'none' | 'horizontal' | 'vertical'>('none')
  const dxRef = useRef(0) // mirror of dx — pointerup must not read a stale render

  function move(value: number) {
    dxRef.current = value
    setDx(value)
  }

  function reset() {
    start.current = null
    intent.current = 'none'
    setDragging(false)
    move(0)
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
        setDragging(true)
        e.currentTarget.setPointerCapture?.(e.pointerId)
      } else if (Math.abs(deltaY) > INTENT_PX) {
        intent.current = 'vertical' // it's a scroll — leave it alone
        return
      } else {
        return
      }
    }

    // Cap travel so the row feels anchored
    move(Math.sign(deltaX) * Math.min(Math.abs(deltaX), MAX_PX))
  }

  function onPointerUp() {
    const travelled = dxRef.current
    if (intent.current === 'horizontal') {
      if (travelled >= TRIGGER_PX) onSwipeRight()
      else if (travelled <= -TRIGGER_PX) onSwipeLeft()
    }
    reset()
  }

  const rightActive = dx >= TRIGGER_PX
  const leftActive = dx <= -TRIGGER_PX

  return (
    <div
      className="relative overflow-hidden"
      style={{ touchAction: 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}>
      {/* Reveal underlay */}
      {dx !== 0 && (
        <div className="absolute inset-0 flex" aria-hidden="true">
          <div className={`flex-1 flex items-center pl-5 transition-colors ${
            dx > 0 ? (rightActive ? 'bg-emerald-500' : 'bg-emerald-300') : 'bg-transparent'
          }`}>
            {dx > 0 && <Check size={18} className="text-white" />}
          </div>
          <div className={`flex-1 flex items-center justify-end pr-5 transition-colors ${
            dx < 0 ? (leftActive ? 'bg-amber-400' : 'bg-amber-200') : 'bg-transparent'
          }`}>
            {dx < 0 && <Moon size={18} className="text-white" />}
          </div>
        </div>
      )}

      {/* The row itself, sliding over the underlay */}
      <div
        className="relative bg-white"
        style={{
          transform: dx !== 0 ? `translateX(${dx}px)` : undefined,
          transition: dragging ? 'none' : 'transform 150ms ease-out',
        }}>
        {children}
      </div>
    </div>
  )
}
