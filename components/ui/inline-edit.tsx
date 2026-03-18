'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

// ── useClickOutside ──────────────────────────────────────────

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    function listener(e: MouseEvent) {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      handler()
    }
    document.addEventListener('mousedown', listener)
    return () => document.removeEventListener('mousedown', listener)
  }, [ref, handler])
}

// ── InlineText ───────────────────────────────────────────────
// Click to edit a text field in-place

export function InlineText({
  value, onSave, className = '', placeholder = '—',
  multiline = false, displayClassName = '',
}: {
  value: string | null | undefined
  onSave: (v: string) => Promise<void> | void
  className?: string
  placeholder?: string
  multiline?: boolean
  displayClassName?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  useClickOutside(ref, async () => {
    if (!editing) return
    if (draft !== (value ?? '')) {
      setSaving(true)
      await onSave(draft)
      setSaving(false)
    }
    setEditing(false)
  })

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function startEdit() {
    setDraft(value ?? '')
    setEditing(true)
  }

  async function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault()
      if (draft !== (value ?? '')) {
        setSaving(true)
        await onSave(draft)
        setSaving(false)
      }
      setEditing(false)
    }
    if (e.key === 'Escape') {
      setDraft(value ?? '')
      setEditing(false)
    }
  }

  if (editing) {
    const sharedProps = {
      ref: inputRef as any,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onKeyDown: handleKeyDown,
      className: cn('w-full bg-white border border-blue-400 rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400', className),
    }
    return (
      <div ref={ref} className="min-w-0">
        {multiline
          ? <textarea {...sharedProps} rows={2} className={cn(sharedProps.className, 'resize-none')} />
          : <input {...sharedProps} />
        }
      </div>
    )
  }

  return (
    <div
      onClick={startEdit}
      className={cn(
        'cursor-text rounded px-1 -mx-1 py-0.5 hover:bg-slate-100 transition-colors min-w-[40px] truncate',
        saving && 'opacity-50',
        displayClassName
      )}>
      {saving
        ? <span className="text-slate-400">…</span>
        : value
          ? <span>{value}</span>
          : <span className="text-slate-300 italic">{placeholder}</span>
      }
    </div>
  )
}

// ── InlineSelect ─────────────────────────────────────────────
// Click to open a styled dropdown of options

type Option = { value: string; label: string; className?: string; dot?: string }

export function InlineSelect({
  value, options, onSave, className = '', trigger,
}: {
  value: string | null | undefined
  options: Option[]
  onSave: (v: string) => Promise<void> | void
  className?: string
  trigger?: React.ReactNode  // custom display element, defaults to the current option label
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useClickOutside(ref, () => setOpen(false))

  async function select(v: string) {
    setOpen(false)
    if (v === value) return
    setSaving(true)
    await onSave(v)
    setSaving(false)
  }

  const current = options.find(o => o.value === value)

  return (
    <div ref={ref} className="relative inline-block">
      <div
        onClick={() => !saving && setOpen(o => !o)}
        className={cn('cursor-pointer rounded px-1 -mx-1 hover:bg-slate-100 transition-colors select-none', saving && 'opacity-50', className)}>
        {saving
          ? <span className="text-slate-400 text-xs">…</span>
          : trigger ?? (
            current
              ? <span className={cn('badge text-xs', current.className)}>
                  {current.dot && <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: current.dot }} />}
                  {current.label}
                </span>
              : <span className="text-slate-300 text-xs italic">—</span>
          )
        }
      </div>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[160px]"
          style={{ minWidth: 'max-content' }}>
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => select(opt.value)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 transition-colors text-left',
                opt.value === value && 'bg-slate-50'
              )}>
              {opt.dot && (
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: opt.dot }} />
              )}
              <span className={opt.className ?? 'text-slate-700'}>{opt.label}</span>
              {opt.value === value && <Check size={12} className="ml-auto text-blue-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── InlineDate ───────────────────────────────────────────────
// Click to open a date picker inline

export function InlineDate({
  value, onSave, className = '', emptyLabel = '—',
}: {
  value: string | null | undefined
  onSave: (v: string | null) => Promise<void> | void
  className?: string
  emptyLabel?: string
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useClickOutside(ref, () => setEditing(false))

  useEffect(() => {
    if (editing) inputRef.current?.showPicker?.()
  }, [editing])

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value || null
    setEditing(false)
    setSaving(true)
    await onSave(v)
    setSaving(false)
  }

  const formatted = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <div ref={ref} className="relative inline-block">
      <div
        onClick={() => setEditing(true)}
        className={cn('cursor-pointer rounded px-1 -mx-1 hover:bg-slate-100 transition-colors text-xs select-none', saving && 'opacity-50', className)}>
        {saving ? <span className="text-slate-400">…</span> : formatted ?? <span className="text-slate-300 italic">{emptyLabel}</span>}
      </div>
      {editing && (
        <input
          ref={inputRef}
          type="date"
          defaultValue={value ?? ''}
          onChange={handleChange}
          className="absolute opacity-0 pointer-events-none w-0 h-0"
        />
      )}
    </div>
  )
}

