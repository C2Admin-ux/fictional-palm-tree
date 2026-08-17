'use client'

// RTM-style quick due-date menu: absolute presets (Today / Tomorrow /
// Next week / Next month), relative postpones (+1 day / +1 week), a real
// date picker for everything else, and Clear. One component for every
// surface that edits a due date — task rows, the edit modal, the batch
// bar — so "quickly set a due date" means the same thing everywhere.
//
// Sibling of SnoozeMenu, deliberately not merged with it: snooze hides a
// task until a date without moving the deadline; this MOVES the deadline.

import { useEffect, useRef, useState } from 'react'
import { cn, todayISO, formatDateShort } from '@/lib/utils'
import { DUE_PRESETS, POSTPONE_STEPS, postponeDate } from '@/lib/tasks/dates'
import { useClickOutside } from '@/components/ui/inline-edit'
import { CalendarDays, ChevronsRight, X } from 'lucide-react'

export function DueMenu({
  value, onSelect, trigger, align = 'right', open: controlledOpen, onOpenChange,
}: {
  value: string | null
  onSelect: (date: string | null) => void
  // The visible control the menu hangs off — the row cell renders the
  // date text, the modal renders a field-like button, the batch bar a
  // toolbar button.
  trigger: React.ReactNode
  align?: 'left' | 'right'
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (o: boolean) => {
    setInternalOpen(o)
    onOpenChange?.(o)
  }

  const ref = useRef<HTMLDivElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState(false)

  useClickOutside(ref, () => { if (open) { setOpen(false); setPicking(false) } })

  useEffect(() => {
    if (picking) dateRef.current?.showPicker?.()
  }, [picking])

  const today = todayISO()

  function choose(date: string | null) {
    setOpen(false)
    setPicking(false)
    onSelect(date)
  }

  return (
    <div ref={ref} className="relative inline-block" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        data-due-trigger
        onClick={() => setOpen(!open)}
        title="Set due date"
        className="cursor-pointer">
        {trigger}
      </button>

      {open && (
        <div className={cn(
          'absolute top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[180px]',
          align === 'right' ? 'right-0' : 'left-0',
        )}>
          <div className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Due
          </div>
          {DUE_PRESETS.map(preset => {
            const date = preset.compute(today)
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => choose(date)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left">
                <CalendarDays size={12} className="text-slate-300 flex-shrink-0" />
                <span className="flex-1">{preset.label}</span>
                <span className="text-xs text-slate-400">{formatDateShort(date)}</span>
              </button>
            )
          })}
          <div className="my-1 border-t border-slate-100" />
          {POSTPONE_STEPS.map(step => {
            const date = postponeDate(value, step.days, today)
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => choose(date)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left">
                <ChevronsRight size={12} className="text-slate-300 flex-shrink-0" />
                <span className="flex-1">{step.label}</span>
                <span className="text-xs text-slate-400">{formatDateShort(date)}</span>
              </button>
            )
          })}
          <div className="my-1 border-t border-slate-100" />
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left">
            <CalendarDays size={12} className="text-slate-300 flex-shrink-0" />
            Pick date…
          </button>
          {value != null && (
            <button
              type="button"
              onClick={() => choose(null)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 transition-colors text-left">
              <X size={12} className="text-slate-300 flex-shrink-0" />
              Clear due date
            </button>
          )}
          {picking && (
            <input
              ref={dateRef}
              type="date"
              onChange={e => { if (e.target.value) choose(e.target.value) }}
              className="absolute opacity-0 pointer-events-none w-0 h-0"
            />
          )}
        </div>
      )}
    </div>
  )
}
