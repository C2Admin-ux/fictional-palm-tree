'use client'

// Single-level subtask drill-down, shared by the tasks page and the
// property profile Tasks tab. Two pieces:
//   SubtaskChip — the "2/5" progress chip + chevron rendered inside a
//     parent row (subtle; click toggles the expanded list).
//   SubtaskList — the indented rows revealed under an expanded parent:
//     complete circle, inline title, due date, delete — the lean
//     affordance set from row-cells — plus an inline "+ subtask" input.
// Expansion state lives in the calling page (per-session React state).

import { useState } from 'react'
import type { Task } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import { subtaskProgress } from '@/lib/tasks/subtasks'
import { InlineText } from '@/components/ui/inline-edit'
import { CompleteCircle, DeleteX, DueDateCell } from '@/components/tasks/row-cells'
import { CollapseOnComplete, type ExitPhase } from '@/components/tasks/complete-collapse'
import { ChevronDown, CornerDownRight, Plus } from 'lucide-react'

export function SubtaskChip({ subtasks, expanded, onToggle }: {
  subtasks: Pick<Task, 'status'>[]
  expanded: boolean
  onToggle: () => void
}) {
  const { done, total } = subtaskProgress(subtasks)
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onToggle() }}
      title={expanded ? 'Hide subtasks' : 'Show subtasks'}
      className={cn(
        'inline-flex items-center gap-0.5 ml-1.5 text-xs rounded-full pl-1 pr-1.5 py-0.5 border transition-colors align-middle',
        done === total
          ? 'text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
          : 'text-slate-500 bg-slate-50 border-slate-200 hover:bg-slate-100'
      )}>
      <ChevronDown size={10} className={cn('transition-transform', !expanded && '-rotate-90')} />
      {done}/{total}
    </button>
  )
}

// Handlers mirror the parent row's — subtask rows reuse the exact same
// optimistic mutation paths (complete → undo toast, delete → undo).
// selectedId/onSelect are optional (the property tab has no keyboard
// layer): rows carry data-task-id, so j/k walks into the drill-down
// and c/d/e/⌫ act on the selected subtask.
// exitPhaseOf reports the page-level exit animation state for a row
// (see useExitingRows) — completing fires the mutation immediately and
// the collapse here is presentation-only.
export function SubtaskList<T extends Task>({
  subtasks, onToggleDone, onPatch, onDelete, onAdd, selectedId = null, onSelect, exitPhaseOf,
}: {
  subtasks: T[]
  onToggleDone: (task: T) => void
  onPatch: (task: T, fields: Partial<Task>) => void
  onDelete: (task: T) => void
  onAdd: (title: string) => void | Promise<void>
  selectedId?: string | null
  onSelect?: (id: string) => void
  exitPhaseOf?: (id: string) => ExitPhase | null
}) {
  // Open first, completed (muted, un-completable) after.
  const open = subtasks.filter(t => t.status !== 'done')
  const done = subtasks.filter(t => t.status === 'done')

  return (
    <div className="bg-slate-50/50 border-b border-slate-200/70">
      {[...open, ...done].map(t => (
        <SubtaskRow key={t.id} task={t}
          selected={t.id === selectedId}
          onSelect={onSelect}
          exitPhase={exitPhaseOf?.(t.id) ?? null}
          onToggleDone={() => onToggleDone(t)}
          onPatch={fields => onPatch(t, fields)}
          onDelete={() => onDelete(t)} />
      ))}
      <SubtaskAdd onAdd={onAdd} />
    </div>
  )
}

function SubtaskRow<T extends Task>({ task, selected, onSelect, exitPhase, onToggleDone, onPatch, onDelete }: {
  task: T
  selected: boolean
  onSelect?: (id: string) => void
  exitPhase: ExitPhase | null
  onToggleDone: () => void
  onPatch: (fields: Partial<Task>) => void
  onDelete: () => void
}) {
  const isDone = task.status === 'done'
  // Same RTM completion feel as full rows — check pop, collapse out —
  // but purely visual: onToggleDone already fired the mutation, and this
  // row is the pre-completion snapshot kept in place by useExitingRows.
  // It reappears in the muted done tail of this list once the exit ends
  // (un-completing from there is instant and unanimated).
  const leaving = exitPhase != null
  return (
    <CollapseOnComplete phase={exitPhase}>
      <div
        data-task-id={task.id}
        onClick={() => onSelect?.(task.id)}
        className={cn(
          // No last:border-b-0 — each row is the sole child of its
          // CollapseOnComplete wrapper, so `last:` always matched and
          // suppressed every border. The add-subtask row below the last
          // row keeps its border from doubling the container's edge.
          'flex items-center pl-14 pr-6 py-0 min-h-[28px] border-b border-slate-200/70 group hover:bg-slate-100/60 transition-colors',
          isDone && 'opacity-60',
          selected && 'bg-blue-50/70 hover:bg-blue-50/70 ring-1 ring-inset ring-blue-200'
        )}>
        <CornerDownRight size={11} className="text-slate-300 mr-2 flex-shrink-0" />
        <CompleteCircle isDone={isDone || leaving} onToggle={onToggleDone} />
        <div className="flex-1 min-w-0 py-1">
          <div className={cn('text-sm text-slate-800', isDone && 'line-through text-slate-400')}>
            <InlineText value={task.title} onSave={v => onPatch({ title: v })} />
          </div>
        </div>
        <DueDateCell dueDate={task.due_date} isDone={isDone}
          onSave={v => onPatch({ due_date: v })} />
        <DeleteX onDelete={onDelete} />
      </div>
    </CollapseOnComplete>
  )
}

function SubtaskAdd({ onAdd }: { onAdd: (title: string) => void | Promise<void> }) {
  const [value, setValue] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const title = value.trim()
    if (!title) return
    setValue('') // optimistic: clear immediately, ready for the next one
    await onAdd(title)
  }

  return (
    <form onSubmit={submit} className="flex items-center pl-[70px] pr-6 py-1.5">
      <Plus size={12} className="text-slate-300 mr-2 flex-shrink-0" />
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setValue(''); (e.target as HTMLInputElement).blur() } }}
        placeholder="Add subtask…"
        className="flex-1 min-w-0 bg-transparent text-sm text-slate-700 placeholder:text-slate-300 placeholder:italic focus:outline-none py-0.5"
      />
    </form>
  )
}
