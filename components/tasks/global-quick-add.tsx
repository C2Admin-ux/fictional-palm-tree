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
import { notifyTaskCreated } from '@/lib/tasks/create'
import { Overlay } from '@/components/ui/overlay'
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
  // lookup of the inspection's property_id when the sheet opens. The
  // sheet still opens instantly — while the lookup is pending, submit
  // is held (a fast Enter must not create the task with no property);
  // on lookup failure the sheet falls back to preset-off capture with
  // parser property matching enabled.
  const routePropertyId = propertyIdFromPath(pathname)
  const inspectionId = inspectionIdFromPath(pathname)
  type Lookup =
    | { status: 'idle' | 'loading' | 'error'; propertyId: null }
    | { status: 'done'; propertyId: string | null }
  const [inspectionLookup, setInspectionLookup] = useState<Lookup>({ status: 'idle', propertyId: null })

  useEffect(() => {
    if (!open || !inspectionId) { setInspectionLookup({ status: 'idle', propertyId: null }); return }
    let cancelled = false
    setInspectionLookup({ status: 'loading', propertyId: null })
    supabase.from('inspections').select('property_id').eq('id', inspectionId).maybeSingle()
      .then(
        ({ data, error }) => {
          if (cancelled) return
          if (error) setInspectionLookup({ status: 'error', propertyId: null })
          else setInspectionLookup({ status: 'done', propertyId: data?.property_id ?? null })
        },
        () => { if (!cancelled) setInspectionLookup({ status: 'error', propertyId: null }) },
      )
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inspectionId])

  const presetPending = inspectionId != null && !routePropertyId && inspectionLookup.status === 'loading'

  // Only preset a property the sidebar list actually knows — a stale
  // route id (or a failed lookup) degrades gracefully to
  // portfolio-wide capture.
  const presetId = routePropertyId ?? inspectionLookup.propertyId
  const presetProperty = presetId ? properties.find(p => p.id === presetId) ?? null : null

  if (!open) return null

  // Shared chrome (backdrop, panel click-swallow, Escape-with-blur) —
  // the sheet variant matches the tasks page feel: Escape in the input
  // blurs first, second press closes.
  return (
    <Overlay
      onClose={onClose}
      align="sheet"
      panelClassName="bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-100">
          <InboxIcon size={14} className="text-slate-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-slate-900 flex-1">Quick add task</span>
          {presetPending && (
            <span className="w-20 h-5 rounded-full bg-slate-100 animate-pulse" aria-label="Resolving property context" />
          )}
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
          disabled={presetPending}
          properties={presetProperty || presetPending ? [] : properties}
          presetPropertyId={presetProperty?.id ?? null}
          placeholder={presetProperty
            ? `Add a task for ${presetProperty.name}…`
            : 'Try "call plumber fox hill tomorrow !urgent"'}
          onCreated={() => {
            onClose()
            notifyTaskCreated(router)
          }}
        />
    </Overlay>
  )
}
