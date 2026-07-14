'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Spinner ──────────────────────────────────────────────────
// A spinning loader icon. Defaults match the inline loaders used
// across the app (blue, animate-spin).

export function Spinner({
  size = 16, className = '',
}: {
  size?: number
  className?: string
}) {
  return <Loader2 size={size} className={cn('animate-spin text-blue-500', className)} />
}
