'use client'

// RTM-style completion feel, implemented once for every surface
// (agenda rows, All view sections, Review, property tab, subtask rows):
//   1. the complete circle fills with a brief check pop (CHECK_MS —
//      the check-pop keyframe in globals.css)
//   2. the row collapses (height + opacity + slight translate,
//      COLLAPSE_MS ease-out) and leaves the list
// Pure CSS transitions — the height animation is the grid-template-rows
// 1fr→0fr trick, so nothing gets measured and no animation library is
// involved.
//
// The mutation is NEVER deferred behind the animation: completing fires
// the optimistic store update + DB write + toast + recurrence
// immediately, and the exit is presentation-only. useExitingRows keeps
// a pre-completion snapshot of each leaving row so the list's
// filters/groups keep rendering it in place (visually "completing":
// check popped, pointer-events off, collapsing) until the animation
// ends. Undo or a failed write cancels the exit, so the row reappears
// instantly; unmounting mid-animation just drops the transient state —
// the data is already persisted.

import { useCallback, useEffect, useRef, useState } from 'react'

export const CHECK_MS = 150     // circle fill + check pop before the collapse
export const COLLAPSE_MS = 250  // height/opacity/translate exit

export type ExitPhase = 'check' | 'collapse'

// Transient exit state for one list surface. The complete handler calls
// begin(task) with the PRE-completion row, then fires the mutation; the
// list substitutes the snapshot back in via overlay() so the row stays
// where it was while it animates out.
export function useExitingRows<T extends { id: string }>() {
  const [rows, setRows] = useState<Map<string, { snapshot: T; phase: ExitPhase }>>(new Map())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>[]>())

  // Ends an exit early (Undo, failed write) or on schedule — the row
  // simply renders from real store state again.
  const cancel = useCallback((id: string) => {
    for (const t of timers.current.get(id) ?? []) clearTimeout(t)
    timers.current.delete(id)
    setRows(prev => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  // Snapshot BEFORE the mutation flips the row. Returns false when the
  // row is already exiting (repeat trigger — e.g. the same task rendered
  // in two Review sections) so the caller skips the double mutation.
  const begin = useCallback((task: T): boolean => {
    if (timers.current.has(task.id)) return false
    setRows(prev => new Map(prev).set(task.id, { snapshot: task, phase: 'check' }))
    timers.current.set(task.id, [
      setTimeout(() => setRows(prev => {
        const entry = prev.get(task.id)
        if (!entry || entry.phase === 'collapse') return prev
        return new Map(prev).set(task.id, { ...entry, phase: 'collapse' })
      }), CHECK_MS),
      setTimeout(() => cancel(task.id), CHECK_MS + COLLAPSE_MS),
    ])
    return true
  }, [cancel])

  // Unmount mid-animation: drop the timers only. Harmless — the
  // mutation already fired when the exit began.
  useEffect(() => () => {
    timers.current.forEach(list => { for (const t of list) clearTimeout(t) })
  }, [])

  // Substitute leaving rows with their pre-completion snapshots so the
  // surrounding filters/groups/counts keep the row exactly where it was
  // while the exit plays. Feed every RENDER derivation from this;
  // mutation logic keeps reading the real store.
  const overlay = useCallback((tasks: T[]): T[] =>
    rows.size === 0 ? tasks : tasks.map(t => rows.get(t.id)?.snapshot ?? t),
    [rows])

  // Referentially stable (reads through a ref) so it can ride inside a
  // stable handlers bundle — memoized rows re-render via their computed
  // exitPhase prop, not via this function's identity.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const phaseOf = useCallback((id: string): ExitPhase | null =>
    rowsRef.current.get(id)?.phase ?? null, [])

  return { begin, cancel, overlay, phaseOf }
}

export function CollapseOnComplete({ phase, children }: {
  phase: ExitPhase | null
  children: React.ReactNode
}) {
  const collapsing = phase === 'collapse'
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: collapsing ? '0fr' : '1fr',
        opacity: collapsing ? 0 : 1,
        transform: collapsing ? 'translateX(10px)' : 'none',
        transition: `grid-template-rows ${COLLAPSE_MS}ms ease-out, opacity ${COLLAPSE_MS}ms ease-out, transform ${COLLAPSE_MS}ms ease-out`,
        // Interactive-safe for the whole exit (check + collapse) — the
        // mutation already fired; nothing under the pointer can double-act.
        pointerEvents: phase != null ? 'none' : undefined,
      }}>
      {/* overflow only clips during the exit — at rest it would cut off
          the row's own dropdowns (snooze presets, priority pip) */}
      <div style={{ minHeight: 0, overflow: collapsing ? 'hidden' : 'visible' }}>
        {children}
      </div>
    </div>
  )
}
