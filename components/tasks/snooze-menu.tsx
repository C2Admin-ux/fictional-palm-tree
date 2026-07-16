'use client'

// Compact snooze preset menu for task rows: Tomorrow / Next week (Mon)
// / Next month / Pick date… — no modal required. Optionally controlled
// (`open`/`onOpenChange`) so a swipe-left gesture can pop it open.

import { useEffect, useRef, useState } from 'react'
import { cn, todayISO, formatDateShort } from '@/lib/utils'
import { SNOOZE_PRESETS } from '@/lib/tasks/dates'
import { useClickOutside } from '@/components/ui/inline-edit'
import { Moon, CalendarDays } from 'lucide-react'

export function SnoozeMenu({
  onSnooze, open: controlledOpen, onOpenChange, buttonClassName,
}: {
  onSnooze: (date: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  buttonClassName?: string
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

  function choose(date: string) {
    setOpen(false)
    setPicking(false)
    onSnooze(date)
  }

  return (
    <div ref={ref} className="relative inline-block" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Snooze"
        className={cn(
          'p-1 rounded text-slate-300 hover:text-indigo-500 transition-all flex-shrink-0',
          buttonClassName
        )}>
        <Moon size={13} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[180px]">
          <div className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Snooze until
          </div>
          {SNOOZE_PRESETS.map(preset => {
            const date = preset.compute(today)
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => choose(date)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left">
                <Moon size={12} className="text-slate-300 flex-shrink-0" />
                <span className="flex-1">{preset.label}</span>
                <span className="text-xs text-slate-400">{formatDateShort(date)}</span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left">
            <CalendarDays size={12} className="text-slate-300 flex-shrink-0" />
            Pick date…
          </button>
          {picking && (
            <input
              ref={dateRef}
              type="date"
              min={today}
              onChange={e => { if (e.target.value) choose(e.target.value) }}
              className="absolute opacity-0 pointer-events-none w-0 h-0"
            />
          )}
        </div>
      )}
    </div>
  )
}
