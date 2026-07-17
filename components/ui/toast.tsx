'use client'

// Lightweight app-wide toast stack. Module-level store so any client
// component can fire a toast without context plumbing:
//
//   toast('Task deleted', { action: { label: 'Undo', onClick: restore } })
//
// <Toaster /> (mounted once in the dashboard layout) renders the stack
// bottom-center and auto-dismisses after ~6s.

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { X, AlertTriangle } from 'lucide-react'

export type ToastItem = {
  id: number
  message: string
  tone: 'default' | 'error'
  action?: { label: string; onClick: () => void }
}

type Listener = (toasts: ToastItem[]) => void

let items: ToastItem[] = []
let listeners: Listener[] = []
let nextId = 1

function emit() {
  for (const l of listeners) l([...items])
}

export function dismissToast(id: number) {
  if (!items.some(t => t.id === id)) return
  items = items.filter(t => t.id !== id)
  emit()
}

export function toast(
  message: string,
  opts?: {
    tone?: 'default' | 'error'
    action?: { label: string; onClick: () => void }
    duration?: number
  }
): number {
  const id = nextId++
  items = [...items, { id, message, tone: opts?.tone ?? 'default', action: opts?.action }]
  // Keep the stack shallow — drop the oldest beyond 4
  if (items.length > 4) items = items.slice(items.length - 4)
  emit()
  setTimeout(() => dismissToast(id), opts?.duration ?? 6000)
  return id
}

export function Toaster() {
  const [stack, setStack] = useState<ToastItem[]>([])

  useEffect(() => {
    listeners.push(setStack)
    setStack([...items])
    return () => { listeners = listeners.filter(l => l !== setStack) }
  }, [])

  if (stack.length === 0) return null

  return (
    // Below md the stack sits above the fixed bottom tab bar (3.5rem +
    // safe area); on md+ it returns to the plain bottom-4 offset.
    <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 w-full max-w-sm px-4 pointer-events-none">
      {stack.map(t => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-center gap-1 w-full bg-white border rounded-xl shadow-lg pl-4 pr-1.5 py-1.5',
            t.tone === 'error' ? 'border-red-200' : 'border-slate-200'
          )}>
          {t.tone === 'error' && <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mr-1" />}
          <span className={cn('flex-1 text-sm py-1', t.tone === 'error' ? 'text-red-700' : 'text-slate-700')}>
            {t.message}
          </span>
          {t.action && (
            <button
              onClick={() => { dismissToast(t.id); t.action?.onClick() }}
              className="btn-ghost text-xs font-semibold text-blue-600 hover:text-blue-700 flex-shrink-0 py-1 px-2">
              {t.action.label}
            </button>
          )}
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className="p-1.5 text-slate-300 hover:text-slate-500 flex-shrink-0 transition-colors">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
