'use client'

import { memo, useState } from 'react'
import type { Task, Contact } from '@/lib/supabase/types'
import { cn, propertyColor, propertyAbbr } from '@/lib/utils'
import {
  Plus, Mountain,
  Link as LinkIcon, Check as CheckIcon,
} from 'lucide-react'
import { SnoozeMenu } from '@/components/tasks/snooze-menu'
import { SwipeRow } from '@/components/tasks/swipe-row'
import { PriorityPip, CompleteCircle, TaskBadges, DueDateCell, DeleteX } from '@/components/tasks/row-cells'
import { SubtaskChip, SubtaskList } from '@/components/tasks/subtask-list'
import { ContactActionMenu } from '@/components/tasks/contact-popover'
import { type ExitPhase, CollapseOnComplete } from '@/components/tasks/complete-collapse'
import { InlineText, InlineSelect, STATUS_OPTIONS } from '@/components/ui/inline-edit'

export type TaskWithRelations = Task & {
  properties?: { name: string } | null
  capex_projects?: { title: string } | null
  contacts?: Contact[]
}

// Handlers every task list needs, bundled so the three views share
// one prop shape.
export type RowHandlers = {
  onEdit: (task: TaskWithRelations) => void
  onDone: (task: TaskWithRelations) => void
  onDelete: (task: TaskWithRelations) => void
  onPatch: (task: TaskWithRelations, fields: Partial<Task>) => void
  onSnooze: (task: TaskWithRelations, date: string) => void
  // Keyboard-driven row selection (j/k etc.)
  onSelect: (id: string) => void
  // Local lookup — lets rows check whether a blocker still exists
  getTask: (id: string) => TaskWithRelations | undefined
  // Presentation-only exit animation state (useExitingRows) — stable
  // identity; rows read it for their subtask drill-downs.
  exitPhaseOf: (id: string) => ExitPhase | null
  // Subtask drill-down: toggle a parent's expanded state / inline add
  onToggleExpand: (id: string) => void
  onAddSubtask: (parent: TaskWithRelations, title: string) => void | Promise<void>
  // Multi-select for the batch bar: toggle a row (shift extends the
  // range from the last toggled row, RTM-style).
  onToggleCheck?: (id: string, shift: boolean) => void
}

// Per-view subtask plumbing: children lookup + which parents are open.
// (Passed as props, not via handlers, so memoized rows re-render when
// their own children change — the progress chip must move.)
export type SubtaskUi = {
  subtasksOf: (id: string) => TaskWithRelations[] | undefined
  expandedIds: Set<string>
}

// Keyboard selection can land on a subtask row (j/k walks the DOM in
// visual order). Resolve it to a prop only for the parent that owns
// it, so the other memoized rows don't re-render on selection moves.
export function subtaskSelection(ui: SubtaskUi, selectedId: string | null, parentId: string): string | null {
  if (!selectedId) return null
  return (ui.subtasksOf(parentId) ?? []).some(s => s.id === selectedId) ? selectedId : null
}

// ── Task Row ─────────────────────────────────────────────────
// Memoized: handlers/store are referentially stable, so a row only
// re-renders when its own task object (or selection) changes.

