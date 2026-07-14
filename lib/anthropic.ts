import { NextResponse } from 'next/server'

// Single source of truth for Anthropic API access.
// Every server route that calls Claude goes through callAnthropic() so the
// model id, auth headers, and API version can never drift between routes.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

// One model for every Claude call in the app (document extraction and the
// digest inbox scan). Change it here and every caller follows.
export const DEFAULT_MODEL = 'claude-sonnet-5'

export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/** Canonical 500 response for a missing ANTHROPIC_API_KEY — one wording,
 *  shared by every route that needs the key. */
export function anthropicNotConfigured(): NextResponse {
  return NextResponse.json({
    error: 'API key not configured',
    detail: 'ANTHROPIC_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.',
  }, { status: 500 })
}

/** POST to the Anthropic Messages API with auth + version headers attached.
 *
 *  Defaults: `model` = DEFAULT_MODEL, `thinking` = disabled. The thinking
 *  default matters — claude-sonnet-5 runs adaptive thinking when the param
 *  is omitted, and thinking tokens count against max_tokens, which would
 *  silently truncate extraction responses tuned for the previous model.
 *  Callers can override either by passing them in `body`. */
export async function callAnthropic(
  body: Record<string, unknown>,
  opts: { betas?: string[] } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY!,
    'anthropic-version': ANTHROPIC_VERSION,
  }
  if (opts.betas?.length) headers['anthropic-beta'] = opts.betas.join(',')

  return fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      thinking: { type: 'disabled' },
      ...body,
    }),
  })
}

/** Join the text blocks of a Messages API response into one string. */
export function anthropicText(data: { content?: Array<{ type: string; text?: string }> }): string {
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}

/** Extract and parse the JSON object from a Messages API response.
 *  Returns null when no parseable object is found (caller decides the
 *  error response) — malformed model output must not throw into generic
 *  500 handlers. */
export function anthropicJson<T = any>(data: { content?: Array<{ type: string; text?: string }> }): T | null {
  const text = anthropicText(data)
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as T
  } catch {
    return null
  }
}
