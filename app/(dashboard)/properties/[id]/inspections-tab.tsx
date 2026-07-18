'use client'

// Property profile → Inspections tab. Read-only rollup of the property's
// inspections: score + grade per walk, open-findings count, a link to the
// stored PDF report, and a compact score trend. Deliberately NO photo
// grids — captures live on the inspection detail page.

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cn, formatDate, formatDateShort, INSPECTION_STATUS_STYLES } from '@/lib/utils'
import { INSPECTION_TYPE_LABELS, INSPECTION_STATUS_LABELS, type InspectionType } from '@/lib/inspections/templates'
import { inspectionScore } from '@/lib/inspections/score'
import { GradeBadge } from '@/lib/inspections/grade-badge'
import { signedFileUrl } from '@/lib/inspections/photos'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { ClipboardCheck, ExternalLink, AlertTriangle, Plus } from 'lucide-react'

export type InspectionTabRow = {
  id: string
  inspection_type: InspectionType
  inspection_date: string
  status: 'draft' | 'submitted' | 'report_sent'
  report_file_path: string | null
  inspection_items: { requires_action: boolean; action_priority: string | null }[]
}

export default function InspectionsTab({ inspections }: { inspections: InspectionTabRow[] }) {
  const supabase = createClient()
  const [error, setError] = useState<string | null>(null)

  const rows = inspections.map(i => ({
    ...i,
    score: inspectionScore(i.inspection_items),
    open: i.inspection_items.filter(it => it.requires_action).length,
  }))

  // Trend uses completed walks only — a draft mid-walk has partial
  // findings and would inflate the line.
  const trend = rows
    .filter(r => r.status !== 'draft')
    .sort((a, b) => a.inspection_date.localeCompare(b.inspection_date))
    .map(r => ({ date: formatDateShort(r.inspection_date), score: r.score }))

  async function viewReport(path: string) {
    setError(null)
    const { url, error: signError } = await signedFileUrl(supabase, path)
    if (url) window.open(url, '_blank')
    else setError(`Could not open the report${signError ? ` — ${signError}` : ''}`)
  }

  if (inspections.length === 0) {
    return (
      <div className="max-w-3xl">
        <p className="text-sm text-slate-400 italic">
          No inspections yet for this property.{' '}
          <Link href="/inspections" className="text-blue-600 hover:underline not-italic">Start one →</Link>
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-slate-700">{inspections.length} inspection{inspections.length === 1 ? '' : 's'}</h2>
        <Link href="/inspections" className="btn-secondary text-xs py-1.5"><Plus size={12} />New inspection</Link>
      </div>

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0" />{error}
        </p>
      )}

      {/* Score trend — needs at least two completed walks to be a line */}
      {trend.length >= 2 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Score trend</h3>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Line type="monotone" dataKey="score" stroke="#2563eb" strokeWidth={2} dot={{ r: 2.5 }} name="Score" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-50 border-b border-slate-200/70">
            <tr>
              {['Date', 'Type', 'Status', 'Score', 'Follow-ups', 'Report'].map(h => (
                <th key={h} className="text-left px-4 py-2 text-xs font-medium text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70">
            {rows.map(insp => {
              return (
                <tr key={insp.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/inspections/${insp.id}`} className="font-medium text-slate-700 hover:text-blue-600 flex items-center gap-1.5">
                      <ClipboardCheck size={13} className="text-slate-300" />
                      {formatDate(insp.inspection_date)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                      {INSPECTION_TYPE_LABELS[insp.inspection_type] ?? insp.inspection_type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn('badge', INSPECTION_STATUS_STYLES[insp.status])}>
                      {INSPECTION_STATUS_LABELS[insp.status] ?? insp.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {/* A draft mid-walk has partial findings — no score yet */}
                    {insp.status !== 'draft'
                      ? <GradeBadge score={insp.score} />
                      : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {insp.open > 0 ? (
                      <span className="badge text-amber-700 bg-amber-50 border-amber-200">
                        <AlertTriangle size={10} className="mr-1" />{insp.open}
                      </span>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {insp.report_file_path ? (
                      <button onClick={() => viewReport(insp.report_file_path as string)}
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                        <ExternalLink size={11} />View report
                      </button>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
