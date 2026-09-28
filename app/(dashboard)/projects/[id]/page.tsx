'use client'

// Project detail: header (owner, property, target, status) and three
// views of the same tasks — List (the shared scoped task list), Board
// (drag between status columns), Timeline (light Gantt). The chosen
// view rides in ?view= so a link lands where it was shared from.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Project, Property, UserProfile } from '@/lib/supabase/types'
import { cn, formatDate, propertyColor, todayISO } from '@/lib/utils'
import ScopedTaskList from '@/components/tasks/scoped-task-list'
import { ProjectBoard, ProjectTimeline } from '@/components/projects/project-views'
import { ProjectFormModal, PROJECT_STATUS_LABEL } from '@/components/projects/project-form-modal'
import { toast } from '@/components/ui/toast'
import { ArrowLeft, Pencil, List, Kanban, GanttChart, Trash2 } from 'lucide-react'

type View = 'list' | 'board' | 'timeline'
const VIEWS: { key: View; label: string; icon: typeof List }[] = [
  { key: 'list',     label: 'List',     icon: List },
  { key: 'board',    label: 'Board',    icon: Kanban },
  { key: 'timeline', label: 'Timeline', icon: GanttChart },
]

export default function ProjectPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading…</div>}>
      <ProjectInner />
    </Suspense>
  )
}

function ProjectInner() {
  const supabase = useMemo(() => createClient(), [])
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [project, setProject] = useState<(Project & { properties: { name: string } | null }) | null>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [people, setPeople] = useState<UserProfile[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [editing, setEditing] = useState(false)

  const v = searchParams.get('view')
  const view: View = v === 'board' || v === 'timeline' ? v : 'list'
  const setView = (next: View) => router.replace(`/projects/${params.id}${next === 'list' ? '' : `?view=${next}`}`)

  const load = useCallback(async () => {
    const [pr, props, ppl, auth] = await Promise.all([
      supabase.from('projects').select('*, properties(name)').eq('id', params.id).maybeSingle(),
      supabase.from('properties').select('*').eq('status', 'active').order('name'),
      supabase.from('user_profiles').select('*').order('full_name'),
      supabase.auth.getUser(),
    ])
    if (!pr.data) { setMissing(true); return }
    setProject(pr.data as unknown as Project & { properties: { name: string } | null })
    setProperties((props.data ?? []) as Property[])
    setPeople((ppl.data ?? []) as UserProfile[])
    setUserId(auth.data.user?.id ?? null)
  }, [supabase, params.id])

  useEffect(() => { load() }, [load])

  async function remove() {
    if (!project) return
    // Tasks survive (project_id → null via the FK); only the container goes.
    const { error } = await supabase.from('projects').delete().eq('id', project.id)
    if (error) { toast('Could not delete project', { tone: 'error' }); return }
    toast('Project deleted — its tasks are still in Tasks')
    router.push('/projects')
  }

  if (missing) {
    return (
      <div className="p-6 text-sm text-slate-500">
        That project no longer exists. <Link href="/projects" className="text-blue-600 hover:underline">Back to projects</Link>
      </div>
    )
  }
  if (!project) return <div className="p-6 text-sm text-slate-400">Loading…</div>

  const owner = people.find(p => p.id === project.owner_id)?.full_name ?? 'Unassigned'
  const late = project.due_date != null && project.due_date < todayISO() && project.status !== 'done'

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <Link href="/projects" className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={12} />Projects
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="page-title">{project.title}</h1>
              <span className="badge border-slate-200 text-slate-600">{PROJECT_STATUS_LABEL[project.status]}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500 mt-1 flex-wrap">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: propertyColor(project.properties?.name) }} />
                {project.properties?.name ?? 'Portfolio-wide'}
              </span>
              <span>Owner: {owner}</span>
              {project.start_date && <span>Start {formatDate(project.start_date)}</span>}
              <span className={cn(late && 'text-red-600 font-medium')}>
                {project.due_date ? `Target ${formatDate(project.due_date)}` : 'No target date'}
              </span>
            </div>
            {project.description && (
              <p className="text-sm text-slate-600 mt-2 max-w-3xl whitespace-pre-line">{project.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(true)} className="btn-secondary"><Pencil size={13} />Edit</button>
            <button onClick={() => { if (window.confirm('Delete this project? Its tasks stay in Tasks.')) void remove() }}
              className="btn-secondary" aria-label="Delete project" title="Delete project">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* View switcher */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {VIEWS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setView(key)}
            className={cn('flex items-center gap-1.5 px-3 py-2 text-sm -mb-px border-b-2 transition-colors',
              view === key ? 'border-slate-900 text-slate-900 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {view === 'list' && <ScopedTaskList projectId={project.id} projectPropertyId={project.property_id} />}
      {view === 'board' && <ProjectBoard project={project} />}
      {view === 'timeline' && <ProjectTimeline project={project} />}

      {editing && (
        <ProjectFormModal project={project} properties={properties} people={people} userId={userId}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load() }} />
      )}
    </div>
  )
}
