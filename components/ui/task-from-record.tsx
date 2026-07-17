'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Task } from '@/lib/supabase/types'
import { recordTaskInsertPayload, insertTask, notifyTaskCreated } from '@/lib/tasks/create'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { Plus } from 'lucide-react'
import { Modal } from '@/components/ui/modal'

// ── TaskFromRecord ───────────────────────────────────────────
// Small "+ Task" button that opens a compact modal to create a
// follow-up task pre-filled from the record it sits on (insurance
// policy, contract, PCA item, …). Rides the shared creation path
// (lib/tasks/create.ts), so open task lists pick the new row up via
// the c2:task-created broadcast.

export function TaskFromRecord({
  title, propertyId = null, tags = [], className = '',
}: {
  title: string
  propertyId?: string | null
  tags?: string[]
  className?: string
}) {
  const supabase = createClient()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState(title)
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('medium')
  const [saving, setSaving] = useState(false)

  function openModal() {
    setDraftTitle(title)
    setDueDate('')
    setPriority('medium')
    setOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    // getSession reads the local session — no network round-trip.
    const { data: { session } } = await supabase.auth.getSession()
    const created = await insertTask(supabase, recordTaskInsertPayload({
      title:      draftTitle.trim(),
      propertyId,
      tags,
      priority,
      dueDate:    dueDate || null,
      userId:     session?.user.id ?? null,
    }))
    setSaving(false)
    if (!created) {
      toast('Could not create task', { tone: 'error' })
      return // keep the modal (and the typed draft) for a retry
    }
    setOpen(false)
    notifyTaskCreated(router)
  }

  // stopPropagation wrapper: these buttons live inside clickable
  // table rows, so neither the button nor the modal may bubble.
  return (
    <span onClick={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={openModal}
        title="Create follow-up task"
        className={cn(
          'inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-500 p-1 transition-colors',
          className
        )}>
        <Plus size={12} />Task
      </button>

      {open && (
        <Modal title="New Task" onClose={() => setOpen(false)} maxWidth="md">
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div>
              <label className="label">Title *</label>
              <input
                required
                autoFocus
                value={draftTitle}
                onChange={e => setDraftTitle(e.target.value)}
                className="input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Due Date</label>
                <input type="date" value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="input" />
              </div>
              <div>
                <label className="label">Priority</label>
                <select value={priority}
                  onChange={e => setPriority(e.target.value as Task['priority'])}
                  className="input">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={saving || !draftTitle.trim()} className="btn-primary">
                {saving ? 'Saving…' : 'Create task'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </span>
  )
}
