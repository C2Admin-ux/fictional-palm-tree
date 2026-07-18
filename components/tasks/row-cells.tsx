'use client'

// Shared task-row cells, composed by both the tasks page TaskRow and
// the property profile PropertyTaskRow (the rows themselves stay
// separate — only the byte-identical fragments live here).

import type { Task } from '@/lib/supabase/types'
import { cn, isOverdue, isSoon, PRIORITY_DOT, RECUR_LABELS } from '@/lib/utils'
import { CALL_AUTO_SOURCE, OBLIGATION_SOURCES } from '@/lib/tasks/vocab'
import { InlineSelect, InlineDate, PRIORITY_OPTIONS } from '@/components/ui/inline-edit'
import { CHECK_MS } from '@/components/tasks/complete-collapse'
import { RefreshCw, Clock, AlertTriangle, Phone, X } from 'lucide-react'

// Priority pip — click to change priority.
export function PriorityPip({ priority, isDone, onSave }: {
  priority: Task['priority']
  isDone: boolean
  onSave: (priority: Task['priority']) => void
}) {
  return (
    <InlineSelect
      value={priority}
      options={PRIORITY_OPTIONS}
      onSave={v => onSave(v as Task['priority'])}
      trigger={
        // h-6 keeps breathing room inside the min-h-[30px] rows —
        // h-8 would touch the row demarcation lines.
        <div className="w-2 h-6 mr-3 flex-shrink-0 rounded-sm cursor-pointer hover:opacity-70 transition-opacity"
          style={{ background: isDone ? '#e2e8f0' : PRIORITY_DOT[priority] }} />
      }
    />
  )
}

// Complete / un-complete circle. data-complete-toggle lets the `c`
// shortcut click this exact button, so the keyboard rides the same
// complete-immediately + exit-animation path as the mouse (see
// complete-collapse.tsx — callers pass isDone || leaving so the check
// shows while the presentation-only exit runs).
export function CompleteCircle({ isDone, onToggle }: {
  isDone: boolean
  onToggle: () => void
}) {
  return (
    <button onClick={onToggle} data-complete-toggle
      className={cn(
        'w-4 h-4 rounded-full border-2 flex items-center justify-center mr-3 flex-shrink-0 transition-all',
        isDone ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 hover:border-blue-400'
      )}>
      {isDone && (
        // Duration comes from CHECK_MS (single source of truth for the
        // exit timing) — the keyframes live in globals.css.
        <svg width="8" height="6" viewBox="0 0 8 6" fill="none"
          style={{ animation: `check-pop ${CHECK_MS}ms ease-out` }}>
          <path d="M1 3l2.5 2.5L7 1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

// Recurrence + auto-generated badges rendered after the title.
export function TaskBadges({ task }: { task: Pick<Task, 'recur_freq' | 'auto_source'> }) {
  return (
    <span className="inline-flex items-center gap-1.5 ml-1">
      {task.recur_freq && (
        <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-1.5 py-0.5">
          <RefreshCw size={9} />{RECUR_LABELS[task.recur_freq]}
        </span>
      )}
      {task.auto_source != null && OBLIGATION_SOURCES.includes(task.auto_source) && (
        <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
          <Clock size={9} />Auto
        </span>
      )}
      {task.auto_source === CALL_AUTO_SOURCE && (
        <span className="inline-flex items-center gap-1 text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5">
          <Phone size={9} />Call
        </span>
      )}
    </span>
  )
}

// Hover-revealed delete X — instant optimistic delete with an Undo
// toast at the call site (parent rows and subtask rows alike).
export function DeleteX({ onDelete }: { onDelete: () => void }) {
  return (
    <div className="w-6 flex justify-center ml-1">
      <button onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all">
        <X size={13} />
      </button>
    </div>
  )
}

// Due date — inline date picker with overdue/soon tinting.
// (data-due-edit lets the `d` shortcut open it via the same click path.)
export function DueDateCell({ dueDate, isDone, onSave }: {
  dueDate: string | null
  isDone: boolean
  onSave: (v: string | null) => void
}) {
  const overdue = !isDone && isOverdue(dueDate)
  const soon = !isDone && !overdue && isSoon(dueDate, 7)
  return (
    <div data-due-edit className={cn('w-20 text-right flex-shrink-0',
      overdue ? 'text-red-600' : soon ? 'text-amber-600' : 'text-slate-400')}>
      {overdue && <AlertTriangle size={10} className="inline mr-1" />}
      <InlineDate
        value={dueDate}
        onSave={onSave}
        className={cn('text-xs', overdue ? 'text-red-600 font-semibold' : soon ? 'text-amber-600 font-medium' : 'text-slate-400')}
        emptyLabel="no date"
      />
    </div>
  )
}
