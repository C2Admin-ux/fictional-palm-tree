'use client'

import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { schemaGapMessage } from '@/lib/supabase/schema-errors'

// ── SchemaGapNotice ──────────────────────────────────────────
// Amber, not red: a missing column is a pending migration, not lost data or
// a broken page. Says so plainly, because the first question in the field is
// always "did I just lose my work?" — the answer is no.
//
// Amber also carries the right severity when the page degraded around the
// gap (see the inspections list): the view is usable, just thinner.

export function SchemaGapNotice({
  error, detail, className = '',
}: {
  error: { code?: string | null; message?: string | null } | null | undefined
  /** Extra line naming what this specific page lost, e.g. "Grades are hidden". */
  detail?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border border-amber-200 bg-amber-50 px-4 py-3', className)}>
      <p className="text-sm text-amber-800 flex items-start gap-2">
        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
        <span>{schemaGapMessage(error)}</span>
      </p>
      {detail && <p className="text-xs text-amber-700 mt-1.5 ml-6">{detail}</p>}
    </div>
  )
}
