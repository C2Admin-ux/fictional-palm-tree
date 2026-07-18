import { NextRequest, NextResponse } from 'next/server'
import { anthropicConfigured, anthropicNotConfigured, anthropicText, callAnthropic } from '@/lib/anthropic'
import { getSessionUser, unauthorized } from '@/lib/api-auth'

// Polishes the deterministic pre-call agenda into a tight narrative.
// Opt-in per click from /calls/agenda — the deterministic data view is
// the default and the ONLY source of facts here: the model reorders and
// tightens, it does not add.

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    if (!anthropicConfigured()) return anthropicNotConfigured()
    if (!(await getSessionUser())) return unauthorized()

    const { agenda, pmc_name } = await req.json()
    if (!agenda || typeof agenda !== 'string') {
      return NextResponse.json({ error: 'No agenda provided' }, { status: 400 })
    }

    const response = await callAnthropic({
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are prepping the owner of a multifamily real-estate portfolio for his weekly check-in call with his property management company${typeof pmc_name === 'string' && pmc_name ? ` (${pmc_name})` : ''}.

Below is the raw agenda data assembled from his tracking system. Rewrite it as a tight, call-ready agenda he can glance at while talking:

- Keep it grouped by property, most pressing property first.
- Lead each property with the accountability items (what the PM owes from last call / waiting-on items, with how long they've been waiting).
- Fold overdue tasks, upcoming deadlines, and inspection follow-ups into short bullets — one line each.
- Keep EVERY concrete item from the data. Do not invent, drop, or soften anything; do not add pleasantries or advice.
- Plain text with simple markdown headers and dashes. No preamble — start with the agenda title.

DATA:
${agenda}`,
      }],
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Agenda polish Anthropic error:', errText)
      return NextResponse.json({ error: 'Polish failed', detail: errText }, { status: 502 })
    }

    const text = anthropicText(await response.json()).trim()
    if (!text) {
      return NextResponse.json({ error: 'Empty polish result' }, { status: 422 })
    }

    return NextResponse.json({ success: true, text })
  } catch (err: any) {
    console.error('Agenda polish route error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
