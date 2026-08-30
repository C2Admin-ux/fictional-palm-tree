'use client'

// Scratch-note box for the site-visit sheet. One box == one
// site_visit_notes row keyed (property, visit_date, scope); typing
// upserts after a short pause and on blur, clearing the text deletes
// the row. The box owns its value after mount — the parent only seeds
// it — so a background refetch can never clobber mid-typing.
//
// Under print the textarea hides and the note prints as text; an empty
// box prints as a dotted handwriting line (same affordance the old
// walk sheet had).

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

const SAVE_DELAY_MS = 800

export function NoteBox({ propertyId, visitDate, scope, userId, initial, placeholder, className }: {
  propertyId: string
  visitDate: string
  scope: string
  userId: string | null
  initial?: string
  placeholder?: string
  className?: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [value, setValue] = useState(initial ?? '')
  const lastSaved = useRef(initial ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const persist = useRef<(body: string) => Promise<void>>(async () => {})
  persist.current = async (body: string) => {
    if (body === lastSaved.current) return
    if (body.trim() === '') {
      const { error } = await supabase.from('site_visit_notes').delete()
        .eq('property_id', propertyId).eq('visit_date', visitDate).eq('scope', scope)
      if (error) { toast(`Couldn't clear the note — ${error.message}`, { tone: 'error' }); return }
    } else {
      const { error } = await supabase.from('site_visit_notes').upsert({
        property_id: propertyId,
        visit_date: visitDate,
        scope,
        body,
        created_by: userId ?? undefined,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'property_id,visit_date,scope' })
      if (error) { toast(`Couldn't save the note — ${error.message}`, { tone: 'error' }); return }
    }
    lastSaved.current = body
  }

  function schedule(next: string) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void persist.current(next) }, SAVE_DELAY_MS)
  }

  function flush() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    void persist.current(value)
  }

  // Flush a pending save when the box unmounts (navigating away mid-pause).
  const valueRef = useRef(value); valueRef.current = value
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current) }
    void persist.current(valueRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-grow to fit the text — a scratch note should never scroll inside
  // its own box.
  function resize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(() => { resize() }, [])

  return (
    <div className={className}>
      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        placeholder={placeholder ?? 'Notes…'}
        onChange={e => { setValue(e.target.value); schedule(e.target.value); resize() }}
        onBlur={flush}
        className={cn(
          'w-full resize-none overflow-hidden rounded-lg border border-slate-200 bg-amber-50/40',
          'px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400',
          'focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400',
          'print:hidden',
        )}
      />
      {/* Print rendering: the note as text, or a line to write on */}
      {value.trim() !== '' ? (
        <p className="hidden print:block text-sm whitespace-pre-wrap border-l-2 border-slate-300 pl-2">
          {value}
        </p>
      ) : (
        <div className="hidden print:block border-b border-dotted border-slate-400 h-5" aria-hidden="true" />
      )}
    </div>
  )
}
