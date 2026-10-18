'use client'

// "Pre-call brief" button on the calls list: pick a recurring call, land
// on its brief page.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { FileText } from 'lucide-react'

export function BriefPicker() {
  const supabase = createClient()
  const router = useRouter()
  const [series, setSeries] = useState<{ id: string; display_name: string }[]>([])
  useEffect(() => {
    supabase.from('call_series').select('id, display_name').eq('active', true).order('display_name')
      .then(({ data }) => setSeries(data ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (series.length === 0) return null
  return (
    <label className="btn-secondary cursor-pointer relative">
      <FileText size={14} />Pre-call brief
      <select aria-label="Pre-call brief for" value="" onChange={e => { if (e.target.value) router.push(`/calls/brief/${e.target.value}`) }}
        className="absolute inset-0 opacity-0 cursor-pointer">
        <option value="">Choose a call…</option>
        {series.map(s => <option key={s.id} value={s.id}>{s.display_name}</option>)}
      </select>
    </label>
  )
}
