import { PRIORITY_LABELS, type ActionPriority, type TemplateSection } from '@/lib/inspections/templates'
import { buildSectionInstances, groupItemsByInstance, instanceLabel } from '@/lib/inspections/sections'
import { inspectionScore, scoreGrade, GRADE_HEX } from '@/lib/inspections/score'
import { daysSince, normalizeDisposition } from '@/lib/inspections/dispositions'
import { escHtml } from '@/lib/utils'

// Email-body inspection report drafts. NOTHING here (or anywhere in the
// app) sends email to a PM — Nick is the only person who sends; the app
// only builds draft content he opens in Gmail (compose URL / clipboard).
//
// Two variants:
//   buildInspectionEmail — the full report as an email body: findings as
//     bullets grouped by section instance (same grouping functions as the
//     app and the PDF, so "Vacant Unit · 204" reads the same everywhere),
//     follow-ups tagged by priority, photos as hyperlinks to long-lived
//     signed URLs rather than embeds, and two recap blocks at the top:
//     "Flagged for Your Action" (findings triaged 'flagged', with aging)
//     first, then the action-items recap — those are the blocks a PM
//     works from.
//   buildInspectionSummaryEmail — a short note: score card + a link to
//     the stored PDF report, for when the full list doesn't belong
//     in-body.
//
// Styling is deliberately INLINE on every element (no <style> sheet):
// the HTML's whole job is to be pasted into a Gmail compose window, and
// pasted content only keeps inline styles. A plain-text variant ships
// alongside — it feeds the Gmail compose URL's &body= and the clipboard
// fallback. Everything user-entered goes through escHtml.

// Minimal finding shape — satisfied by InspectionItem.
export type EmailFinding = {
  section_name: string
  unit_number: string | null
  item_label: string
  notes: string | null
  requires_action: boolean
  action_priority: string | null
  photo_paths: string[]
  // Triage fields (0011): flagged findings surface in their own top
  // section with aging; the score weights deductions by disposition.
  disposition: string | null
  disposition_at: string | null
}

export type InspectionEmailData = {
  propertyName: string
  typeLabel: string
  dateLabel: string
  contactName: string | null
  /** Optional note typed in the drafting modal — renders above the summary. */
  message: string | null
  inspectionNotes: string | null
  template: TemplateSection[]
  items: EmailFinding[]
  /** storage path → long-lived signed URL (paths absent here are disclosed as unavailable). */
  photoUrls: Record<string, string>
  /** Long-lived signed URL to the stored PDF report, when one exists. */
  pdfUrl: string | null
}

// The short variant: note + score card + PDF link, no findings list.
export type InspectionSummaryEmailData = Omit<InspectionEmailData, 'template' | 'photoUrls' | 'pdfUrl'> & {
  /** Required here — the PDF link IS the report in this variant. */
  pdfUrl: string
}

// Priority tag colors — text shades of the app's PRIORITY_STYLES palette
// (red/orange/blue/slate 700s) so the email tags match the UI badges.
const PRIORITY_TAG_HEX: Record<ActionPriority, string> = {
  urgent: '#b91c1c',
  high: '#c2410c',
  medium: '#1d4ed8',
  low: '#64748b',
}
const PRIORITY_ORDER: Record<ActionPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

// A requires_action item with an unknown/null priority reads as medium —
// the same default the score deduction uses.
function itemPriority(item: EmailFinding): ActionPriority {
  const p = item.action_priority
  return p && p in PRIORITY_LABELS ? p as ActionPriority : 'medium'
}

const MUTED = '#64748b'
const INK = '#1e293b'
const BORDER = '#e2e8f0'
const DIVIDER = '#f1f5f9'
const LINK = '#2563eb'

const cardStyle = `background:#ffffff;border:1px solid ${BORDER};border-radius:12px;margin-bottom:16px;`
const cardHeaderStyle = `padding:12px 20px;border-bottom:1px solid ${DIVIDER};font-size:12px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.05em;`

function priorityTagHtml(priority: ActionPriority): string {
  return `<span style="font-weight:700;font-size:11px;color:${PRIORITY_TAG_HEX[priority]};">[${PRIORITY_LABELS[priority].toUpperCase()}]</span>`
}

// "Photos: 1 · 2 · 3" — hyperlinks for the paths that signed successfully;
// returns null when the finding has no linkable photos.
function photoLinksHtml(item: EmailFinding, photoUrls: Record<string, string>): string | null {
  const urls = item.photo_paths.map(p => photoUrls[p]).filter((u): u is string => !!u)
  if (urls.length === 0) return null
  const links = urls
    .map((url, i) => `<a href="${escHtml(url)}" style="color:${LINK};text-decoration:underline;">${i + 1}</a>`)
    .join(' &nbsp;·&nbsp; ')
  return `<span style="font-size:12px;color:${MUTED};">Photos: ${links}</span>`
}

