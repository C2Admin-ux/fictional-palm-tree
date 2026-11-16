// Recap email for a PM call. Format (Nick, 2026-11-15):
//
//   Hi all,
//   <blank line — Nick writes his own sentence here in Gmail>
//
//   Victoria
//   - Re-engage unlocked leads with 1-month-free offer
//   - Pull lease trade-out report
//
//   Cory
//   - Follow up with Rob on wood chipping timeline
//
// No summary, no due dates, no closing (his Gmail signature handles it).
// Bullets are grouped under the responsible person's first name; when no
// person was identified the PMC name (PM items) or "Nick" (owner items)
// stands in. An optional "Still open from previous calls" section is
// appended only for series with recap_carryover on (pilot: Cottages on
// Vance). Built both as plain text and as simple HTML so the Gmail draft
// shows real bullets.

import { formatDate } from '@/lib/utils'

export type RecapLine = {
  text: string
  name: string | null          // owner_name — first name of the responsible person
  owner: string | null         // 'pm' | 'owner' | null — fallback grouping only
}
export type RecapInput = {
  seriesName: string
  callDate: string
  pmcName: string | null
  items: RecapLine[]           // this call's action items
  carried: RecapLine[]         // open items from earlier calls (empty unless enabled)
}
export type Recap = { subject: string; body: string; html: string }

function label(l: RecapLine, pmcName: string | null): string {
  if (l.name?.trim()) return l.name.trim()
  if (l.owner === 'owner' || l.owner === 'c2') return 'Nick'
  if (l.owner === 'pm') return pmcName ?? 'Property management'
  return 'Unassigned'
}

/** Group by person, in order of first appearance; "Unassigned" last. */
function group(lines: RecapLine[], pmcName: string | null): [string, string[]][] {
  const map = new Map<string, string[]>()
  for (const l of lines) {
    const key = label(l, pmcName)
    map.set(key, [...(map.get(key) ?? []), l.text.trim()])
  }
  const out = Array.from(map.entries())
  return [...out.filter(([k]) => k !== 'Unassigned'), ...out.filter(([k]) => k === 'Unassigned')]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function recapSubject(seriesName: string, callDate: string): string {
  return `Recap & action items – ${seriesName} – ${formatDate(callDate)}`
}

export function buildRecap(input: RecapInput): Recap {
  const text: string[] = ['Hi all,', '', '']
  const html: string[] = ['<div>Hi all,</div><div><br></div><div><br></div>']

  const section = (lines: RecapLine[]) => {
    for (const [name, bullets] of group(lines, input.pmcName)) {
      text.push(name, ...bullets.map(b => `- ${b}`), '')
      html.push(`<div><b>${esc(name)}</b></div><ul>${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`)
    }
  }

  section(input.items)
  if (input.carried.length) {
    text.push('Still open from previous calls', '')
    html.push('<div><br></div><div><u>Still open from previous calls</u></div><div><br></div>')
    section(input.carried)
  }

  return {
    subject: recapSubject(input.seriesName, input.callDate),
    body: text.join('\n').trimEnd() + '\n',
    html: html.join(''),
  }
}

/** mailto: fallback for the manual button. Recipients left blank on
 *  purpose — Nick adds them. */
export function mailtoHref(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
