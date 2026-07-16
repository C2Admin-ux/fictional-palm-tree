import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getSessionUser, unauthorized } from '@/lib/api-auth'
import type { Inspection, InspectionItem } from '@/lib/supabase/types'
import { TEMPLATE_SECTIONS, INSPECTION_TYPE_LABELS } from '@/lib/inspections/templates'
import { buildSectionInstances, groupItemsByInstance } from '@/lib/inspections/sections'
import { inspectionScore, scoreGrade } from '@/lib/inspections/score'
import { BUCKET } from '@/lib/inspections/photos'
import { renderInspectionReport, type ReportData, type ReportPhoto } from '@/lib/inspections/report'
import { formatDate } from '@/lib/utils'

// ── Generate the inspection PDF report ───────────────────────
// POST /api/inspections/[id]/report  (session-authenticated)
//
// Loads the inspection + findings + property/PMC, downloads the finding
// photos from storage, renders the PDF with @react-pdf/renderer and stores
// it back to the private c2-documents bucket. Returns { success, path } —
// never the PDF bytes themselves (Vercel caps responses at 4.5MB; a
// photo-heavy report can exceed that). The client opens the stored file
// via a signed URL. Regenerating upserts the same path.

// Photo downloads + PDF render can take a while on a photo-heavy annual.
export const maxDuration = 60

type InspectionJoin = Inspection & {
  properties: { name: string; pmcs: { name: string } | null } | null
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await getSessionUser())) return unauthorized()

  const supabase = await createClient()

  // Inspection + property + PMC name (session client — RLS applies).
  const { data: inspectionData, error: inspectionError } = await supabase
    .from('inspections')
    .select('*, properties(name, pmcs(name))')
    .eq('id', params.id)
    .single()
  if (inspectionError || !inspectionData) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
  }
  const inspection = inspectionData as unknown as InspectionJoin

  const { data: itemsData, error: itemsError } = await supabase
    .from('inspection_items')
    .select('*')
    .eq('inspection_id', params.id)
    .order('created_at')
  if (itemsError) {
    return NextResponse.json({ error: 'Could not load findings', detail: itemsError.message }, { status: 500 })
  }
  const items = (itemsData ?? []) as InspectionItem[]

  // Inspector display name (best-effort — report renders without it).
  let inspectorName: string | null = null
  if (inspection.inspected_by) {
    const { data: profile } = await supabase
      .from('user_profiles').select('full_name').eq('id', inspection.inspected_by).single()
    inspectorName = profile?.full_name ?? null
  }

  // ── Photos: download bytes from the private bucket ─────────
  // Service-role client for storage; sequential fetches keep serverless
  // memory sane. Photos are already compressed client-side (~1600px JPEG),
  // so each is a few hundred KB at most. @react-pdf/renderer embeds only
  // JPEG/PNG — rare webp/gif fallback uploads are skipped, and an
  // individual failed download drops that photo rather than the report.
  const admin = await createAdminClient()
  const photos: Record<string, ReportPhoto> = {}
  const allPaths = Array.from(new Set(items.flatMap(i => i.photo_paths)))
  for (const path of allPaths) {
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    const format = ext === 'jpg' || ext === 'jpeg' ? 'jpg' : ext === 'png' ? 'png' : null
    if (!format) continue
    const { data: blob, error } = await admin.storage.from(BUCKET).download(path)
    if (error || !blob) continue
    photos[path] = { data: Buffer.from(await blob.arrayBuffer()), format }
  }

  // ── Assemble + render ───────────────────────────────────────
  const template = TEMPLATE_SECTIONS[inspection.inspection_type] ?? TEMPLATE_SECTIONS.site_visit
  const instances = buildSectionInstances(template, items)
  const actionItems = items.filter(i => i.requires_action)

  const data: ReportData = {
    propertyName: inspection.properties?.name ?? 'Property',
    pmcName: inspection.properties?.pmcs?.name ?? null,
    typeLabel: INSPECTION_TYPE_LABELS[inspection.inspection_type] ?? inspection.inspection_type,
    dateLabel: formatDate(inspection.inspection_date),
    inspectorName,
    notes: inspection.notes,
    score: inspectionScore(items),
    grade: scoreGrade(inspectionScore(items)),
    openFindings: actionItems.length,
    groups: groupItemsByInstance(instances, items),
    actionItems,
    photos,
  }

  try {
    const pdf = await renderInspectionReport(data)

    // Store next to the inspection's photos; regenerating overwrites.
    const path = `${inspection.property_id}/inspections/${inspection.id}/report-${inspection.inspection_date}.pdf`
    const { error: uploadError } = await admin.storage.from(BUCKET)
      .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
    if (uploadError) {
      return NextResponse.json({ error: 'Could not store report', detail: uploadError.message }, { status: 500 })
    }

    const { error: updateError } = await supabase
      .from('inspections').update({ report_file_path: path }).eq('id', inspection.id)
    if (updateError) {
      return NextResponse.json({ error: 'Report stored but could not save its path', detail: updateError.message }, { status: 500 })
    }

    // If the inspection date changed since the last generation, the old
    // report sits at a different path — best-effort cleanup (orphaned
    // files acceptable, a failed generation is not).
    if (inspection.report_file_path && inspection.report_file_path !== path) {
      try { await admin.storage.from(BUCKET).remove([inspection.report_file_path]) } catch { /* non-fatal */ }
    }

    return NextResponse.json({ success: true, path })
  } catch (err) {
    console.error('Report generation failed:', err)
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Report generation failed', detail }, { status: 500 })
  }
}