function findingLiHtml(item: EmailFinding, photoUrls: Record<string, string>): string {
  const label = item.item_label.trim()
  const notes = item.notes?.trim()
  const photos = photoLinksHtml(item, photoUrls)
  return `<li style="margin:0 0 10px;font-size:13px;color:${INK};line-height:1.5;">
      ${item.requires_action ? `${priorityTagHtml(itemPriority(item))} ` : ''}${label ? escHtml(label) : `<span style="color:#94a3b8;font-style:italic;">No description</span>`}${notes ? `<span style="color:${MUTED};"> — ${escHtml(notes)}</span>` : ''}${photos ? `<br>${photos}` : ''}
    </li>`
}

// ── Shared fragments ─────────────────────────────────────────

function docHtml(inner: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Property Inspection Report</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;">
<div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
${inner}
</div>
</body>
</html>`
}

function headerHtml(propertyName: string, typeLabel: string, dateLabel: string): string {
  return `  <div style="text-align:center;padding:0 0 16px;">
    <h1 style="font-size:18px;font-weight:700;color:${INK};margin:0 0 4px;">Property Inspection Report</h1>
    <p style="font-size:13px;color:${MUTED};margin:0;">${escHtml(propertyName)} · ${escHtml(typeLabel)} · ${escHtml(dateLabel)}</p>
  </div>`
}

function greetingHtml(contactName: string | null, message: string | null): string {
  return `${contactName ? `  <p style="font-size:13px;color:#475569;margin:0 0 12px;">Hi ${escHtml(contactName)},</p>\n` : ''}${message ? `  <p style="font-size:13px;color:#475569;margin:0 0 16px;white-space:pre-line;">${escHtml(message)}</p>\n` : ''}`
}

function scoreCardHtml({ score, grade, findingsCount, actionCount, flaggedCount, inspectionNotes, pdfUrl }: {
  score: number
  grade: string
  findingsCount: number
  actionCount: number
  flaggedCount: number
  inspectionNotes: string | null
  pdfUrl: string | null
}): string {
  const gradeColor = GRADE_HEX[grade as keyof typeof GRADE_HEX] ?? MUTED
  return `  <div style="${cardStyle}">
    <div style="padding:16px 20px;">
      <span style="display:inline-block;width:44px;height:44px;border-radius:8px;background:${gradeColor};color:#ffffff;font-size:22px;font-weight:700;text-align:center;line-height:44px;vertical-align:middle;">${grade}</span>
      <span style="display:inline-block;vertical-align:middle;margin-left:12px;">
        <span style="display:block;font-size:18px;font-weight:700;color:${INK};">${score} / 100</span>
        <span style="display:block;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Property score</span>
      </span>
    </div>
    <div style="border-top:1px solid ${DIVIDER};padding:10px 20px;font-size:13px;color:#475569;">
      <strong style="color:${INK};">${findingsCount}</strong> finding${findingsCount === 1 ? '' : 's'} recorded ·
      <strong style="color:${INK};">${actionCount}</strong> action item${actionCount === 1 ? '' : 's'} requiring follow-up${flaggedCount > 0 ? ` ·
      <strong style="color:#b91c1c;">${flaggedCount}</strong> flagged for your action` : ''}
    </div>
    ${inspectionNotes ? `<div style="border-top:1px solid ${DIVIDER};padding:10px 20px;font-size:13px;color:#475569;white-space:pre-line;"><strong style="color:${INK};">Inspection notes:</strong> ${escHtml(inspectionNotes)}</div>` : ''}
    ${pdfUrl ? `<div style="border-top:1px solid ${DIVIDER};padding:10px 20px;font-size:13px;">📄 <a href="${escHtml(pdfUrl)}" style="color:${LINK};text-decoration:underline;">Full PDF report</a> <span style="font-size:11px;color:#94a3b8;">(link valid for 30 days)</span></div>` : ''}
  </div>`
}

const FOOTER_LINE = 'C2 Capital · Property Inspection Report'

// Shared opening of the plain-text variant.
function textHeaderLines(data: {
  propertyName: string; typeLabel: string; dateLabel: string
  contactName: string | null; message: string | null; inspectionNotes: string | null
  score: number; grade: string; findingsCount: number; actionCount: number
  flaggedCount: number; pdfUrl: string | null
}): string[] {
  const lines: string[] = []
  lines.push('PROPERTY INSPECTION REPORT')
  lines.push(`${data.propertyName} · ${data.typeLabel} · ${data.dateLabel}`)
  lines.push(`Score: ${data.score}/100 (${data.grade}) · ${data.findingsCount} finding${data.findingsCount === 1 ? '' : 's'} · ${data.actionCount} action item${data.actionCount === 1 ? '' : 's'}${data.flaggedCount > 0 ? ` · ${data.flaggedCount} flagged for your action` : ''}`)
  lines.push('')
  if (data.contactName) { lines.push(`Hi ${data.contactName},`); lines.push('') }
  if (data.message) { lines.push(data.message); lines.push('') }
  if (data.inspectionNotes) { lines.push(`Inspection notes: ${data.inspectionNotes}`); lines.push('') }
  if (data.pdfUrl) { lines.push(`Full PDF report (link valid for 30 days): ${data.pdfUrl}`); lines.push('') }
  return lines
}

// ── Full report (bulleted findings) ──────────────────────────

export function buildInspectionEmail(data: InspectionEmailData): { html: string; text: string } {
  const {
    propertyName, typeLabel, dateLabel, contactName, message,
    inspectionNotes, template, items, photoUrls, pdfUrl,
  } = data

  const score = inspectionScore(items)
  const grade = scoreGrade(score)
  const actionItems = items
    .filter(i => i.requires_action)
    .sort((a, b) => PRIORITY_ORDER[itemPriority(a)] - PRIORITY_ORDER[itemPriority(b)])
  // Flagged findings lead the email — they're the triage verb for "the PM
  // must act on this". Priority first, then oldest flag first (the ones
  // waiting longest deserve the top).
  const flaggedItems = items
    .filter(i => normalizeDisposition(i.disposition) === 'flagged')
    .sort((a, b) =>
      (PRIORITY_ORDER[itemPriority(a)] - PRIORITY_ORDER[itemPriority(b)])
      || ((daysSince(b.disposition_at) ?? 0) - (daysSince(a.disposition_at) ?? 0)))
  const flaggedAge = (item: EmailFinding) => {
    const d = daysSince(item.disposition_at)
    return d == null ? 'flagged' : d === 0 ? 'flagged today' : `flagged ${d}d ago`
  }
  const groups = groupItemsByInstance(buildSectionInstances(template, items), items)
  const linkedPhotoCount = items.flatMap(i => i.photo_paths).filter(p => photoUrls[p]).length
  const omittedPhotoLinks = items.flatMap(i => i.photo_paths).filter(p => !photoUrls[p]).length

  // ── HTML ─────────────────────────────────────────────────────
  const html = docHtml(`${headerHtml(propertyName, typeLabel, dateLabel)}

${greetingHtml(contactName, message)}
${scoreCardHtml({ score, grade, findingsCount: items.length, actionCount: actionItems.length, flaggedCount: flaggedItems.length, inspectionNotes, pdfUrl })}

  ${flaggedItems.length > 0 ? `
  <div style="background:#ffffff;border:1px solid #fecaca;border-radius:12px;margin-bottom:16px;">
    <div style="padding:12px 20px;border-bottom:1px solid #fee2e2;font-size:12px;font-weight:600;color:#b91c1c;text-transform:uppercase;letter-spacing:0.05em;">Flagged for Your Action (${flaggedItems.length})</div>
    <ul style="margin:0;padding:14px 20px 6px 38px;">
      ${flaggedItems.map(item => `<li style="margin:0 0 8px;font-size:13px;color:${INK};line-height:1.5;">
        ${priorityTagHtml(itemPriority(item))} ${item.item_label.trim() ? escHtml(item.item_label.trim()) : `<span style="color:#94a3b8;font-style:italic;">No description</span>`}
        <span style="font-size:12px;color:${MUTED};"> — ${escHtml(instanceLabel({ name: item.section_name, unit: item.unit_number }))} · ${flaggedAge(item)}</span>
      </li>`).join('')}
    </ul>
  </div>` : ''}

  ${actionItems.length > 0 ? `
  <div style="${cardStyle}">
    <div style="${cardHeaderStyle}">Action Items (${actionItems.length})</div>
    <ul style="margin:0;padding:14px 20px 6px 38px;">
      ${actionItems.map(item => `<li style="margin:0 0 8px;font-size:13px;color:${INK};line-height:1.5;">
        ${priorityTagHtml(itemPriority(item))} ${item.item_label.trim() ? escHtml(item.item_label.trim()) : `<span style="color:#94a3b8;font-style:italic;">No description</span>`}
        <span style="font-size:12px;color:${MUTED};"> — ${escHtml(instanceLabel({ name: item.section_name, unit: item.unit_number }))}</span>
      </li>`).join('')}
    </ul>
  </div>` : ''}

  ${groups.length > 0 ? `
  <div style="${cardStyle}">
    <div style="${cardHeaderStyle}">Findings by Section</div>
    ${groups.map(({ inst, items: groupItems }) => `
    <h3 style="font-size:12px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.05em;margin:16px 20px 8px;">${escHtml(instanceLabel(inst))} <span style="color:#cbd5e1;font-weight:400;">${groupItems.length}</span></h3>
    <ul style="margin:0;padding:0 20px 2px 38px;">
      ${groupItems.map(item => findingLiHtml(item, photoUrls)).join('')}
    </ul>`).join('')}
    <div style="height:10px;"></div>
  </div>` : ''}

  <div style="text-align:center;padding:16px 0;font-size:11px;color:#94a3b8;">
    ${linkedPhotoCount > 0 ? 'Photo links are valid for 30 days.<br>' : ''}
    ${omittedPhotoLinks > 0 ? `${omittedPhotoLinks} photo${omittedPhotoLinks === 1 ? '' : 's'} could not be linked.<br>` : ''}
    ${FOOTER_LINE}
  </div>`)

  // ── Plain text ───────────────────────────────────────────────
  const tag = (item: EmailFinding) => `[${PRIORITY_LABELS[itemPriority(item)].toUpperCase()}]`
  const lines = textHeaderLines({
    propertyName, typeLabel, dateLabel, contactName, message, inspectionNotes,
    score, grade, findingsCount: items.length, actionCount: actionItems.length,
    flaggedCount: flaggedItems.length, pdfUrl,
  })
  if (flaggedItems.length > 0) {
    lines.push(`FLAGGED FOR YOUR ACTION (${flaggedItems.length})`)
    for (const item of flaggedItems) {
      const label = item.item_label.trim() || 'No description'
      lines.push(`- ${tag(item)} ${label} — ${instanceLabel({ name: item.section_name, unit: item.unit_number })} · ${flaggedAge(item)}`)
    }
    lines.push('')
  }
  if (actionItems.length > 0) {
    lines.push(`ACTION ITEMS (${actionItems.length})`)
    for (const item of actionItems) {
      const label = item.item_label.trim() || 'No description'
      lines.push(`- ${tag(item)} ${label} — ${instanceLabel({ name: item.section_name, unit: item.unit_number })}`)
    }
    lines.push('')
  }
  if (groups.length > 0) {
    lines.push('FINDINGS BY SECTION')
    for (const { inst, items: groupItems } of groups) {
      lines.push('')
      lines.push(instanceLabel(inst).toUpperCase())
      for (const item of groupItems) {
        const label = item.item_label.trim() || 'No description'
        lines.push(`- ${item.requires_action ? `${tag(item)} ` : ''}${label}`)
        const notes = item.notes?.trim()
        if (notes) lines.push(`  Notes: ${notes}`)
        const urls = item.photo_paths.map(p => photoUrls[p]).filter((u): u is string => !!u)
        if (urls.length > 0) {
          lines.push('  Photos:')
          urls.forEach((url, i) => lines.push(`  ${i + 1}. ${url}`))
        }
      }
    }
    lines.push('')
  }
  if (linkedPhotoCount > 0) lines.push('Photo links are valid for 30 days.')
  if (omittedPhotoLinks > 0) lines.push(`${omittedPhotoLinks} photo${omittedPhotoLinks === 1 ? '' : 's'} could not be linked.`)
  lines.push(FOOTER_LINE)

  return { html, text: lines.join('\n') }
}

// ── Short note + PDF link ────────────────────────────────────
// For when the full findings list doesn't belong in the email body: the
// score card with a 30-day link to the stored PDF report.

export function buildInspectionSummaryEmail(data: InspectionSummaryEmailData): { html: string; text: string } {
  const { propertyName, typeLabel, dateLabel, contactName, message, inspectionNotes, items, pdfUrl } = data
  const score = inspectionScore(items)
  const grade = scoreGrade(score)
  const actionCount = items.filter(i => i.requires_action).length
  const flaggedCount = items.filter(i => normalizeDisposition(i.disposition) === 'flagged').length

  const html = docHtml(`${headerHtml(propertyName, typeLabel, dateLabel)}

${greetingHtml(contactName, message)}
${scoreCardHtml({ score, grade, findingsCount: items.length, actionCount, flaggedCount, inspectionNotes, pdfUrl })}

  <div style="text-align:center;padding:16px 0;font-size:11px;color:#94a3b8;">
    ${FOOTER_LINE}
  </div>`)

  const lines = textHeaderLines({
    propertyName, typeLabel, dateLabel, contactName, message, inspectionNotes,
    score, grade, findingsCount: items.length, actionCount, flaggedCount, pdfUrl,
  })
  lines.push(FOOTER_LINE)

  return { html, text: lines.join('\n') }
}
