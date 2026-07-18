// Shared email → draft-call ingest pipeline. Two transports deliver the
// same Gemini call-notes emails and must behave identically:
//   • POST /api/calls/inbound — Resend `email.received` webhook
//   • POST /api/calls/ingest  — direct JSON post (Gmail Apps Script)
// Both clean the subject into a title, trim Gemini boilerplate from the
// transcript, dedupe on external_id, insert a DRAFT call (pmc
// unassigned — Nick assigns during review), and run extraction inline
// as best-effort. Keeping the pipeline here means the transports can't
// drift; only how the email arrives differs.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { anthropicConfigured } from '@/lib/anthropic'
import { extractCall } from '@/lib/calls/extract'
import type { Call, Database } from '@/lib/supabase/types'

type Client = SupabaseClient<Database>

/** Service-role client for webhook/script contexts (no user session). */
export function serviceRoleClient(): Client {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Email subject → call title: strip any stack of Fwd:/Re: prefixes,
 *  unwrap the Gemini `Notes: "<meeting name>" - <date>` wrapper (the
 *  call row carries its own date), and shed surrounding quotes.
 *  Returns '' when nothing meaningful is left — callers supply the
 *  fallback title. */
export function cleanCallTitle(subject: string): string {
  let title = subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').trim()
  title = title.replace(/^notes?\s*:\s*/i, '').trim()
  // Trailing date suffix after a dash — "Jul 15, 2026", "July 15 2026",
  // "2026/07/15", "2026-07-15", or "7/15/26".
  title = title.replace(
    /\s*[-–—]\s*(?:[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*$/,
    ''
  ).trim()
  const quoted = title.match(/^["“](.+)["”]$/)
  if (quoted) title = quoted[1].trim()
  return title
}

// Gemini notes emails end with product boilerplate after the actual
// notes. Everything from the first footer marker on is dropped — the
// markers are specific enough that real call content never matches.
const FOOTER_MARKERS = [
  /^\s*gemini can make mistakes/i,
  /^\s*you can (?:also )?(?:open|view|find|read)\b.*\b(?:docs?|notes|transcript|recording)\b/i,
  /^\s*open (?:in|the) (?:google )?docs?\b/i,
  /^\s*view (?:the )?full (?:notes|transcript)\b/i,
  /^\s*this (?:email|summary) (?:was|is) (?:automatically )?generated/i,
  /^\s*google llc\b/i,
]

/** Drop trailing Gemini email boilerplate from a notes body. */
export function trimTranscriptBoilerplate(body: string): string {
  const lines = body.split('\n')
  const cut = lines.findIndex(line => FOOTER_MARKERS.some(marker => marker.test(line)))
  return (cut === -1 ? body : lines.slice(0, cut).join('\n')).trim()
}

export type IngestOutcome =
  | { ok: true; duplicate: false; callId: string; extracted: boolean }
  | { ok: true; duplicate: true; callId: string | null }
  | { ok: false; status: number; error: string }

/** Insert a draft call for one ingested email, then run extraction
 *  inline as best-effort (a failure still leaves the draft for manual
 *  re-run in the app).
 *
 *  Retries (webhook redelivery, Apps Script re-poll) must not pile up
 *  duplicate drafts, so this dedupes on the EMAIL'S identity:
 *  external_id sits under a unique partial index, so the
 *  unique-violation on insert IS the duplicate signal — atomic, no
 *  check-then-insert race, and two distinct same-day emails with the
 *  same subject both land. (externalId null sits outside the partial
 *  index and can't dedupe.) */
export async function ingestCallEmail(
  supabase: Client,
  args: { title: string; callDate: string; externalId: string | null; transcript: string }
): Promise<IngestOutcome> {
  const { data: call, error: insertError } = await supabase.from('calls')
    .insert({
      title: args.title,
      call_date: args.callDate,
      source: 'email',
      external_id: args.externalId,
      transcript: args.transcript,
      status: 'draft',
      pmc_id: null, // Nick assigns the PMC during review
    })
    .select('*')
    .single()
  if (insertError || !call) {
    if (insertError?.code === '23505' && args.externalId) {
      // Already ingested — report the existing call so the sender stops
      // retrying (the lookup is best-effort).
      const { data: existing } = await supabase.from('calls')
        .select('id').eq('external_id', args.externalId).limit(1)
      return { ok: true, duplicate: true, callId: existing?.[0]?.id ?? null }
    }
    console.error('Call ingest insert failed:', insertError)
    return { ok: false, status: 500, error: insertError?.message ?? 'Insert failed' }
  }

  // Extraction inline, best-effort: a failure (rate limit, model
  // hiccup) still leaves the draft call for manual re-run in the app.
  let extracted = false
  if (anthropicConfigured()) {
    try {
      const result = await extractCall(supabase, call as Call)
      extracted = result.ok
      if (!result.ok) console.error('Ingest extraction failed:', result.error, result.detail ?? '')
    } catch (err) {
      console.error('Ingest extraction threw:', err)
    }
  }

  return { ok: true, duplicate: false, callId: call.id, extracted }
}
