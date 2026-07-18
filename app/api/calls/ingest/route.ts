import { NextRequest, NextResponse } from 'next/server'
import { isValidCronToken, unauthorized } from '@/lib/api-auth'
import { cleanCallTitle, ingestCallEmail, serviceRoleClient, trimTranscriptBoilerplate } from '@/lib/calls/ingest'

// Direct-post ingest for call-notes emails — the Gmail Apps Script
// transport (docs/apps-script-call-ingest.md). The owner's script polls
// his Gmail for Gemini notes emails and POSTs them here as JSON; no
// Resend account or receiving address involved. Same pipeline as the
// Resend webhook at /api/calls/inbound (shared in lib/calls/ingest.ts)
// — only the transport differs.
//
// Contract: POST { token, external_id, subject, body, received_at? }
//   → { success: true, call_id, extracted }
//   → { success: true, duplicate: true, call_id }  (already ingested)
//
// Auth (fail closed, mirroring the cron philosophy in lib/api-auth.ts):
// `token` must equal CRON_SECRET — constant-time compare, and every
// request is rejected when CRON_SECRET is unset.

export const maxDuration = 120

// Gemini notes emails are tens of KB at most; anything bigger is not a
// call-notes email. Checked on the raw payload before JSON.parse so
// oversized posts fail fast and cheap.
const MAX_PAYLOAD_BYTES = 100 * 1024

export async function POST(req: NextRequest) {
  try {
    const payload = await req.text()
    if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: 'Payload too large (max 100KB)' }, { status: 413 })
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(payload)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
    }

    if (!isValidCronToken(parsed?.token)) return unauthorized()

    const { external_id, subject, body, received_at } = parsed
    if (typeof external_id !== 'string' || !external_id.trim()) {
      return NextResponse.json({ error: 'external_id is required' }, { status: 400 })
    }
    if (typeof subject !== 'string' || typeof body !== 'string') {
      return NextResponse.json({ error: 'subject and body must be strings' }, { status: 400 })
    }

    // Dedupe key: the Gmail message id, namespaced so it can never
    // collide with Resend email ids under the same unique index. The
    // Apps Script already sends 'gmail:'-prefixed ids; prefix here too
    // so a hand-rolled caller gets the same identity.
    const externalId = external_id.startsWith('gmail:') ? external_id : `gmail:${external_id}`

    // Call date: the email's receive date when supplied, else today.
    let callDate = new Date().toISOString().slice(0, 10)
    if (received_at !== undefined) {
      const receivedMs = typeof received_at === 'string' ? Date.parse(received_at) : NaN
      if (Number.isNaN(receivedMs)) {
        return NextResponse.json({ error: 'received_at must be a parseable date string' }, { status: 400 })
      }
      callDate = new Date(receivedMs).toISOString().slice(0, 10)
    }

    const transcript = trimTranscriptBoilerplate(body)
    if (!transcript) {
      return NextResponse.json({ error: 'Email body is empty' }, { status: 400 })
    }
    const title = cleanCallTitle(subject) || 'PM call notes (email)'

    const result = await ingestCallEmail(serviceRoleClient(), { title, callDate, externalId, transcript })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    if (result.duplicate) {
      // Success to the caller — the Apps Script labels the message as
      // ingested on any 2xx, including redeliveries.
      return NextResponse.json({ success: true, duplicate: true, call_id: result.callId })
    }
    return NextResponse.json({ success: true, call_id: result.callId, extracted: result.extracted })
  } catch (err: any) {
    console.error('Call ingest route error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
