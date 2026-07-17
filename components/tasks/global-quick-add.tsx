'use client'

// Globally reachable task capture, mounted once in the dashboard shell.
// Opens from the mobile top bar's "+" and the desktop `n` shortcut, so
// a thought can be captured from ANY page without walking to /tasks.
//
// Bottom-sheet on mobile (thumb-friendly), centered panel on md+. The
// capture itself is the existing TaskQuickAdd (full NL parsing +
// preview chips) riding the shared creation path. Context-aware: on a
// property page (and on an inspection's page, via its property) the
// property is preset — parser matching off, chip shown; everywhere
// else the parser matches property names as usual.

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { TaskQuickAdd } from '@/components/tasks/task-quick-add'
import { toast } from '@/components/ui/toast'
import { propertyColor } from '@/lib/utils'
import { useOverlayOpen } from '@/lib/ui/overlay'
import { X, Inbox as InboxIcon } from 'lucide-react'

type QuickAddProperty = { id: string; name: string }

// /properties/[id] → id; anything else (including /properties alone) → null
function propertyIdFromPath(pathname: string): string | null {
  const m = /^\/properties\/([^/]+)/.exec(pathname)
  return m ? m[1] : null
}

function inspectionIdFromPath(pathname: string): string | null {
  const m = /^\/inspections\/([^/]+)/.exec(pathname)
  return m && m[1] !== 'new' ? m[1] : null
}

export function GlobalQuickAdd({ open, onClose, userId, properties }: {
  open: boolean
  onClose: () => void
  userId: string | null
  properties: QuickAddProperty[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  // While open, global shortcuts (the layout's `n`) must stay inert.
  useOverlayOpen(open)

  // Property preset resolved from the current route. Property pages
  // resolve synchronously; inspection pages resolve via one cheap
  // lookup of the inspection's property_id when the sheet opens.
  const routePropertyId = propertyIdFromPath(pathname)
  const inspectionId = inspectionIdFromPath(pathname)
  const [inspectionPropertyId, setInspectionPropertyId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !inspectionId) { setInspectionPropertyId(null); return }
    let cancelled = false
    supabase.from('inspections').select('property_id').eq('id', inspectionId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setInspectionPropertyId(data?.property_id ?? null) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inspectionId])

  // Only preset a property the sidebar list actually knows — a stale
  // route id degrades gracefully to portfolio-wide capture.
  const presetId = routePropertyId ?? inspectionPropertyId
  const presetProperty = presetId ? properties.find(p => p.id === presetId) ?? null : null

  // Escape closes (the input's own Escape blurs first — second press
  // lands here once nothing is focused, matching the tasks page feel).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) { el.blur(); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center justify-center"
      onClick={onClose}>
      <div
        className="bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden pb-[env(safe-area-inset-bottom)]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-100">
          <InboxIcon size={14} className="text-slate-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-slate-900 flex-1">Quick add task</span>
          {presetProperty && (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2 py-0.5"
              style={{
                background: `${propertyColor(presetProperty.name)}18`,
                color: propertyColor(presetProperty.name),
              }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: propertyColor(presetProperty.name) }} />
              {presetProperty.name}
            </span>
          )}
          <button onClick={onClose} aria-label="Close" className="p-1 -mr-1.5 text-slate-300 hover:text-slate-500">
            <X size={16} />
          </button>
        </div>
        <TaskQuickAdd
          userId={userId}
          autoFocus
          properties={presetProperty ? [] : properties}
          presetPropertyId={presetProperty?.id ?? null}
          placeholder={presetProperty
            ? `Add a task for ${presetProperty.name}…`
            : 'Try "call plumber fox hill tomorrow !urgent"'}
          onCreated={() => {
            onClose()
            toast('Added to Tasks', {
              action: { label: 'View', onClick: () => router.push('/tasks') },
            })
          }}
        />
      </div>
    </div>
  )
}
