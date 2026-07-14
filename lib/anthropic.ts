// Single source of truth for Anthropic API access.
// Every server route that calls Claude goes through callAnthropic() so the
// model id, auth headers, and API version can never drift between routes.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

// One model for all extraction/scan work (contracts, insurance, PCA, digest).
// Change it here and every caller follows.
export const EXTRACTION_MODEL = 'claude-sonnet-5'

export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/** POST to the Anthropic Messages API with auth + version headers attached.
 *  `body.model` defaults to EXTRACTION_MODEL; pass one explicitly to override. */
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
    body: JSON.stringify({ model: EXTRACTION_MODEL, ...body }),
  })
}

/** Join the text blocks of a Messages API response into one string. */
export function anthropicText(data: { content?: Array<{ type: string; text?: string }> }): string {
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}
