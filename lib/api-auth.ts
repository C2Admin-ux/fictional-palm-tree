import crypto from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Single source of truth for API-route authentication.
// Every /api route authenticates through these helpers so the checks can
// never drift between routes (the original fail-open cron bug existed
// because each route hand-rolled its own comparison).

/** True only when CRON_SECRET is set AND the request carries the matching
 *  bearer. Fail-closed by construction: no secret configured → false. */
export function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}

/** True only when CRON_SECRET is set AND the supplied token matches it.
 *  For callers that carry the secret in a body field instead of the
 *  Authorization header (e.g. the Gmail Apps Script posting to
 *  /api/calls/ingest). Constant-time: both sides are hashed to a fixed
 *  length so neither content nor length leaks through timing.
 *  Fail-closed by construction: no secret configured → false. */
export function isValidCronToken(token: unknown): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || typeof token !== 'string') return false
  const supplied = crypto.createHash('sha256').update(token).digest()
  const expected = crypto.createHash('sha256').update(secret).digest()
  return crypto.timingSafeEqual(supplied, expected)
}

/** The logged-in Supabase user for this request, or null. */
export async function getSessionUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

/** Canonical 401 response. */
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
