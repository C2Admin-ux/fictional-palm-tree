'use client'

// Shared task-row cells, composed by both the tasks page TaskRow and
// the property profile PropertyTaskRow (the rows themselves stay
// separate — only the byte-identical fragments live here).

import type { Task } from '@/lib/supabase/types'
import { cn, isOverdue, isSoon, PRIORITY_DOT, RECUR_LABELS } from '@/lib/utils'
import { InlineSelect, InlineDate, PRIORITY_OPTIONS } from '@/components/ui/inline-edit'
import { RefreshCw, Clock, AlertTriangle } from 'lucide-react'

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
        <div className="w-2 h-8 mr-3 flex-shrink-0 rounded-sm cursor-pointer hover:opacity-70 transition-opacity"
          style={{ background: isDone ? '#e2e8f0' : PRIORITY_DOT[priority] }} />
      }
    />
  )
}

// Complete / un-complete circle.
export function CompleteCircle({ isDone, onToggle }: {
  isDone: boolean
  onToggle: () => void
}) {
  return (
    <button onClick={onToggle}
      className={cn(
        'w-4 h-4 rounded-full border-2 flex items-center justify-center mr-3 flex-shrink-0 transition-all',
        isDone ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 hover:border-blue-400'
      )}>
      {isDone && (
        <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
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
      {task.auto_source === 'expiration' && (
        <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
          <Clock size={9} />Auto
        </span>
      )}
    </span>
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
