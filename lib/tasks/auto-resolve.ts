import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Task } from '@/lib/supabase/types'

// The one way a sync route closes an auto-generated task. Extracted
// because the write shape existed verbatim in three places (obligations
// engine ×2, renewal sync) and because the marker string is load-bearing:
// wasAutoResolved() lets a sync distinguish "the machine closed this
// because the world changed" from "a person closed this by hand" — the
// difference between safely recreating a task after an undo and
// resurrecting one someone deliberately finished.

const AUTO_RESOLVED_PREFIX = '(auto-resolved:'

export function autoResolveDescription(existing: string | null, reason: string): string {
  return [existing, `${AUTO_RESOLVED_PREFIX} ${reason})`].filter(Boolean).join('\n')
}

export async function autoResolveTask(
  supabase: SupabaseClient<Database>,
  task: Pick<Task, 'id' | 'description'>,
  reason: string,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from('tasks')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      description: autoResolveDescription(task.description, reason),
    })
    .eq('id', task.id)
  return { error }
}

// True when a done task was closed by a sync rather than a person. Keyed
// on the marker LINE (anywhere in the description): the marker is only
// ever appended by autoResolveTask, and manual edits that happen to
// mention "auto-resolved" mid-sentence don't match the line anchor.
export function wasAutoResolved(task: Pick<Task, 'description'>): boolean {
  return (task.description ?? '')
    .split('\n')
    .some(line => line.trimStart().startsWith(AUTO_RESOLVED_PREFIX))
}
