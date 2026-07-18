import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { anthropicConfigured } from '@/lib/anthropic'
import { extractCall } from '@/lib/calls/extract'
import type { Call, Database } from '@/lib/supabase/types'

// Inbound call notes by email (Resend `email.received` webhook).
// Gemini/Meet call notes auto-forwarded to the receiving address land
// here: verify the webhook, fetch the full email, create a DRAFT call
// (pmc unassigned — Nick assigns during review), and run extraction
// inline as best-effort. Extraction failure still leaves the draft.
//
// Auth (fail closed, mirroring the cron philosophy in lib/api-auth.ts):
//   • RESEND_INBOUND_SECRET set   → svix signature must verify
//   • unset                      → only a ?token= matching CRON_SECRET
//     passes (no CRON_SECRET → everything rejected)

export const maxDuration = 120

const SVIX_TOLERANCE_SECONDS = 5 * 60

// Minimal svix webhook verification with node crypto (no new deps):
// HMAC-SHA256 over `${id}.${timestamp}.${payload}` keyed by the
// base64-decoded secret (after the `whsec_` prefix), base64-encoded,
// compared against each `v1,<sig>` entry in svix-signature.
function verifySvixSignature(secret: string, req: NextRequest, payload: string): boolean {
  const id = req.headers.get('svix-id')
  const timestamp = req.headers.get('svix-timestamp')
  const signatures = req.headers.get('svix-signature')
  if (!id || !timestamp || !signatures) return false

  // Reject stale/future timestamps (replay window).
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SVIX_TOLERANCE_SECONDS) return false

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest()

  return signatures.split(' ').some(entry => {
    const [version, sig] = entry.split(',')
    if (version !== 'v1' || !sig) return false
    // Buffer.from never throws on malformed base64 — it decodes what it
    // can; the length check rejects anything that isn't a full HMAC.
    const candidate = Buffer.from(sig, 'base64')
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)
  })
}

/** Strip any stack of Fwd:/Fw:/Re: prefixes from a subject line. */
function cleanSubject(subject: string): string {
  return subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').trim()
}

/** Crude but dependency-free HTML → text for emails without a text body. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type ReceivedEmail = {
  subject?: string
  text?: string | null
  html?: string | null
  attachments?: { content_type?: string; contentType?: string; content?: string; filename?: string }[]
}

/** Fetch the full received email from Resend. The received-emails
 *  endpoint is tried first; the generic emails endpoint is the fallback
 *  so an API path rename degrades gracefully instead of dropping mail. */
async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  for (const url of [
    `https://api.resend.com/emails/received/${emailId}`,
    `https://api.resend.com/emails/${emailId}`,
  ]) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
      if (res.ok) return await res.json() as ReceivedEmail
    } catch (err) {
      console.error(`Resend fetch failed for ${url}:`, err)
    }
  }
  return null
}

/** Best text body: text part, else first text/* attachment, else HTML
 *  stripped to text. Empty string when nothing usable exists. */
function bestBody(email: ReceivedEmail): string {
  if (email.text?.trim()) return email.text.trim()
  for (const att of email.attachments ?? []) {
    const type = att.content_type ?? att.contentType ?? ''
    if (type.startsWith('text/') && att.content) {
      try {
        const decoded = Buffer.from(att.content, 'base64').toString('utf8').trim()
        if (decoded) return decoded
      } catch { /* not base64 — skip */ }
    }
  }
  if (email.html?.trim()) return htmlToText(email.html)
  return ''
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.text()

    // ── Auth (fail closed) ─────────────────────────────────────
    const inboundSecret = process.env.RESEND_INBOUND_SECRET
    if (inboundSecret) {
      if (!verifySvixSignature(inboundSecret, req, payload)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    } else {
      const cronSecret = process.env.CRON_SECRET
      const token = req.nextUrl.searchParams.get('token')
      if (!cronSecret || token !== cronSecret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    let event: any
    try { event = JSON.parse(payload) } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
    }

    // Only inbound mail creates calls — other event types ack silently
    // so Resend never retries them.
    if (event?.type !== 'email.received') {
      return NextResponse.json({ success: true, ignored: event?.type ?? 'unknown' })
    }

    const emailId: string | undefined = event?.data?.email_id ?? event?.data?.id
    // The webhook payload sometimes carries the content inline; the
    // Received Emails API is the fallback for body-less events.
    let email: ReceivedEmail = {
      subject: event?.data?.subject,
      text: event?.data?.text,
      html: event?.data?.html,
      attachments: event?.data?.attachments,
    }
    if (!bestBody(email) && emailId) {
      const fetched = await fetchReceivedEmail(emailId)
      // Webhook subject wins when present — spread fetched FIRST so the
      // computed subject isn't clobbered by the fetched one.
      if (fetched) email = { ...fetched, subject: email.subject ?? fetched.subject }
    }

    const transcript = bestBody(email)
    if (!transcript) {
      // Nothing extractable — ack so Resend doesn't retry a permanently
      // empty email, but say so in the response for the webhook log.
      return NextResponse.json({ success: true, skipped: 'empty email body' })
    }
    const title = cleanSubject(email.subject ?? '') || 'PM call notes (email)'
    const today = new Date().toISOString().slice(0, 10)

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Webhook retries (timeout, 5xx) must not pile up duplicate drafts.
    // Dedupe on the EMAIL'S identity: external_id carries the Resend
    // email id under a unique partial index, so the unique-violation on
    // insert IS the duplicate signal — atomic, no check-then-insert
    // race, and two distinct same-day emails with the same subject both
    // land. (Events without an email id can't dedupe — external_id null
    // sits outside the partial index.)
    const { data: call, error: insertError } = await supabase.from('calls')
      .insert({
        title,
        call_date: today,
        source: 'email',
        external_id: emailId ?? null,
        transcript,
        status: 'draft',
        pmc_id: null, // Nick assigns the PMC during review
      })
      .select('*')
      .single()
    if (insertError || !call) {
      if (insertError?.code === '23505' && emailId) {
        // Already ingested — ack with the existing call so Resend stops
        // retrying (the lookup is best-effort).
        const { data: existing } = await supabase.from('calls')
          .select('id').eq('external_id', emailId).limit(1)
        return NextResponse.json({ success: true, duplicate: true, call_id: existing?.[0]?.id ?? null })
      }
      console.error('Inbound call insert failed:', insertError)
      return NextResponse.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 })
    }

    // Extraction inline, best-effort: a failure (rate limit, model
    // hiccup) still leaves the draft call for manual re-run in the app.
    let extracted = false
    if (anthropicConfigured()) {
      try {
        const result = await extractCall(supabase, call as Call)
        extracted = result.ok
        if (!result.ok) console.error('Inbound extraction failed:', result.error, result.detail ?? '')
      } catch (err) {
        console.error('Inbound extraction threw:', err)
      }
    }

    return NextResponse.json({ success: true, call_id: call.id, extracted })
  } catch (err: any) {
    console.error('Inbound call route error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
