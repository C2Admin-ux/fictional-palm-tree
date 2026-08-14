import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getSessionUser, unauthorized } from '@/lib/api-auth'
import type { Inspection, InspectionItem } from '@/lib/supabase/types'
import { TEMPLATE_SECTIONS, INSPECTION_TYPE_LABELS } from '@/lib/inspections/templates'
import { buildSectionInstances, groupItemsByInstance, instanceLabel } from '@/lib/inspections/sections'
import { BUCKET } from '@/lib/inspections/photos'
import { downloadEmbeddableImages } from '@/lib/storage-server'
import { isSchemaGapError, schemaGapMessage } from '@/lib/supabase/schema-errors'
import { renderPhotoSheet, type PhotoSheetData, type SheetPhoto } from '@/lib/photo-sheet'
import { formatDate } from '@/lib/utils'

// ── Generate the inspection photo sheet ──────────────────────
// POST /api/inspections/[id]/photo-sheet  (session-authenticated)
// Body: { paths: string[] } — the photos to include, chosen in the app.
//
// A SECOND export, separate from the PDF report: a captioned 3×3 photo
// grid meant to be attached to a follow-up email so recipients can see
// the photos without an app login. Stores to the private c2-documents
// bucket and returns { success, path, included, omittedPhotos } — never
// the PDF bytes (Vercel caps responses at 4.5MB). Regenerating upserts
// the same path.

// Photo downloads + PDF render can take a while on a photo-heavy walk.
export const maxDuration = 60

type InspectionJoin = Inspection & { properties: { name: string } | null }

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await getSessionUser())) return unauthorized()

  // Selection comes from the picker. An explicit list (rather than
  // "everything") is the whole point of the feature, so an empty or
  // malformed body is a 400 — never a silent fallback to all photos.
  let body: unknown
  try { body = await req.json() } catch { body = null }
  const requested = (body as { paths?: unknown } | null)?.paths
  if (!Array.isArray(requested) || requested.some(p => typeof p !== 'string')) {
    return NextResponse.json({ error: 'Select the photos to include' }, { status: 400 })
  }
  const selected = new Set(requested as string[])
  if (selected.size === 0) {
    return NextResponse.json({ error: 'Select at least one photo' }, { status: 400 })
  }

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

  // Unlike the report, a sheet is fine for an already-sent walk — it's a
  // supplementary attachment, not the record, and generating one must not
  // disturb the report's status machine. Only a draft is refused: its
  // findings are still being captured.
  if (inspection.status === 'draft') {
    return NextResponse.json({ error: 'Submit the inspection first' }, { status: 409 })
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

  // Walk the findings in the SAME order the report groups them, keeping
  // only selected photos. This both orders the sheet sensibly (by section
  // instance, as the walk was recorded) and scopes the selection to this
  // inspection — a path from another inspection simply never matches.
  const template = TEMPLATE_SECTIONS[inspection.inspection_type] ?? TEMPLATE_SECTIONS.site_visit
  const groups = groupItemsByInstance(buildSectionInstances(template, items), items)
  const ordered: { path: string; heading: string; caption: string | null }[] = []
  for (const { inst, items: groupItems } of groups) {
    for (const item of groupItems) {
      for (const path of item.photo_paths) {
        if (!selected.has(path)) continue
        ordered.push({
          path,
          heading: instanceLabel(inst),
          caption: item.item_label.trim() || null,
        })
      }
    }
  }
  if (ordered.length === 0) {
    return NextResponse.json(
      { error: 'None of the selected photos belong to this inspection' }, { status: 400 })
  }

  // Everything from here can fail for environment reasons (service-role
  // key, storage access, the PDF renderer itself) — keep it inside the
  // try so the caller always gets a JSON envelope naming the cause.
  try {
    const admin = await createAdminClient()
    const { images, omitted } = await downloadEmbeddableImages(admin, ordered.map(o => o.path))

    // A photo whose bytes we couldn't get is dropped from the grid and
    // counted, so the sheet discloses the gap instead of printing a hole.
    const photos: SheetPhoto[] = ordered
      .filter(o => images[o.path])
      .map(o => ({ image: images[o.path], heading: o.heading, caption: o.caption }))
    if (photos.length === 0) {
      return NextResponse.json(
        { error: 'None of the selected photos could be read from storage' }, { status: 500 })
    }

    const data: PhotoSheetData = {
      propertyName: inspection.properties?.name ?? 'Property',
      documentTitle: 'PHOTO LOG',
      metaLines: [
        `${INSPECTION_TYPE_LABELS[inspection.inspection_type] ?? inspection.inspection_type} Inspection · ${formatDate(inspection.inspection_date)}`,
        `${photos.length} photo${photos.length === 1 ? '' : 's'}`,
      ],
      photos,
      omittedPhotos: omitted,
    }

    const pdf = await renderPhotoSheet(data)

    // Stored beside the report; regenerating overwrites.
    const path = `${inspection.property_id}/inspections/${inspection.id}/photos-${inspection.inspection_date}.pdf`
    const { error: uploadError } = await admin.storage.from(BUCKET)
      .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
    if (uploadError) {
      return NextResponse.json({ error: 'Could not store photo sheet', detail: uploadError.message }, { status: 500 })
    }

    // Remember the selection so regenerating reopens the picker on it.
    // Deliberately records what was REQUESTED, not what rendered: a photo
    // that failed to download this time should stay ticked for the retry.
    const { error: updateError } = await supabase
      .from('inspections')
      .update({ photo_sheet_path: path, photo_sheet_paths: ordered.map(o => o.path) })
      .eq('id', inspection.id)
    if (updateError) {
      // The sheet itself rendered and uploaded fine — only remembering it
      // failed. When the cause is the pending 0013 migration, say so and
      // hand back a link anyway rather than making the work disappear.
      if (isSchemaGapError(updateError)) {
        const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60)
        return NextResponse.json({
          success: true, path, included: photos.length, omittedPhotos: omitted,
          url: signed?.signedUrl ?? null,
          warning: `${schemaGapMessage(updateError)} The sheet was built, but the app can't remember it until then.`,
        })
      }
      return NextResponse.json({ error: 'Photo sheet stored but could not save its path', detail: updateError.message }, { status: 500 })
    }

    // A changed inspection date moves the path — best-effort cleanup of
    // the file left at the old one.
    if (inspection.photo_sheet_path && inspection.photo_sheet_path !== path) {
      try { await admin.storage.from(BUCKET).remove([inspection.photo_sheet_path]) } catch { /* non-fatal */ }
    }

    return NextResponse.json({ success: true, path, included: photos.length, omittedPhotos: omitted })
  } catch (err) {
    console.error('Photo sheet generation failed:', err)
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Photo sheet generation failed', detail }, { status: 500 })
  }
}
