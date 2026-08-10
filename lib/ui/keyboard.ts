'use client'

// Shared guards for the app's desktop keyboard layers (the tasks page
// list shortcuts and the inspection triage sweep). One implementation so
// the two surfaces can never disagree about what counts as "typing" or
// which keys may auto-repeat.

// True while an input/textarea/select/contenteditable owns the focus —
// keyboard layers must stay inert so typing never triggers actions.
export function isEditableTarget(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

// Row-navigation keys — the only keys allowed to auto-repeat while held.
export function isNavKey(e: KeyboardEvent): boolean {
  return e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp'
}

// Sweep guard: a held-down ACTION key (disposition verb, complete,
// delete…) must not mow through the list — only navigation may repeat.
export function isRepeatedActionKey(e: KeyboardEvent): boolean {
  return e.repeat && !isNavKey(e)
}
