'use client'

// Projects — Asana-style containers that group tasks across people and
// properties (due diligence, renewal season, lender draws…). One row
// per project with owner, target date and progress; click through for
// its List / Board / Timeline. Capex projects keep their own module.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Project, Property, UserProfile } from '@/lib/supabase/types'
import { cn, formatDate, propertyColor, todayISO } from '@/lib/utils'
import { FilterSelect } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { SchemaGapNotice } from '@/components/ui/schema-gap-notice'
import { isSchemaGapError } from '@/lib/supabase/schema-errors'
import { ProjectFormModal, PROJECT_STATUS_LABEL } from '@/components/projects/project-form-modal'
import { FolderKanban, Plus, ChevronRight } from 'lucide-react'

type ProjectRow = Project & { properties: { name: string } | null }
type Stats = { open: number; done: number; overdue: number; nextDue: string | null }

export default function ProjectsPage() {
  const supabase = useMemo(() => createClient(), [])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [stats, setStats] = useState<Record<string, Stats>>({})
  const [properties, setProperties] = useState<Property[]>([])
  const [people, setPeople] = useState<UserProfile[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [schemaGap, setSchemaGap] = useState<{ code?: string | null; message?: string | null } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'active' | 'on_hold' | 'done' | 'all'>('active')
  const [filterOwner, setFilterOwner] = useState('')

  const fetchAll = useCallback(async () => {
    const [projRes, taskRes, propRes, peopleRes, auth] = await Promise.all([
      supabase.from('projects').select('*, properties(name)').order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('tasks').select('project_id, status, due_date').not('project_id', 'is', null).is('parent_task_id', null),
      supabase.from('properties').select('*').eq('status', 'active').order('name'),
      supabase.from('user_profiles').select('*').order('full_name'),
      supabase.auth.getUser(),
    ])
    if (projRes.error) {
      if (isSchemaGapError(projRes.error)) setSchemaGap(projRes.error)
      setLoading(false)
      return
    }
    const today = todayISO()
    const s: Record<string, Stats> = {}
    for (const t of (taskRes.data ?? []) as { project_id: string; status: string; due_date: string | null }[]) {
      const e = (s[t.project_id] ??= { open: 0, done: 0, overdue: 0, nextDue: null })
      if (t.status === 'done') { e.done++; continue }
      e.open++
      if (t.due_date && t.due_date < today) e.overdue++
      if (t.due_date && t.due_date >= today && (!e.nextDue || t.due_date < e.nextDue)) e.nextDue = t.due_date
    }
    setProjects((projRes.data ?? []) as unknown as ProjectRow[])
    setStats(s)
    setProperties((propRes.data ?? []) as Property[])
    setPeople((peopleRes.data ?? []) as UserProfile[])
    setUserId(auth.data.user?.id ?? null)
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchAll() }, [fetchAll])

  const ownerName = (id: string | null) => people.find(p => p.id === id)?.full_name ?? '—'
  const visible = projects.filter(p =>
    (filterStatus === 'all' || p.status === filterStatus) &&
    (!filterOwner || p.owner_id === filterOwner))
  const activeCount = projects.filter(p => p.status === 'active').length

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeCount} active project{activeCount === 1 ? '' : 's'} · group related tasks, share them out, see them on a board or timeline
          </p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus size={14} />New Project</button>
      </div>

      {schemaGap && (
        <SchemaGapNotice error={schemaGap}
          detail="Projects need migration 0020 — run it in the Supabase SQL Editor. Nothing has been lost." />
      )}

      {!schemaGap && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <FilterSelect value={filterStatus} onChange={v => setFilterStatus(v as typeof filterStatus)}>
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="done">Done</option>
              <option value="all">All statuses</option>
            </FilterSelect>
            <FilterSelect value={filterOwner} onChange={setFilterOwner}>
              <option value="">All owners</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.full_name ?? 'Unnamed user'}</option>)}
            </FilterSelect>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
          ) : visible.length === 0 ? (
            <EmptyState icon={<FolderKanban size={32} />}
              title={projects.length === 0 ? 'No projects yet' : 'No projects match your filters'}
              hint={projects.length === 0 ? 'Start one for work with several steps or several people, like a due diligence checklist or quarterly reserve draws.' : undefined} />
          ) : (
            <div className="card divide-y divide-slate-200/70">
              {visible.map(p => {
                const st = stats[p.id] ?? { open: 0, done: 0, overdue: 0, nextDue: null }
                const total = st.open + st.done
                const pct = total ? Math.round(st.done / total * 100) : 0
                const late = p.due_date != null && p.due_date < todayISO() && p.status !== 'done'
                return (
                  <Link key={p.id} href={`/projects/${p.id}`}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900 truncate">{p.title}</span>
                        {p.status !== 'active' && (
                          <span className="badge border-slate-200 text-slate-500">{PROJECT_STATUS_LABEL[p.status]}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5 flex-wrap">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: propertyColor(p.properties?.name) }} />
                          {p.properties?.name ?? 'Portfolio-wide'}
                        </span>
                        <span>Owner: {ownerName(p.owner_id)}</span>
                        {st.nextDue && <span>Next due {formatDate(st.nextDue)}</span>}
                        {st.overdue > 0 && <span className="text-red-600 font-medium">{st.overdue} overdue</span>}
                      </div>
                    </div>
                    <div className="hidden sm:block w-40 flex-shrink-0">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>{st.done}/{total} done</span><span>{pct}%</span>
                      </div>
                      <div className="h-1 rounded-full border border-slate-200">
                        <div className="h-full rounded-full bg-slate-400" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className={cn('hidden md:block w-28 text-right text-xs flex-shrink-0', late ? 'text-red-600 font-medium' : 'text-slate-500')}>
                      {p.due_date ? `Target ${formatDate(p.due_date)}` : 'No target'}
                    </div>
                    <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
                  </Link>
                )
              })}
            </div>
          )}
        </>
      )}

      {showForm && (
        <ProjectFormModal project={null} properties={properties} people={people} userId={userId}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchAll() }} />
      )}
    </div>
  )
}
