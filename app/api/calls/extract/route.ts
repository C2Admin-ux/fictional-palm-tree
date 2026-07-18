import { NextRequest, NextResponse } from 'next/server'
import { anthropicConfigured, anthropicNotConfigured } from '@/lib/anthropic'
import { getSessionUser, unauthorized } from '@/lib/api-auth'
import { createClient } from '@/lib/supabase/server'
import { extractCall } from '@/lib/calls/extract'
import type { Call } from '@/lib/supabase/types'

// Extracts summary + structured items from a PM check-in call transcript.
// Thin session-authed wrapper around lib/calls/extract (shared with the
// inbound-email webhook) — writes land through the user's RLS session.

export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    if (!anthropicConfigured()) return anthropicNotConfigured()
    if (!(await getSessionUser())) return unauthorized()

    const { call_id } = await req.json()
    if (!call_id || typeof call_id !== 'string') {
      return NextResponse.json({ error: 'No call_id provided' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: call, error } = await supabase.from('calls')
      .select('*').eq('id', call_id).single()
    if (error || !call) {
      return NextResponse.json({ error: 'Call not found' }, { status: 404 })
    }

    const result = await extractCall(supabase, call as Call)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.detail ? { detail: result.detail } : {}) },
        { status: result.status }
      )
    }

    return NextResponse.json({ success: true, summary: result.summary, items: result.items })
  } catch (err: any) {
    console.error('Call extraction route error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
