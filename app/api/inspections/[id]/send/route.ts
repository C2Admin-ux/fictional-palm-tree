import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getSessionUser, unauthorized } from '@/lib/api-auth'
import type { Inspection } from '@/lib/supabase/types'
import { INSPECTION_TYPE_LABELS } from '@/lib/inspections/templates'
import { inspectionScore, scoreGrade, GRADE_HEX } from '@/lib/inspections/score'
import { BUCKET } from '@/lib/inspections/photos'
import { formatDate } from '@/lib/utils'

// ── Email the inspection report to the PM ────────────────────
// POST /api/inspections/[id]/send  (session-authenticated)
// Body: { to?: string[], message?: string }
//
// Requires an already-generated report (400 otherwise — the UI generates
// first). Recipients come from the body when provided; otherwise falls
// back to the property's PMC primary contact. The stored PDF is attached
// (never regenerated here — what Nick previewed is what the PM gets).
// On success: status='report_sent', report_sent_at=now. Nothing here is
// automatic — this only runs off the explicit Send button.

const FROM = 'C2 Capital <inspections@c2capital.co>'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type InspectionJoin = Inspection & {
  properties: {
    name: string
    pmcs: { primary_contact_name: string | null; primary_contact_email: string | null } | null
  } | null
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await getSessionUser())) return unauthorized()

  let body: { to?: string[]; message?: string } = {}
  try { body = await req.json() } catch { /* empty body is fine — PMC fallback */ }

  const supabase = await createClient()

  const { data: inspectionData, error: inspectionError } = await supabase
    .from('inspections')
    .select('*, properties(name, pmcs(primary_contact_name, primary_contact_email))')
    .eq('id', params.id)
    .single()
  if (inspectionError || !inspectionData) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
  }
  const inspection = inspectionData as unknown as InspectionJoin

  if (!inspection.report_file_path) {
    return NextResponse.json({ error: 'No report generated yet — generate the PDF first' }, { status: 400 })
  }

  // Resolve recipients: explicit list from the client wins; otherwise the
  // property's PMC primary contact.
  const requested = (body.to ?? []).map(e => e.trim()).filter(Boolean)
  const invalid = requested.filter(e => !EMAIL_RE.test(e))
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Invalid email address: ${invalid.join(', ')}` }, { status: 400 })
  }
  const recipients = requested.length > 0
    ? requested
    : inspection.properties?.pmcs?.primary_contact_email
      ? [inspection.properties.pmcs.primary_contact_email]
      : []
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No recipient — the property has no PMC contact email on file' }, { status: 400 })
  }

  // Findings for the summary numbers (same score the PDF shows).
  const { data: itemsData, error: itemsError } = await supabase
    .from('inspection_items')
    .select('requires_action, action_priority')
    .eq('inspection_id', params.id)
  if (itemsError) {
    return NextResponse.json({ error: 'Could not load findings', detail: itemsError.message }, { status: 500 })
  }
  const items = itemsData ?? []
  const score = inspectionScore(items)
  const grade = scoreGrade(score)
  const actionCount = items.filter(i => i.requires_action).length

  // Attach the stored PDF (service-role — private bucket).
  const admin = await createAdminClient()
  const { data: pdfBlob, error: downloadError } = await admin.storage
    .from(BUCKET).download(inspection.report_file_path)
  if (downloadError || !pdfBlob) {
    return NextResponse.json(
      { error: 'Could not download the report PDF — try regenerating it', detail: downloadError?.message },
      { status: 500 },
    )
  }

  const propertyName = inspection.properties?.name ?? 'Property'
  const dateLabel = formatDate(inspection.inspection_date)
  const typeLabel = INSPECTION_TYPE_LABELS[inspection.inspection_type] ?? inspection.inspection_type

  try {
    const resend = new Resend(process.env.RESEND_API_KEY!)
    const { error: sendError } = await resend.emails.send({
      from: FROM,
      to: recipients,
      subject: `Property Inspection Report — ${propertyName} — ${dateLabel}`,
      html: buildEmailHtml({
        propertyName, dateLabel, typeLabel, score, grade,
        gradeColor: GRADE_HEX[grade],
        findingsCount: items.length,
        actionCount,
        message: body.message?.trim() || null,
        contactName: inspection.properties?.pmcs?.primary_contact_name ?? null,
      }),
      attachments: [{
        filename: `Inspection Report - ${propertyName} - ${inspection.inspection_date}.pdf`,
        content: Buffer.from(await pdfBlob.arrayBuffer()),
      }],
    })
    if (sendError) throw new Error(`Resend error: ${sendError.message}`)
  } catch (err) {
    console.error('Report send failed:', err)
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Email send failed', detail }, { status: 500 })
  }

  // Email is out the door — record it. A failure here must not claim the
  // send failed; report it so the UI can still flip the badge.
  const sentAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('inspections')
    .update({ status: 'report_sent', report_sent_at: sentAt })
    .eq('id', params.id)
  if (updateError) {
    return NextResponse.json({
      success: true, sent_to: recipients, sent_at: sentAt,
      warning: `Email sent but status update failed: ${updateError.message}`,
    })
  }

  return NextResponse.json({ success: true, sent_to: recipients, sent_at: sentAt })
}

// ── Email body ───────────────────────────────────────────────
// Short summary card in the digest's inline-CSS style — the substance is
// the attached PDF.

function buildEmailHtml({
  propertyName, dateLabel, typeLabel, score, grade, gradeColor,
  findingsCount, actionCount, message, contactName,
}: {
  propertyName: string
  dateLabel: string
  typeLabel: string
  score: number
  grade: string
  gradeColor: string
  findingsCount: number
  actionCount: number
  message: string | null
  contactName: string | null
}) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Property Inspection Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; margin: 0; padding: 0; }
  .wrapper { max-width: 560px; margin: 0 auto; padding: 24px 16px; }
  .header { text-align: center; padding: 16px 0; }
  .header h1 { font-size: 18px; font-weight: 700; color: #1e293b; margin: 0 0 4px; }
  .header p { font-size: 13px; color: #64748b; margin: 0; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 16px; overflow: hidden; }
  .score-row { display: flex; align-items: center; gap: 14px; padding: 18px 20px; }
  .grade { width: 44px; height: 44px; border-radius: 8px; color: #fff; font-size: 22px; font-weight: 700; text-align: center; line-height: 44px; }
  .score-num { font-size: 20px; font-weight: 700; color: #1e293b; }
  .score-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
  .stats { border-top: 1px solid #f1f5f9; padding: 12px 20px; font-size: 13px; color: #475569; }
  .stats strong { color: #1e293b; }
  .message { padding: 14px 20px; border-top: 1px solid #f1f5f9; font-size: 13px; color: #475569; }
  .attach-note { padding: 12px 20px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #64748b; }
  .footer { text-align: center; padding: 16px 0; font-size: 11px; color: #94a3b8; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>Property Inspection Report</h1>
    <p>${escHtml(propertyName)} · ${escHtml(typeLabel)} · ${escHtml(dateLabel)}</p>
  </div>
  ${contactName ? `<p style="font-size:13px;color:#475569;">Hi ${escHtml(contactName)},</p>` : ''}
  <div class="card">
    <div class="score-row">
      <div class="grade" style="background:${gradeColor};">${grade}</div>
      <div>
        <div class="score-num">${score} / 100</div>
        <div class="score-label">Property score</div>
      </div>
    </div>
    <div class="stats">
      <strong>${findingsCount}</strong> finding${findingsCount === 1 ? '' : 's'} recorded ·
      <strong>${actionCount}</strong> action item${actionCount === 1 ? '' : 's'} requiring follow-up
    </div>
    ${message ? `<div class="message">${escHtml(message)}</div>` : ''}
    <div class="attach-note">📎 The full inspection report is attached as a PDF, including photos and the complete action-item list.</div>
  </div>
  <div class="footer">C2 Capital · Property Inspection Report</div>
</div>
</body>
</html>`
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
