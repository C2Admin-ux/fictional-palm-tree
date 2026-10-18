// Recap email built from what Nick SELECTED on a call page — not from
// everything the transcript proposed. Two sources feed it: this call's
// follow-ups he ticked for email, and still-open items carried over from
// earlier calls in the same series that he ticked as reminders. Plain
// text, first person, simple dashes — same voice as the scheduled draft.

import { formatDate } from '@/lib/utils'

export type RecapLine = { text: string; owner: string | null; due: string | null }
export type RecapInput = {
  seriesName: string
  callDate: string
  nextCallDate: string | null
  summary: string | null
  items: RecapLine[]          // follow-ups from this call, selected for email
  carried: RecapLine[]        // open items from earlier calls, selected as reminders
}

const OWNER_LABEL: Record<string, string> = { pm: 'Property management', c2: 'C2', owner: 'C2' }

function groupByOwner(lines: RecapLine[]): [string, RecapLine[]][] {
  const map = new Map<string, RecapLine[]>()
  for (const l of lines) {
    const key = OWNER_LABEL[l.owner ?? ''] ?? (l.owner || 'Unassigned')
    map.set(key, [...(map.get(key) ?? []), l])
  }
  return Array.from(map.entries())
}

export function buildRecap(input: RecapInput): { subject: string; body: string } {
  const subject = `Recap & action items – ${input.seriesName} – ${formatDate(input.callDate)}`
  const out: string[] = ['Hi all,', '']
  out.push(`Thanks for the time on ${formatDate(input.callDate)}.${input.summary ? ' ' + input.summary.trim() : ''}`)
  out.push('')

  if (input.items.length) {
    out.push('Action items')
    for (const [owner, lines] of groupByOwner(input.items)) {
      out.push('', owner)
      for (const l of lines) out.push(`- ${l.text}${l.due ? ` (due ${formatDate(l.due)})` : ''}`)
    }
    out.push('')
  }

  if (input.carried.length) {
    out.push('Still open from previous calls')
    for (const [owner, lines] of groupByOwner(input.carried)) {
      out.push('', owner)
      for (const l of lines) out.push(`- ${l.text}${l.due ? ` (was due ${formatDate(l.due)})` : ''}`)
    }
    out.push('')
  }

  if (input.nextCallDate) out.push(`Our next call is ${formatDate(input.nextCallDate)}; anything still open rolls onto that agenda.`, '')
  out.push('Thanks,', 'Nick')
  return { subject, body: out.join('\n') }
}

/** mailto: link that opens the user's mail client with the draft
 *  prefilled. Recipients are left blank on purpose — Nick adds them. */
export function mailtoHref(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