// ── Option presets ───────────────────────────────────────────

export const STATUS_OPTIONS: Option[] = [
  { value: 'inbox',       label: 'Inbox',       className: 'text-indigo-700 bg-indigo-50 border border-indigo-200', dot: '#6366f1' },
  { value: 'next_action', label: 'Next action', className: 'text-blue-700 bg-blue-50 border border-blue-200',       dot: '#3b82f6' },
  { value: 'waiting',     label: 'Waiting',     className: 'text-purple-700 bg-purple-50 border border-purple-200', dot: '#a855f7' },
  { value: 'blocked',     label: 'Blocked',     className: 'text-amber-700 bg-amber-50 border border-amber-200',    dot: '#f59e0b' },
  { value: 'done',        label: 'Done',        className: 'text-slate-500 bg-slate-50 border border-slate-200',    dot: '#94a3b8' },
]

export const PRIORITY_OPTIONS: Option[] = [
  { value: 'urgent', label: 'Urgent', dot: '#ef4444' },
  { value: 'high',   label: 'High',   dot: '#f97316' },
  { value: 'medium', label: 'Medium', dot: '#3b82f6' },
  { value: 'low',    label: 'Low',    dot: '#94a3b8' },
]

export const CAPEX_STATUS_OPTIONS: Option[] = [
  { value: 'planning',    label: 'Planning',    className: 'text-slate-600 bg-slate-50 border border-slate-200',   dot: '#94a3b8' },
  { value: 'approved',    label: 'Approved',    className: 'text-blue-700 bg-blue-50 border border-blue-200',      dot: '#3b82f6' },
  { value: 'in_progress', label: 'In Progress', className: 'text-amber-700 bg-amber-50 border border-amber-200',   dot: '#f59e0b' },
  { value: 'complete',    label: 'Complete',    className: 'text-emerald-700 bg-emerald-50 border border-emerald-200', dot: '#16a34a' },
  { value: 'on_hold',     label: 'On Hold',     className: 'text-orange-700 bg-orange-50 border border-orange-200', dot: '#ea580c' },
]

export const CAPEX_CATEGORY_OPTIONS: Option[] = [
  { value: 'roof',       label: 'Roof' },
  { value: 'hvac',       label: 'HVAC' },
  { value: 'plumbing',   label: 'Plumbing' },
  { value: 'exterior',   label: 'Exterior' },
  { value: 'unit_turn',  label: 'Unit Turn' },
  { value: 'amenity',    label: 'Amenity' },
  { value: 'other',      label: 'Other' },
]

export const CAPEX_PRIORITY_OPTIONS: Option[] = [
  { value: 'high',   label: 'High',   dot: '#ef4444' },
  { value: 'medium', label: 'Medium', dot: '#f59e0b' },
  { value: 'low',    label: 'Low',    dot: '#94a3b8' },
]
