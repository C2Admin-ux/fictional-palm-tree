import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getSessionUser, unauthorized } from '@/lib/api-auth'
import type { Inspection, InspectionItem } from '@/lib/supabase/types'
import { INSPECTION_TYPE_LABELS, TEMPLATE_SECTIONS } from '@/lib/inspections/templates'
import { longSignedUrls } from '@/lib/storage'
import { buildInspectionEmail, buildInspectionSummaryEmail } from '@/lib/inspections/report-email'
import { formatDate } from '@/lib/utils'

// ── Draft the report email for the PM ────────────────────────
// POST /api/inspections/[id]/draft  (session-authenticated)
// Body: { message?: string, format?: 'findings' | 'summary' }
//
// Returns { success, subject, html, text } — draft CONTENT only. The app
// NEVER sends email to a PM: Nick is the only person who sends. The
// client opens a prefilled Gmail compose window (text variant) or copies
// the formatted HTML to the clipboard; recipients are his to type in
// Gmail — nothing is preloaded here.
//
// Formats:
//   'findings' (default) — the full report as an email body: findings as
//     bullets grouped by section, photos as 30-day signed-URL hyperlinks,
//     plus a "Full PDF report" link when a stored report exists.
//   'summary' — short note + score card + the PDF link (requires a
//     generated report — the link IS the report in this variant).
//
// No status change happens here — drafting is read-only. Marking the
// report sent is a separate explicit action in the UI (the app can't
// observe a send it doesn't perform).

const DRAFT_FORMATS = ['findings', 'summary'] as const
type DraftFormat = (typeof DRAFT_FORMATS)[number]

type InspectionJoin = Inspection & { properties: { name: string } | null }

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await getSessionUser())) return unauthorized()

  let body: { message?: string; format?: unknown } = {}
  try { body = await req.json() } catch { /* empty body is fine — defaults apply */ }

  if (body.format !== undefined && !(DRAFT_FORMATS as readonly unknown[]).includes(body.format)) {
    return NextResponse.json({ error: `format must be one of: ${DRAFT_FORMATS.join(', ')}` }, { status: 400 })
  }
  const format = (body.format as DraftFormat | undefined) ?? 'findings'

  const supabase = await createClient()

  const { data: inspectionData, error: inspectionError } = await supabase
    .from('inspections')
    .select('*, properties(name)')
    .eq('id', params.id)
    .single()
  if (inspectionError || !inspectionData) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
  }
  const inspection = inspectionData as unknown as InspectionJoin

  // A draft walk has partial findings — no report to email yet.
  if (inspection.status === 'draft') {
    return NextResponse.json({ error: 'Inspection must be submitted first' }, { status: 409 })
  }

  // The PDF requirement is per-format: 'summary' is built around the PDF
  // link; 'findings' carries everything in-body and merely adds the link
  // when a stored report exists.
  if (format === 'summary' && !inspection.report_file_path) {
    return NextResponse.json({ error: 'No report generated yet — generate the PDF first' }, { status: 400 })
  }

  const { data: itemsData, error: itemsError } = await supabase
    .from('inspection_items')
    .select('*')
    .eq('inspection_id', params.id)
    .order('created_at')
  if (itemsError) {
    return NextResponse.json({ error: 'Could not load findings', detail: itemsError.message }, { status: 500 })
  }
  const items = (itemsData ?? []) as InspectionItem[]

  const propertyName = inspection.properties?.name ?? 'Property'
  const dateLabel = formatDate(inspection.inspection_date)
  const typeLabel = INSPECTION_TYPE_LABELS[inspection.inspection_type] ?? inspection.inspection_type
  const message = body.message?.trim() || null
  const subject = `Property Inspection Report — ${propertyName} — ${dateLabel}`

  // Long-lived signed URLs (30 days — matches the note in the drafting
  // modal and lib/storage's LONG_SIGNED_URL_TTL_S): the stored PDF when
  // one exists, plus every finding photo for the findings format. A total
  // signing failure fails loud; individually missing photo paths are
  // disclosed inside the built email.
  const admin = await createAdminClient()
  const photoPaths = format === 'findings'
    ? Array.from(new Set(items.flatMap(i => i.photo_paths)))
    : []
  const allPaths = inspection.report_file_path ? [...photoPaths, inspection.report_file_path] : photoPaths
  const { urls, error: signError } = await longSignedUrls(admin, allPaths)
  if (signError) {
    return NextResponse.json({ error: 'Could not create document links', detail: signError }, { status: 500 })
  }
  const pdfUrl = inspection.report_file_path ? urls[inspection.report_file_path] ?? null : null
  if (format === 'summary' && !pdfUrl) {
    return NextResponse.json({ error: 'Could not create a link to the stored PDF — try regenerating the report' }, { status: 500 })
  }

  const shared = {
    propertyName, typeLabel, dateLabel,
    // Recipients/contacts are deliberately NOT resolved — Nick types them
    // in Gmail himself, so the greeting stays generic.
    contactName: null,
    message,
    inspectionNotes: inspection.notes,
    items,
  }
  const { html, text } = format === 'summary'
    ? buildInspectionSummaryEmail({ ...shared, pdfUrl: pdfUrl! })
    : buildInspectionEmail({
        ...shared,
        template: TEMPLATE_SECTIONS[inspection.inspection_type] ?? TEMPLATE_SECTIONS.site_visit,
        photoUrls: urls,
        pdfUrl,
      })

  return NextResponse.json({ success: true, subject, html, text })
}
