'use client'

// RTM-style keyboard layer for the tasks page (desktop only).
//   j / k (or arrows)  move the row selection in visual order
//   c                  complete-toggle the selected task
//   s                  open its snooze preset menu
//   d                  open its due-date inline editor
//   e                  open the edit modal
//   1 / 2 / 3 / 4      priority urgent / high / medium / low
//   Delete / Backspace delete (optimistic + undo toast)
//   n / q              focus the quick-add bar · Escape backs out
//
// Visual order comes from the DOM ([data-task-id] rows), so it works
// across the Agenda / All / Review groupings without lifting each
// view's ordering logic. s and d click the row's real controls
// ([data-snooze-trigger], [data-due-edit]) — the exact same paths the
// mouse uses. Inert while any input/textarea/select/modal has focus.

import { useEffect, useRef } from 'react'
import type { Task } from '@/lib/supabase/types'

export type TaskShortcutActions = {
  enabled: boolean            // false while a modal is open or the list is loading
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  onComplete: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (id: string) => void
  onSetPriority: (id: string, priority: Task['priority']) => void
}

const PRIORITY_KEYS: Record<string, Task['priority']> = {
  '1': 'urgent', '2': 'high', '3': 'medium', '4': 'low',
}

function isEditableTarget(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function useTaskListShortcuts(actions: TaskShortcutActions) {
  // Single stable listener; always sees the latest state via the ref.
  const ref = useRef(actions)
  ref.current = actions

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const a = ref.current
      if (!a.enabled) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // Mobile keeps swipe gestures; no keyboard layer there.
      if (window.matchMedia('(pointer: coarse)').matches) return

      if (isEditableTarget()) {
        // Inputs own their keys — Escape just backs out of the field.
        if (e.key === 'Escape') (document.activeElement as HTMLElement | null)?.blur()
        return
      }

      // Held-down keys only repeat navigation — a repeating Delete or c
      // would mow through the list.
      const isNav = e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp'
      if (e.repeat && !isNav) return

      // Visual order from the DOM, deduped (the Review view can render
      // the same task in several sections — navigation uses the first
      // occurrence so indexOf can traverse the whole list).
      const rows: HTMLElement[] = []
      const ids: string[] = []
      const seen = new Set<string>()
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-task-id]'))) {
        const id = el.dataset.taskId as string
        if (seen.has(id)) continue
        seen.add(id)
        rows.push(el)
        ids.push(id)
      }
      const idx = a.selectedId ? ids.indexOf(a.selectedId) : -1

      switch (e.key) {
        case 'j': case 'ArrowDown':
        case 'k': case 'ArrowUp': {
          if (ids.length === 0) return
          e.preventDefault()
          const dir = e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1
          const next = idx === -1
            ? (dir === 1 ? 0 : ids.length - 1)
            : Math.min(Math.max(idx + dir, 0), ids.length - 1)
          a.setSelectedId(ids[next])
          rows[next].scrollIntoView({ block: 'nearest' })
          return
        }
        case 'n': case 'q': {
          const input = document.querySelector<HTMLInputElement>('[data-quick-add-input]')
          if (input) { e.preventDefault(); input.focus() }
          return
        }
        case 'Escape':
          a.setSelectedId(null)
          return
      }

      // Everything below acts on a selected, currently visible row
      if (a.selectedId == null || idx === -1) return
      const row = rows[idx]

      if (PRIORITY_KEYS[e.key]) {
        e.preventDefault()
        a.onSetPriority(a.selectedId, PRIORITY_KEYS[e.key])
        return
      }

      switch (e.key) {
        case 'c':
          e.preventDefault()
          a.onComplete(a.selectedId)
          return
        case 'e':
          e.preventDefault()
          a.onEdit(a.selectedId)
          return
        case 'Delete': case 'Backspace': {
          e.preventDefault()
          const fallback = ids[idx + 1] ?? ids[idx - 1] ?? null
          a.onDelete(a.selectedId)
          a.setSelectedId(fallback) // keep the flow going after a delete
          return
        }
        case 's':
          e.preventDefault()
          row.querySelector<HTMLElement>('[data-snooze-trigger] button')?.click()
          return
        case 'd':
          e.preventDefault()
          row.querySelector<HTMLElement>('[data-due-edit] .cursor-pointer')?.click()
          return
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