export const TaskRow = memo(function TaskRow({
  task, handlers, selected = false, meta, swipeable = false, subtasks, expanded = false,
  subtaskSelectedId = null, exitPhase = null, checked = false,
}: {
  task: TaskWithRelations
  handlers: RowHandlers
  selected?: boolean      // keyboard-selected (j/k)
  meta?: React.ReactNode  // extra info rendered on the second line (review views)
  swipeable?: boolean     // touch: swipe right = complete, swipe left = snooze
  subtasks?: TaskWithRelations[]  // children of this row (parents only)
  expanded?: boolean              // drill-down open (page-level session state)
  subtaskSelectedId?: string | null  // keyboard selection inside the drill-down
  exitPhase?: ExitPhase | null    // presentation-only completion exit (useExitingRows)
  checked?: boolean       // in the multi-select set (batch bar)
}) {
  const { onEdit, onDone, onDelete, onPatch, onSnooze, onSelect, onToggleCheck } = handlers
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const isDone = task.status === 'done'
  // RTM completion feel, presentation-only: every completion surface on
  // this row (circle, swipe, status dropdown, keyboard 'c' via
  // data-complete-toggle) calls onDone, which fires the mutation
  // IMMEDIATELY and starts the exit animation; while it plays, this row
  // is the pre-completion snapshot (exitPhase non-null: check popped,
  // pointer-events off, collapsing). Un-completing skips the animation.
  const leaving = exitPhase != null
  const taskContacts = task.contacts ?? []
  const pc = task.properties?.name ? propertyColor(task.properties.name) : '#64748b'
  const isRock = (task.tags ?? []).includes('rock')
  // Same semantics as the agenda's isUnblocked: only a blocker that
  // still exists locally and isn't done counts (no chip on dangling ids).
  const blocker = task.blocked_by_task_id ? handlers.getTask(task.blocked_by_task_id) : undefined
  const isBlocked = blocker != null && blocker.status !== 'done'

  // Fire-and-forget: the optimistic store already applied the change,
  // so the inline-edit primitives never sit in a saving state.
  function patch(fields: Partial<Task>) {
    onPatch(task, fields)
  }

  function toggleRock() {
    const tags = isRock
      ? (task.tags ?? []).filter(t => t !== 'rock')
      : [...(task.tags ?? []), 'rock']
    patch({ tags })
  }

  const row = (
    <div
      data-task-id={task.id}
      onClick={() => onSelect(task.id)}
      className={cn(
        'flex items-center px-6 py-0 min-h-[30px] border-b border-slate-200/70 group hover:bg-slate-50 transition-colors',
        isDone && 'opacity-60',
        selected && 'bg-blue-50/70 hover:bg-blue-50/70 ring-1 ring-inset ring-blue-200',
        checked && 'bg-indigo-50/60 hover:bg-indigo-50/60'
      )}>
      {/* Multi-select checkbox — hover-revealed, pinned visible once
          checked. shift-click extends the range (page logic); `x` on
          the keyboard toggles the selected row. */}
      {onToggleCheck && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onToggleCheck(task.id, e.shiftKey) }}
          title="Select for batch actions (x)"
          className={cn(
            'w-4 h-4 mr-2 rounded border flex items-center justify-center flex-shrink-0 transition-all',
            checked
              ? 'bg-indigo-500 border-indigo-500 text-white'
              : 'border-slate-300 text-transparent opacity-0 group-hover:opacity-100'
          )}>
          <CheckIcon size={11} strokeWidth={3} />
        </button>
      )}

      {/* Priority pip — click to change priority */}
      <PriorityPip priority={task.priority} isDone={isDone}
        onSave={priority => patch({ priority })} />

      {/* Checkbox */}
      <CompleteCircle isDone={isDone || leaving} onToggle={() => onDone(task)} />

      {/* Title — inline editable. Property/CapEx/blocked chips and meta
          sit inline to its right (title truncates first) so a row stays
          a single ~30px line. Below md the property chip collapses to
          its 2-letter abbreviation to leave the title room. */}
      <div className="flex-1 min-w-0 py-1 flex items-center gap-2 overflow-hidden">
        <div className={cn('flex items-center min-w-0 flex-shrink text-sm text-slate-900', isDone && 'line-through text-slate-400')}>
          <InlineText
            value={task.title}
            onSave={v => patch({ title: v })}
            displayClassName="font-medium"
          />
          <TaskBadges task={task} />
          {subtasks != null && subtasks.length > 0 && (
            <SubtaskChip
              subtasks={subtasks}
              expanded={expanded}
              onToggle={() => handlers.onToggleExpand(task.id)}
            />
          )}
        </div>
        {task.properties?.name && (
          <>
            <span className="hidden md:inline-block flex-shrink-0 max-w-[13ch] truncate text-xs font-medium px-1.5 py-0.5 rounded"
              style={{ background: `${pc}18`, color: pc }}>
              {task.properties.name}
            </span>
            <span className="md:hidden flex-shrink-0 text-[10px] font-semibold px-1 py-0.5 rounded"
              style={{ background: `${pc}18`, color: pc }}
              title={task.properties.name}>
              {propertyAbbr(task.properties.name)}
            </span>
          </>
        )}
        {task.capex_projects?.title && (
          <span className="flex-shrink min-w-0 max-w-[11rem] text-xs text-orange-600 inline-flex items-center gap-1">
            <LinkIcon size={9} className="flex-shrink-0" />
            <span className="truncate">{task.capex_projects.title}</span>
          </span>
        )}
        {isBlocked && (
          <span className="flex-shrink-0 text-xs text-amber-600 whitespace-nowrap">⛓ blocked</span>
        )}
        {meta && <span className="min-w-0 truncate">{meta}</span>}
      </div>

      {/* Rock toggle — 'rock' tag on/off */}
      <button
        onClick={toggleRock}
        title={isRock ? 'Remove from rocks' : 'Mark as a rock'}
        className={cn('mr-1 p-1 rounded flex-shrink-0 transition-all',
          isRock
            ? 'text-amber-500 hover:text-amber-600'
            : 'text-slate-200 hover:text-amber-400 opacity-0 group-hover:opacity-100')}>
        <Mountain size={13} />
      </button>

      {/* Status — inline dropdown. Completing routes through onDone so
          it picks up the undo toast + recurrence handling. */}
      <div className="w-28 hidden md:flex justify-center">
        <InlineSelect
          value={task.status}
          options={STATUS_OPTIONS}
          onSave={v => {
            if (v === 'done') onDone(task)
            else patch({ status: v as Task['status'], completed_at: null })
          }}
        />
      </div>

      {/* People avatars — tap for call/text/email actions */}
      <div className="w-24 hidden lg:flex justify-center items-center gap-1">
        {taskContacts.slice(0, 3).map((c: Contact) => (
          <ContactActionMenu key={c.id} contact={c} align="right">
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
              style={{ background: c.color_hex ?? '#64748b' }}>
              {c.initials ?? c.full_name.slice(0, 2).toUpperCase()}
            </span>
          </ContactActionMenu>
        ))}
        {taskContacts.length > 3 && (
          <span className="text-xs text-slate-400">+{taskContacts.length - 3}</span>
        )}
        <button onClick={() => onEdit(task)}
          className="w-6 h-6 rounded-full border border-dashed border-slate-300 flex items-center justify-center text-slate-300 hover:border-blue-400 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0">
          <Plus size={10} />
        </button>
      </div>

      {/* Due date — inline date picker (data-due-edit lets the `d`
          shortcut open it via the same click path) */}
      <DueDateCell dueDate={task.due_date} isDone={isDone}
        onSave={v => patch({ due_date: v })} />

      {/* Snooze presets — no modal needed. Always visible on mobile,
          hover-revealed on desktop; the `s` shortcut clicks this same
          trigger. */}
      <div data-snooze-trigger className="w-6 flex justify-center">
        <SnoozeMenu
          open={snoozeOpen}
          onOpenChange={setSnoozeOpen}
          onSnooze={date => onSnooze(task, date)}
          buttonClassName="md:opacity-0 md:group-hover:opacity-100"
        />
      </div>

      {/* Delete — instant, with an Undo toast */}
      <DeleteX onDelete={() => onDelete(task)} />
    </div>
  )

  const body = swipeable ? (
    <SwipeRow
      onSwipeRight={() => onDone(task)}
      onSwipeLeft={() => setSnoozeOpen(true)}>
      {row}
    </SwipeRow>
  ) : row

  // The collapse wraps the row AND its expanded drill-down: completing
  // a parent takes the whole block out in one motion.
  return (
    <CollapseOnComplete phase={exitPhase}>
      {body}
      {subtasks != null && subtasks.length > 0 && expanded && (
        <SubtaskList
          subtasks={subtasks}
          selectedId={subtaskSelectedId}
          onSelect={onSelect}
          exitPhaseOf={handlers.exitPhaseOf}
          onToggleDone={onDone}
          onPatch={onPatch}
          onDelete={onDelete}
          onAdd={title => handlers.onAddSubtask(task, title)}
        />
      )}
    </CollapseOnComplete>
  )
})
