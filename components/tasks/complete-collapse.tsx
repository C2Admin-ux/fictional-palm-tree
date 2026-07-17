'use client'

// RTM-style completion feel, implemented once for every surface
// (agenda rows, All view sections, Review, property tab, subtask rows):
//   1. the complete circle fills with a brief check pop (~150ms —
//      the .check-pop keyframe in globals.css)
//   2. the row collapses (height + opacity + slight translate, ~250ms
//      ease-out) and leaves the list
// Pure CSS transitions — the height animation is the grid-template-rows
// 1fr→0fr trick, so nothing gets measured and no animation library is
// involved. The actual mutation fires only after the collapse, so the
// optimistic store removes an already-invisible row; Undo re-inserts a
// fresh row instantly (no reverse animation). Un-completing (from a
// done section) skips the animation entirely.

import { useEffect, useRef, useState } from 'react'

export const CHECK_MS = 150     // circle fill + check pop before the collapse
export const COLLAPSE_MS = 250  // height/opacity/translate exit

// Drives the two-phase exit. `trigger` replaces the row's direct
// complete call: un-completing passes straight through; completing
// plays check → collapse → complete(). Repeat triggers mid-animation
// are ignored, and if the task flips to done while the row stays
// mounted (e.g. it moves into a Completed section) the transient state
// resets so the row reappears normally.
export function useCompleteCollapse(isDone: boolean, complete: () => void) {
  const [checked, setChecked] = useState(false)
  const [collapsing, setCollapsing] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const running = useRef(false)

  useEffect(() => {
    if (isDone && (checked || collapsing)) {
      setChecked(false)
      setCollapsing(false)
      running.current = false
    }
  }, [isDone, checked, collapsing])

  useEffect(() => () => { for (const t of timers.current) clearTimeout(t) }, [])

  function trigger() {
    if (isDone) { complete(); return }  // un-complete: no animation
    if (running.current) return
    running.current = true
    setChecked(true)
    timers.current.push(setTimeout(() => setCollapsing(true), CHECK_MS))
    timers.current.push(setTimeout(() => {
      running.current = false
      complete()
    }, CHECK_MS + COLLAPSE_MS))
  }

  return { checked, collapsing, trigger }
}

export function CollapseOnComplete({ collapsing, children }: {
  collapsing: boolean
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: collapsing ? '0fr' : '1fr',
        opacity: collapsing ? 0 : 1,
        transform: collapsing ? 'translateX(10px)' : 'none',
        transition: `grid-template-rows ${COLLAPSE_MS}ms ease-out, opacity ${COLLAPSE_MS}ms ease-out, transform ${COLLAPSE_MS}ms ease-out`,
        // Interactive-safe while leaving — nothing under the pointer
        // can be clicked mid-collapse.
        pointerEvents: collapsing ? 'none' : undefined,
      }}>
      {/* overflow only clips during the exit — at rest it would cut off
          the row's own dropdowns (snooze presets, priority pip) */}
      <div style={{ minHeight: 0, overflow: collapsing ? 'hidden' : 'visible' }}>
        {children}
      </div>
    </div>
  )
}
