'use client'

// The multi-select batch bar — RTM's core move. Appears docked at the
// bottom of a task list while anything is checked: complete, set due,
// snooze, set priority, clear. Delete stays per-row on purpose —
// destructive batch operations deserve per-item friction.
//
// The bar owns no data: the page hands it the checked tasks and the
// mutation callbacks, so every action runs the same optimistic paths
// the row controls use.

import type { Task } from '@/lib/supabase/types'
import { PRIORITY_OPTIONS } from '@/components/ui/inline-edit'
import { DueMenu } from '@/components/tasks/due-menu'
import { SnoozeMenu } from '@/components/tasks/snooze-menu'
import { PRIORITY_DOT } from '@/lib/utils'
import { Check, X } from 'lucide-react'
import { useState } from 'react'

export function BatchBar({ count, onComplete, onDue, onSnooze, onPriority, onClear }: {
  count: number
  onComplete: () => void
  onDue: (date: string | null) => void
  onSnooze: (date: string) => void
  onPriority: (priority: Task['priority']) => void
  onClear: () => void
}) {
  const [priorityOpen, setPriorityOpen] = useState(false)
  if (count === 0) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-2xl shadow-xl px-3 py-2 flex items-center gap-1.5">
      <span className="text-xs font-semibold px-2 tabular-nums whitespace-nowrap">
        {count} selected
      </span>

      <button onClick={onComplete}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm hover:bg-white/10 transition-colors">
        <Check size={14} className="text-emerald-400" />Complete
      </button>

      <DueMenu
        value={null}
        onSelect={onDue}
        align="right"
        trigger={
          <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm hover:bg-white/10 transition-colors">
            Due ▾
          </span>
        }
      />

      <SnoozeMenu
        onSnooze={onSnooze}
        buttonClassName="!p-0"
        triggerContent={
          <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-white hover:bg-white/10 transition-colors">
            Snooze ▾
          </span>
        }
      />

      <div className="relative">
        <button onClick={() => setPriorityOpen(v => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm hover:bg-white/10 transition-colors">
          Priority ▾
        </button>
        {priorityOpen && (
          <div className="absolute right-0 bottom-full mb-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[130px]">
            {PRIORITY_OPTIONS.map(opt => (
              <button key={opt.value}
                onClick={() => { setPriorityOpen(false); onPriority(opt.value as Task['priority']) }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 text-left">
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: PRIORITY_DOT[opt.value] ?? '#94a3b8' }} />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button onClick={onClear} title="Clear selection (Esc)"
        className="p-1.5 rounded-lg hover:bg-white/10 transition-colors ml-1">
        <X size={14} />
      </button>
    </div>
  )
}