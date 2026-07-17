'use client'

// Saved-views chips row for the tasks page: one chip per task_views
// row, an inline "+ Save view" name form, and a per-chip kebab menu
// (rename / delete). Dumb by design — the page owns the config
// capture/apply/compare logic and the Supabase writes; this renders
// names, the active state, and fires callbacks.

import { useRef, useState } from 'react'
import type { TaskView } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import { useClickOutside } from '@/components/ui/inline-edit'
import { Bookmark, Check, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'

export function SavedViewsBar({ views, activeId, onApply, onSaveNew, onRename, onDelete }: {
  views: TaskView[]
  activeId: string | null   // chip whose config matches the current state
  onApply: (view: TaskView) => void
  onSaveNew: (name: string) => void | Promise<void>
  onRename: (view: TaskView, name: string) => void
  onDelete: (view: TaskView) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  useClickOutside(formRef, () => { if (adding) { setAdding(false); setName('') } })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setAdding(false)
    setName('')
    await onSaveNew(trimmed)
  }

  return (
    <div className="flex items-center gap-1.5 px-6 py-2 border-b border-slate-200 bg-white flex-wrap flex-shrink-0">
      <Bookmark size={12} className="text-slate-300 flex-shrink-0" />
      {views.map(v => (
        <ViewChip key={v.id} view={v} active={v.id === activeId}
          onApply={() => onApply(v)}
          onRename={n => onRename(v, n)}
          onDelete={() => onDelete(v)} />
      ))}

      {adding ? (
        <form ref={formRef} onSubmit={submit} className="flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setAdding(false); setName('') } }}
            placeholder="View name…"
            className="input-sm w-36"
          />
          <button type="submit" disabled={!name.trim()}
            className="p-1 rounded text-blue-600 hover:bg-blue-50 disabled:text-slate-300 transition-colors"
            title="Save view">
            <Check size={13} />
          </button>
        </form>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-slate-400 border border-dashed border-slate-300 hover:text-blue-600 hover:border-blue-400 transition-colors">
          <Plus size={11} />Save view
        </button>
      )}
    </div>
  )
}

function ViewChip({ view, active, onApply, onRename, onDelete }: {
  view: TaskView
  active: boolean
  onApply: () => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(view.name)
  const ref = useRef<HTMLDivElement>(null)

  useClickOutside(ref, () => { setMenuOpen(false); setRenaming(false) })

  function submitRename(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = draft.trim()
    setRenaming(false)
    if (trimmed && trimmed !== view.name) onRename(trimmed)
  }

  if (renaming) {
    return (
      <form onSubmit={submitRename} className="inline-flex">
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') setRenaming(false) }}
          onBlur={submitRename}
          className="input-sm w-32"
        />
      </form>
    )
  }

  return (
    <div ref={ref} className="relative inline-flex items-center group/chip">
      <button
        onClick={onApply}
        className={cn(
          'flex items-center pl-2.5 pr-1 py-1 rounded-full text-xs font-medium border transition-all',
          active
            ? 'bg-blue-600 border-blue-600 text-white'
            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
        )}>
        {view.name}
        {/* Kebab inside the pill — hover-revealed on desktop, always
            reachable on touch */}
        <span
          role="button"
          tabIndex={0}
          aria-label={`Options for ${view.name}`}
          onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setMenuOpen(o => !o) } }}
          className={cn(
            'ml-0.5 p-0.5 rounded-full transition-all md:opacity-0 md:group-hover/chip:opacity-100',
            active ? 'text-blue-200 hover:text-white' : 'text-slate-300 hover:text-slate-500',
            menuOpen && 'md:opacity-100'
          )}>
          <MoreHorizontal size={12} />
        </span>
      </button>

      {menuOpen && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[130px]">
          <button
            onClick={() => { setMenuOpen(false); setDraft(view.name); setRenaming(true) }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left">
            <Pencil size={12} className="text-slate-400" />Rename
          </button>
          <button
            onClick={() => { setMenuOpen(false); onDelete() }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left">
            <Trash2 size={12} />Delete
          </button>
        </div>
      )}
    </div>
  )
}
