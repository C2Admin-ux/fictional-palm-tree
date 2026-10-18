'use client'

// "Carried over" — open tasks that came out of EARLIER calls in the same
// series (created from a call item, or matched to one) and are still not
// done. Shown on the next call's page as its own section so Nick can
// tick the ones that need a reminder in the recap email. Read-only here:
// tasks are closed out in Tasks, not from this list.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { StatusBadge } from '@/components/ui/badge'
import { RotateCcw } from 'lucide-react'

export type CarriedTask = {
  id: string; title: string; status: string; due_date: string | null; follow_up_on: string | null
  since: string   // call_date of the call it came from
  owner: string | null
}

export function CarriedOver({ seriesId, beforeDate, selected, onToggle, onLoaded }: {
  seriesId: string | null
  beforeDate: string
  selected: Set<string>
  onToggle: (id: string) => void
  onLoaded: (rows: CarriedTask[]) => void
}) {
  const supabase = createClient()
  const [rows, setRows] = useState<CarriedTask[] | null>(null)

  useEffect(() => {
    if (!seriesId) { setRows([]); onLoaded([]); return }
    (async () => {
      const { data: earlier } = await supabase.from('calls')
        .select('id, call_date').eq('series_id', seriesId).lt('call_date', beforeDate)
      const callIds = (earlier ?? []).map(c => c.id)
      if (!callIds.length) { setRows([]); onLoaded([]); return }
      const dateOf = new Map((earlier ?? []).map(c => [c.id, c.call_date]))
      const { data: items } = await supabase.from('call_items')
        .select('call_id, owner, task_id, matched_task_id').in('call_id', callIds)
      const taskToItem = new Map<string, { since: string; owner: string | null }>()
      for (const i of items ?? []) {
        for (const tid of [i.task_id, i.matched_task_id]) {
          if (!tid) continue
          const since = dateOf.get(i.call_id) ?? ''
          const prev = taskToItem.get(tid)
          if (!prev || since > prev.since) taskToItem.set(tid, { since, owner: i.owner })
        }
      }
      const ids = Array.from(taskToItem.keys())
      if (!ids.length) { setRows([]); onLoaded([]); return }
      const { data: tasks } = await supabase.from('tasks')
        .select('id, title, status, due_date, follow_up_on').in('id', ids).neq('status', 'done')
      const out: CarriedTask[] = (tasks ?? []).map(t => ({
        ...t, since: taskToItem.get(t.id)!.since, owner: taskToItem.get(t.id)!.owner,
      })).sort((a, b) => a.since.localeCompare(b.since))
      setRows(out); onLoaded(out)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId, beforeDate])

  if (!rows || rows.length === 0) return null

  return (
    <div className="card overflow-visible">
      <div className="px-4 py-2.5 border-b border-slate-200/70 flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
        <RotateCcw size={12} />Carried over from earlier calls ({rows.length})
        <span className="ml-auto font-normal normal-case tracking-normal text-slate-400">tick to include as a reminder in the email</span>
      </div>
      <div className="divide-y divide-slate-200/70">
        {rows.map(t => (
          <label key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-slate-50">
            <input type="checkbox" checked={selected.has(t.id)} onChange={() => onToggle(t.id)} className="rounded border-slate-300" />
            <span className="flex-1 text-slate-700 truncate">{t.title}</span>
            <span className="text-xs text-slate-400 whitespace-nowrap">since {formatDate(t.since)}</span>
            <StatusBadge value={t.status} className="text-xs" />
            <Link href="/tasks" className="text-xs text-blue-600 hover:underline" onClick={e => e.stopPropagation()}>open</Link>
          </label>
        ))}
      </div>
    </div>
  )
}
