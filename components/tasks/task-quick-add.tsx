'use client'

// Shared natural-language quick-add bar. Used on the tasks page agenda
// (property matching on) and the property profile Tasks tab (property
// preset, matching off). As the user types, parsed tokens preview as
// chips under the input so what Enter will do is predictable.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Task } from '@/lib/supabase/types'
import { parseQuickAdd, type QuickAddProperty } from '@/lib/tasks/quick-add'
import { toast } from '@/components/ui/toast'
import { cn, formatDateShort, propertyColor, PRIORITY_DOT } from '@/lib/utils'
import { Plus, Inbox as InboxIcon, CalendarDays, Sparkles } from 'lucide-react'

export function TaskQuickAdd({
  userId, properties = [], presetPropertyId = null, onCreated, placeholder,
}: {
  userId: string | null
  // Property names for NL matching — pass [] to disable (preset context)
  properties?: QuickAddProperty[]
  presetPropertyId?: string | null
  onCreated: (task: Task) => void
  placeholder?: string
}) {
  const supabase = createClient()
  const [value, setValue] = useState('')
  const [adding, setAdding] = useState(false)

  // Cheap enough to run per keystroke — no memo needed.
  const parsed = parseQuickAdd(value, presetPropertyId ? [] : properties)
  const matchedProperty = parsed.property_id
    ? properties.find(p => p.id === parsed.property_id)
    : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!parsed.title || !userId || adding) return
    const snapshot = value
    setValue('') // optimistic: clear the bar immediately
    setAdding(true)
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title:       parsed.title,
        // An inbox item with a date is contradictory — dated captures
        // land straight in the agenda as next actions.
        status:      parsed.due_date ? 'next_action' : 'inbox',
        priority:    parsed.priority ?? 'medium',
        due_date:    parsed.due_date ?? null,
        property_id: presetPropertyId ?? parsed.property_id ?? null,
        created_by:  userId,
        assigned_to: userId,
      })
      .select('*')
      .single()
    setAdding(false)
    if (error || !data) {
      setValue(snapshot)
      toast('Could not add task', { tone: 'error' })
      return
    }
    onCreated(data as Task)
  }

  const hasChips = value.trim().length > 0 &&
    (parsed.due_date || parsed.priority || matchedProperty)

  return (
    <form onSubmit={submit} className="px-6 py-3 border-b border-slate-200 bg-white">
      <div className="flex items-center gap-2">
        <InboxIcon size={15} className="text-slate-400 flex-shrink-0" />
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          disabled={!userId}
          className="input flex-1"
          placeholder={userId
            ? (placeholder ?? 'Quick add — try "call plumber fox hill tomorrow !urgent"')
            : 'Sign in to capture tasks'}
        />
        <button
          type="submit"
          disabled={adding || !parsed.title || !userId}
          className="btn-primary text-xs py-1.5">
          <Plus size={13} />Add
        </button>
      </div>

      {/* Parse preview — what Enter will actually create */}
      {hasChips && (
        <div className="flex items-center gap-1.5 flex-wrap mt-2 ml-6">
          <Sparkles size={11} className="text-slate-300 flex-shrink-0" />
          {parsed.due_date && (
            <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
              <CalendarDays size={10} />{formatDateShort(parsed.due_date)}
            </span>
          )}
          {parsed.priority && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: PRIORITY_DOT[parsed.priority] }} />
              {parsed.priority}
            </span>
          )}
          {matchedProperty && (
            <span
              className={cn('inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2 py-0.5')}
              style={{
                background: `${propertyColor(matchedProperty.name)}18`,
                color: propertyColor(matchedProperty.name),
              }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: propertyColor(matchedProperty.name) }} />
              {matchedProperty.name}
            </span>
          )}
        </div>
      )}
    </form>
  )
}
