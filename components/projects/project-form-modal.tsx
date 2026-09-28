'use client'

// Create / edit a project. Projects are lightweight containers (title,
// owner, property, dates, status) — the work lives in their tasks.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Project, Property, UserProfile } from '@/lib/supabase/types'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'

export const PROJECT_STATUS_LABEL: Record<Project['status'], string> = {
  active: 'Active',
  on_hold: 'On hold',
  done: 'Done',
}

export function ProjectFormModal({ project, properties, people, userId, onClose, onSaved }: {
  project: Project | null
  properties: Property[]
  people: UserProfile[]
  userId: string | null
  onClose: () => void
  onSaved: (project: Project) => void
}) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title:       project?.title ?? '',
    description: project?.description ?? '',
    property_id: project?.property_id ?? '',
    owner_id:    project?.owner_id ?? userId ?? '',
    status:      project?.status ?? 'active',
    start_date:  project?.start_date ?? '',
    due_date:    project?.due_date ?? '',
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    const payload = {
      title:       form.title.trim(),
      description: form.description.trim() || null,
      property_id: form.property_id || null,
      owner_id:    form.owner_id || null,
      status:      form.status as Project['status'],
      start_date:  form.start_date || null,
      due_date:    form.due_date || null,
      updated_at:  new Date().toISOString(),
    }
    const res = project
      ? await supabase.from('projects').update(payload).eq('id', project.id).select('*').single()
      : await supabase.from('projects').insert({ ...payload, created_by: userId }).select('*').single()
    setSaving(false)
    if (res.error || !res.data) {
      toast('Could not save project', { tone: 'error' })
      return
    }
    onSaved(res.data as Project)
  }

  return (
    <Modal title={project ? 'Edit project' : 'New project'} onClose={onClose} maxWidth="lg">
      <form onSubmit={submit} className="p-6 space-y-4">
        <div>
          <label className="label">Title *</label>
          <input required autoFocus value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="input" placeholder="e.g. Brix due diligence, Q4 replacement reserve draws" />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className="input min-h-[60px] resize-none" placeholder="What does done look like?" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Property</label>
            <select value={form.property_id}
              onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))} className="input">
              <option value="">Portfolio-wide</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Owner</label>
            <select value={form.owner_id}
              onChange={e => setForm(f => ({ ...f, owner_id: e.target.value }))} className="input">
              <option value="">Unassigned</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.full_name ?? 'Unnamed user'}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Start</label>
            <input type="date" value={form.start_date}
              onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Target date</label>
            <input type="date" value={form.due_date}
              onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Status</label>
            <select value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as Project['status'] }))} className="input">
              {(Object.keys(PROJECT_STATUS_LABEL) as Project['status'][]).map(s =>
                <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : project ? 'Save' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
