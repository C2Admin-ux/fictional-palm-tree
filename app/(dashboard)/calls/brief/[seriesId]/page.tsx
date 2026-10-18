'use client'

// Pre-call brief for one recurring call — the document Nick pastes into
// Claude with the week's leasing report to get the full agenda. The
// markdown is the product; the page renders it, and offers Copy brief,
// Copy as Claude prompt, and Print. Read-only.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { loadBrief, briefMarkdown, briefPrompt, type BriefData } from '@/lib/calls/brief'
import { ErrorState } from '@/components/ui/error-state'
import { toast } from '@/components/ui/toast'
import { ArrowLeft, Copy, Printer, Sparkles, RotateCcw } from 'lucide-react'

export default function BriefPage() {
  const { seriesId } = useParams<{ seriesId: string }>()
  const supabase = createClient()
  const [data, setData] = useState<BriefData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setData(null); setError(null)
    loadBrief(supabase, seriesId)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Could not load') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId, tick])

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); toast(`${label} copied`) }
    catch { toast('Could not copy — clipboard unavailable', { tone: 'error' }) }
  }

  if (error) {
    return <div className="p-6"><ErrorState className="card py-10" message={`Could not build the brief — ${error}`} onRetry={() => setTick(t => t + 1)} /></div>
  }
  if (!data) return <div className="p-6 text-sm text-slate-400">Building brief…</div>

  const md = briefMarkdown(data)

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4 print:p-0">
      <div className="print:hidden">
        <Link href="/calls" className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-1">
          <ArrowLeft size={12} />Calls
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="page-title">Pre-call brief — {data.series.display_name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Paste into Claude with this week&apos;s leasing report to get the full agenda.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setTick(t => t + 1)} className="btn-ghost" title="Rebuild from current data"><RotateCcw size={14} /></button>
            <button onClick={() => window.print()} className="btn-secondary"><Printer size={14} />Print</button>
            <button onClick={() => copy(md, 'Brief')} className="btn-secondary"><Copy size={14} />Copy brief</button>
            <button onClick={() => copy(briefPrompt(data), 'Prompt')} className="btn-primary" title="The brief wrapped in instructions for Claude">
              <Sparkles size={14} />Copy as Claude prompt
            </button>
          </div>
        </div>
      </div>

      <pre className="card p-5 text-[13px] leading-relaxed text-slate-800 whitespace-pre-wrap font-sans print:border-0 print:p-0">{md}</pre>
    </div>
  )
}
