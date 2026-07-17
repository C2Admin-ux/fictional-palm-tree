'use client'

// Cmd+K / Ctrl+K command palette (desktop) — one keystroke to any nav
// destination, property, open task, or CapEx project, plus capture:
// the first row runs the query through the quick-add NL parser and
// creates the task on the spot. Mounted once in the dashboard shell;
// inert on coarse-pointer devices (the mobile "+" covers capture, the
// bottom tabs cover nav).
//
// Search is deliberately dependency-free: case-insensitive prefix /
// word-prefix / substring scoring over a small in-memory list. Open
// tasks and CapEx projects are fetched once on first open and cached
// for the session.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { parseQuickAdd } from '@/lib/tasks/quick-add'
import { quickAddInsertPayload, insertTask } from '@/lib/tasks/create'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import {
  Search, CornerDownLeft, Plus, LayoutDashboard, CheckSquare, Wrench,
  TrendingUp, FileSignature, Shield, FileBarChart, ClipboardCheck,
  Settings, Building2,
} from 'lucide-react'

type PaletteProperty = { id: string; name: string }

type Kind = 'page' | 'property' | 'task' | 'capex'

type Item = {
  key: string
  kind: Kind
  label: string
  href: string
  icon?: React.ComponentType<{ size?: number | string; className?: string }>
}

const NAV_ITEMS: Item[] = [
  { key: 'nav:/dashboard',          kind: 'page', label: 'Dashboard',      href: '/dashboard',          icon: LayoutDashboard },
  { key: 'nav:/tasks',              kind: 'page', label: 'Tasks',          href: '/tasks',              icon: CheckSquare },
  { key: 'nav:/capex',              kind: 'page', label: 'CapEx',          href: '/capex',              icon: Wrench },
  { key: 'nav:/insurance/policies', kind: 'page', label: 'Insurance',      href: '/insurance/policies', icon: Shield },
  { key: 'nav:/documents',          kind: 'page', label: 'Contracts',      href: '/documents',          icon: FileSignature },
  { key: 'nav:/inspections',        kind: 'page', label: 'Inspections',    href: '/inspections',        icon: ClipboardCheck },
  { key: 'nav:/performance',        kind: 'page', label: 'PM Performance', href: '/performance',        icon: TrendingUp },
  { key: 'nav:/reports',            kind: 'page', label: 'Reports',        href: '/reports',            icon: FileBarChart },
  { key: 'nav:/settings',           kind: 'page', label: 'Settings',       href: '/settings',           icon: Settings },
]

const KIND_LABELS: Record<Kind, string> = {
  page: 'Page', property: 'Property', task: 'Task', capex: 'CapEx',
}

// Prefix beats word-prefix beats substring; 0 filters the item out.
function score(label: string, query: string): number {
  const l = label.toLowerCase()
  const q = query.toLowerCase()
  if (l.startsWith(q)) return 3
  if (l.split(/\s+/).some(w => w.startsWith(q))) return 2
  if (l.includes(q)) return 1
  return 0
}

const MAX_RESULTS = 12

