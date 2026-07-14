'use client'

import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── DragOverlay ──────────────────────────────────────────────
// The "Drop PDF here" affordance shown while a file is dragged over
// a drop target. Use `fixed` (default) for page-level drop zones or
// `absolute` for a bounded container (the parent must be `relative`).

export function DragOverlay({
  title = 'Drop PDF here',
  hint = 'AI will extract and fill in the details',
  position = 'fixed',
}: {
  title?: string
  hint?: string
  position?: 'fixed' | 'absolute'
}) {
  return (
    <div className={cn(
      'inset-0 bg-blue-500/10 border-2 border-blue-400 border-dashed z-40 flex items-center justify-center pointer-events-none',
      position === 'fixed' ? 'fixed' : 'absolute rounded-xl',
    )}>
      <div className="bg-white rounded-2xl px-8 py-6 shadow-xl text-center">
        <Sparkles size={32} className="text-blue-500 mx-auto mb-2" />
        <div className="text-lg font-semibold text-blue-700">{title}</div>
        <div className="text-sm text-slate-500 mt-1">{hint}</div>
      </div>
    </div>
  )
}
