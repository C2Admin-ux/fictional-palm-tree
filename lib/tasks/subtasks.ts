// Single-level subtask helpers shared by the tasks page and the
// property profile Tasks tab. The app rule they encode: subtasks NEVER
// render as top-level rows — every list and count starts from
// topLevel(), and children hang off their parent via childrenByParent()
// (drill-down only).

import type { Task } from '@/lib/supabase/types'

export function topLevel<T extends Pick<Task, 'parent_task_id'>>(tasks: T[]): T[] {
  return tasks.filter(t => !t.parent_task_id)
}

export function childrenByParent<T extends Pick<Task, 'parent_task_id'>>(tasks: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const t of tasks) {
    if (!t.parent_task_id) continue
    const arr = m.get(t.parent_task_id)
    if (arr) arr.push(t)
    else m.set(t.parent_task_id, [t])
  }
  return m
}

// A parent's open children — what completing the parent sweeps along.
export function openSubtasksOf<T extends Pick<Task, 'parent_task_id' | 'status'>>(
  tasks: T[], parentId: string
): T[] {
  return tasks.filter(t => t.parent_task_id === parentId && t.status !== 'done')
}

// Progress for the "2/5" chip on a parent row.
export function subtaskProgress(children: Pick<Task, 'status'>[]): { done: number; total: number } {
  return { done: children.filter(c => c.status === 'done').length, total: children.length }
}
