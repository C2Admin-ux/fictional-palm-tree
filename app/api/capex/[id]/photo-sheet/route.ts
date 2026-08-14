import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getSessionUser, unauthorized } from '@/lib/api-auth'
import type { CapexProject, CapexPhoto } from '@/lib/supabase/types'
import { BUCKET } from '@/lib/capex/photos'
import { downloadEmbeddableImages } from '@/lib/storage-server'
import { renderPhotoSheet, type PhotoSheetData, type SheetPhoto } from '@/lib/photo-sheet'
import { formatDate } from '@/lib/utils'

// ── Generate a CapEx project photo sheet ─────────────────────
// POST /api/capex/[id]/photo-sheet  (session-authenticated)
// Body: { paths?: string[] } — the photos to include. Omitted means all
// of the project's photos, in their stored order.
//
// The same captioned 3×3 grid the inspection sheet uses (lib/photo-sheet),
// for sending scope photos to bidding vendors. This is the only server
// route the capex module has: PDF rendering can't happen in the browser,
// so unlike the rest of capex it can't be a direct PostgREST call.
//
// Returns a signed URL rather than storing the PDF: a scope packet is
// generated per send, not curated like an inspection report, so there's
// nothing worth keeping a canonical stored copy of.

export const maxDuration = 60

// A generated sheet is a fresh, disposable document — 24h is plenty to
// download and attach it, and short enough that a leaked link dies.
const SHEET_URL_TTL_S = 60 * 60 * 24

type ProjectJoin = CapexProject & { properties: { name: string } | null }

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await getSessionUser())) return unauthorized()

  let body: unknown
  try { body = await req.json() } catch { body = null }
  const requested = (body as { paths?: unknown } | null)?.paths
  if (requested !== undefined
    && (!Array.isArray(requested) || requested.some(p => typeof p !== 'string'))) {
    return NextResponse.json({ error: 'Invalid photo selection' }, { status: 400 })
  }
  const selected = requested === undefined ? null : new Set(requested as string[])

  const supabase = await createClient()

  const { data: projectData, error: projectError } = await supabase
    .from('capex_projects')
    .select('*, properties(name)')
    .eq('id', params.id)
    .single()
  if (projectError || !projectData) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const project = projectData as unknown as ProjectJoin

  const { data: photoData, error: photosError } = await supabase
    .from('capex_photos')
    .select('*')
    .eq('project_id', params.id)
    .order('sort_order')
    .order('created_at')
  if (photosError) {
    return NextResponse.json({ error: 'Could not load photos', detail: photosError.message }, { status: 500 })
  }
  // Filtering the project's OWN rows (rather than trusting the posted
  // paths) is what scopes the selection — a path from another project
  // simply never matches.
  const rows = ((photoData ?? []) as CapexPhoto[])
    .filter(p => selected === null || selected.has(p.file_path))
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No photos to include' }, { status: 400 })
  }

  try {
    const admin = await createAdminClient()
    const { images, omitted } = await downloadEmbeddableImages(admin, rows.map(r => r.file_path))

    const photos: SheetPhoto[] = rows
      .filter(r => images[r.file_path])
      .map(r => ({
        image: images[r.file_path],
        // A capex photo has no finding to caption itself with, so the
        // heading is the project and the caption is whatever was typed.
        heading: project.title,
        caption: r.caption?.trim() || null,
      }))
    if (photos.length === 0) {
      return NextResponse.json(
        { error: 'None of the photos could be read from storage' }, { status: 500 })
    }

    const data: PhotoSheetData = {
      propertyName: project.properties?.name ?? 'Property',
      documentTitle: 'PROJECT PHOTOS',
      metaLines: [
        project.title,
        project.target_completion
          ? `Target completion · ${formatDate(project.target_completion)}`
          : `${photos.length} photo${photos.length === 1 ? '' : 's'}`,
      ],
      photos,
      omittedPhotos: omitted,
    }

    const pdf = await renderPhotoSheet(data)

    // Overwritten on every generation — one live scope packet per project,
    // not a version history.
    const path = `${project.property_id}/capex/${project.id}/photos/project-photos.pdf`
    const { error: uploadError } = await admin.storage.from(BUCKET)
      .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
    if (uploadError) {
      return NextResponse.json({ error: 'Could not store photo sheet', detail: uploadError.message }, { status: 500 })
    }

    const { data: signed, error: signError } = await admin.storage.from(BUCKET)
      .createSignedUrl(path, SHEET_URL_TTL_S)
    if (signError || !signed?.signedUrl) {
      return NextResponse.json(
        { error: 'Photo sheet built but could not be opened', detail: signError?.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true, url: signed.signedUrl, included: photos.length, omittedPhotos: omitted,
    })
  } catch (err) {
    console.error('CapEx photo sheet generation failed:', err)
    const detail = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'Photo sheet generation failed', detail }, { status: 500 })
  }
}