export function CommandPalette({ properties, userId }: {
  properties: PaletteProperty[]
  userId: string | null
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [creating, setCreating] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Session cache for the lazy lists — fetched once, on first open.
  const [fetched, setFetched] = useState<{ tasks: Item[]; capex: Item[] } | null>(null)
  const fetchStarted = useRef(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey) return
      // Mobile: the "+" button and bottom tabs cover these jobs.
      if (window.matchMedia('(pointer: coarse)').matches) return
      e.preventDefault()
      setOpen(prev => {
        if (!prev) { setQuery(''); setSelected(0) }
        return !prev
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Lazy fetch: titles + ids only, cached for the session.
  useEffect(() => {
    if (!open || fetchStarted.current) return
    fetchStarted.current = true
    ;(async () => {
      const [{ data: taskRows }, { data: capexRows }] = await Promise.all([
        supabase.from('tasks').select('id, title').neq('status', 'done')
          .order('created_at', { ascending: false }).limit(300),
        supabase.from('capex_projects').select('id, title')
          .in('status', ['planning', 'approved', 'in_progress'])
          .order('title'),
      ])
      setFetched({
        tasks: (taskRows ?? []).map(t => ({
          key: `task:${t.id}`, kind: 'task' as const, label: t.title, href: '/tasks',
        })),
        capex: (capexRows ?? []).map(c => ({
          key: `capex:${c.id}`, kind: 'capex' as const, label: c.title, href: `/capex/${c.id}`,
        })),
      })
    })()
  }, [open, supabase])

  const trimmed = query.trim()

  const results = useMemo(() => {
    const pool: Item[] = [
      ...NAV_ITEMS,
      ...properties.map(p => ({
        key: `prop:${p.id}`, kind: 'property' as const, label: p.name,
        href: `/properties/${p.id}`, icon: Building2,
      })),
      ...(fetched?.tasks ?? []),
      ...(fetched?.capex ?? []),
    ]
    if (!trimmed) return pool.slice(0, MAX_RESULTS) // empty query: nav + properties first
    return pool
      .map(item => ({ item, s: score(item.label, trimmed) }))
      .filter(r => r.s > 0)
      .sort((a, b) => b.s - a.s || a.item.label.localeCompare(b.item.label))
      .slice(0, MAX_RESULTS)
      .map(r => r.item)
  }, [trimmed, properties, fetched])

  // Row 0 is "Create task" whenever there's a query; navigation rows
  // follow. rowCount covers both.
  const hasCreateRow = trimmed.length > 0
  const rowCount = results.length + (hasCreateRow ? 1 : 0)

  useEffect(() => { setSelected(0) }, [query])

  const close = useCallback(() => setOpen(false), [])

  const createTask = useCallback(async () => {
    if (!userId || creating) return
    const parsed = parseQuickAdd(trimmed, properties)
    if (!parsed.title) return
    setCreating(true)
    const created = await insertTask(supabase, quickAddInsertPayload(parsed, userId))
    setCreating(false)
    if (!created) {
      toast('Could not add task', { tone: 'error' })
      return
    }
    close()
    toast('Added to Tasks', {
      action: { label: 'View', onClick: () => router.push('/tasks') },
    })
  }, [userId, creating, trimmed, properties, supabase, close, router])

  const activate = useCallback((index: number) => {
    if (hasCreateRow && index === 0) { void createTask(); return }
    const item = results[hasCreateRow ? index - 1 : index]
    if (!item) return
    close()
    router.push(item.href)
  }, [hasCreateRow, createTask, results, close, router])

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (rowCount === 0) return
      setSelected(prev => {
        const next = e.key === 'ArrowDown'
          ? Math.min(prev + 1, rowCount - 1)
          : Math.max(prev - 1, 0)
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' })
        return next
      })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (rowCount > 0) activate(selected)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center px-4 pt-[12vh]"
      onClick={close}>
      <div
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100">
          <Search size={15} className="text-slate-400 flex-shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Go to page, property, task… or type a task to create"
            aria-label="Command palette"
            className="flex-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-[10px] text-slate-400">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1.5">
          {hasCreateRow && (
            <button
              onClick={() => activate(0)}
              onMouseMove={() => setSelected(0)}
              className={cn(
                'w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors',
                selected === 0 ? 'bg-blue-50 text-blue-900' : 'text-slate-700'
              )}>
              <Plus size={14} className="text-blue-500 flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate">
                {creating ? 'Creating…' : <>Create task: <span className="font-medium">“{trimmed}”</span></>}
              </span>
              <span className="text-xs text-slate-400 flex-shrink-0">Quick add</span>
            </button>
          )}
          {results.map((item, i) => {
            const index = i + (hasCreateRow ? 1 : 0)
            const Icon = item.icon
            return (
              <button
                key={item.key}
                onClick={() => activate(index)}
                onMouseMove={() => setSelected(index)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors',
                  selected === index ? 'bg-blue-50 text-blue-900' : 'text-slate-700'
                )}>
                {Icon
                  ? <Icon size={14} className="text-slate-400 flex-shrink-0" />
                  : <span className="w-3.5 flex-shrink-0" />}
                <span className="flex-1 min-w-0 truncate">{item.label}</span>
                <span className="text-xs text-slate-400 flex-shrink-0">{KIND_LABELS[item.kind]}</span>
              </button>
            )
          })}
          {rowCount === 0 && (
            <div className="px-4 py-6 text-sm text-slate-400 text-center">No matches</div>
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-100 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-px bg-slate-100 border border-slate-200 rounded font-mono text-[10px] text-slate-500">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-px bg-slate-100 border border-slate-200 rounded font-mono text-[10px] text-slate-500"><CornerDownLeft size={9} /></kbd>
            select
          </span>
          <span className="ml-auto">⌘K / Ctrl+K</span>
        </div>
      </div>
    </div>
  )
}
