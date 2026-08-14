'use client'

// CapEx project photos — the gallery on the project detail page.
//
// Deliberately simpler than the inspection capture path: no IndexedDB
// queue, no retry ladder. That machinery exists because a property walk
// happens in dead zones on a phone; CapEx is desk work on a real
// connection, and Nick's standing note is that CapEx needs to be "high
// level accessible", not deeply mobile-hardened. Photos still compress
// client-side before upload — an 8MB camera original helps nobody.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CapexProject, CapexPhoto } from '@/lib/supabase/types'
import {
  BUCKET, compressImage, newCapexPhotoPath, signedCapexPhotoUrls,
  removeCapexPhotos, type SignedPhotoUrl,
} from '@/lib/capex/photos'
import { SchemaGapNotice } from '@/components/ui/schema-gap-notice'
import { isSchemaGapError } from '@/lib/supabase/schema-errors'
import { toast } from '@/components/ui/toast'
import { InlineText } from '@/components/ui/inline-edit'
import { Modal } from '@/components/ui/modal'
import {
  ImagePlus, Trash2, FileText, AlertTriangle, Camera, Loader2,
} from 'lucide-react'

// Re-sign a little before the hour is up so a thumbnail never 403s
// mid-view (same margin the inspection gallery uses).
const RESIGN_INTERVAL_MS = 10 * 60 * 1000

export function PhotosCard({ project }: { project: CapexProject }) {
  const supabase = createClient()
  const [photos, setPhotos] = useState<CapexPhoto[]>([])
  const [urls, setUrls] = useState<Record<string, SignedPhotoUrl>>({})
  const [schemaGap, setSchemaGap] = useState<{ code?: string | null; message?: string | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(0)
  const [building, setBuilding] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const fetchPhotos = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('capex_photos')
      .select('*')
      .eq('project_id', project.id)
      .order('sort_order')
      .order('created_at')
    // An empty gallery and a missing table look identical on screen. Only
    // the second is worth saying out loud — the same rule the bids card
    // follows.
    if (fetchError) {
      setSchemaGap(isSchemaGapError(fetchError) ? fetchError : null)
      if (!isSchemaGapError(fetchError)) setError(fetchError.message)
      setLoading(false)
      return
    }
    setSchemaGap(null)
    setError(null)
    setPhotos((data ?? []) as CapexPhoto[])
    setLoading(false)
  }, [project.id])

  useEffect(() => { fetchPhotos() }, [fetchPhotos])

  // Sign whatever isn't signed (or is about to expire), on mount and on a
  // slow interval. Failure leaves the placeholder tile rather than
  // clearing the gallery — the rows are still real.
  useEffect(() => {
    let cancelled = false
    const sign = async () => {
      const now = Date.now()
      const stale = photos
        .map(p => p.file_path)
        .filter(path => { const e = urls[path]; return !e || e.expiresAt <= now })
      if (stale.length === 0) return
      try {
        const fresh = await signedCapexPhotoUrls(supabase, stale)
        if (!cancelled) setUrls(prev => ({ ...prev, ...fresh }))
      } catch { /* placeholder tiles stand in */ }
    }
    sign()
    const t = setInterval(sign, RESIGN_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(t) }
    // urls is intentionally omitted: including it would re-run this effect
    // on its own result. The interval covers expiry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos])

  async function upload(files: FileList) {
    const list = Array.from(files)
    if (list.length === 0) return
    setUploading(list.length)
    setError(null)
    const stamp = Date.now()
    let failures = 0

    // Sequential rather than parallel: a handful of desk uploads finish
    // fast either way, and one at a time keeps the count honest and the
    // ordering stable.
    for (let i = 0; i < list.length; i++) {
      try {
        const { blob, contentType, ext } = await compressImage(list[i])
        const path = newCapexPhotoPath(project.property_id, project.id, stamp, i, ext)
        const { error: uploadError } = await supabase.storage.from(BUCKET)
          .upload(path, blob, { contentType })
        if (uploadError) throw new Error(uploadError.message)
        // Row after file: a row pointing at nothing is worse than an
        // orphaned file, and the orphan is cleaned up below.
        const { error: insertError } = await supabase.from('capex_photos').insert({
          project_id: project.id,
          file_path: path,
          file_name: list[i].name,
          sort_order: photos.length + i,
        })
        if (insertError) {
          void removeCapexPhotos(supabase, [path])
          throw new Error(insertError.message)
        }
      } catch (e) {
        failures++
        setError(e instanceof Error ? e.message : 'Upload failed')
      } finally {
        setUploading(n => n - 1)
      }
    }

    if (failures > 0) {
      toast(`${failures} photo${failures === 1 ? '' : 's'} failed to upload`, { tone: 'error' })
    } else {
      toast(`${list.length} photo${list.length === 1 ? '' : 's'} added`)
    }
    fetchPhotos()
  }

  async function saveCaption(photo: CapexPhoto, caption: string) {
    const trimmed = caption.trim()
    setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, caption: trimmed || null } : p))
    const { error: updateError } = await supabase.from('capex_photos')
      .update({ caption: trimmed || null }).eq('id', photo.id)
    if (updateError) {
      // Put the old value back rather than leaving the screen claiming a
      // caption the database doesn't have.
      setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, caption: photo.caption } : p))
      toast(`Couldn't save caption — ${updateError.message}`, { tone: 'error' })
    }
  }

  async function deletePhoto(photo: CapexPhoto) {
    if (!confirm('Delete this photo?')) return
    const { error: deleteError } = await supabase.from('capex_photos').delete().eq('id', photo.id)
    if (deleteError) {
      toast(`Couldn't delete photo — ${deleteError.message}`, { tone: 'error' })
      return
    }
    // DB first, storage after — a stray file is recoverable, a row
    // pointing at a deleted file is a broken tile.
    void removeCapexPhotos(supabase, [photo.file_path])
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    if (lightbox === photo.file_path) setLightbox(null)
  }

  async function buildSheet() {
    setBuilding(true)
    setError(null)
    try {
      const res = await fetch(`/api/capex/${project.id}/photo-sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        const base = json.error ?? `Photo sheet generation failed (${res.status})`
        throw new Error(json.detail ? `${base} — ${json.detail}` : base)
      }
      window.open(json.url, '_blank')
      if (json.omittedPhotos > 0) {
        toast(`Sheet built — ${json.omittedPhotos} photo${json.omittedPhotos === 1 ? '' : 's'} could not be included`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Photo sheet generation failed — try again.')
    } finally {
      setBuilding(false)
    }
  }

  if (schemaGap) {
    return (
      <div className="card p-4 space-y-3">
        <h2 className="section-title">Photos</h2>
        <SchemaGapNotice error={schemaGap}
          detail="Project photos need the capex_photos table from migration 0013_photo_sheets.sql." />
      </div>
    )
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="section-title mb-0">
          Photos{photos.length > 0 && <span className="text-slate-400 font-normal"> · {photos.length}</span>}
        </h2>
        <div className="flex items-center gap-2 ml-auto">
          {photos.length > 0 && (
            <button onClick={buildSheet} disabled={building} className="btn-secondary text-xs py-1.5"
              title="Build a printable 9-up photo sheet to send to vendors">
              <FileText size={13} />{building ? 'Building…' : 'Photo sheet'}
            </button>
          )}
          <button onClick={() => fileInput.current?.click()} disabled={uploading > 0}
            className="btn-secondary text-xs py-1.5">
            {uploading > 0
              ? <><Loader2 size={13} className="animate-spin" />Uploading {uploading}…</>
              : <><ImagePlus size={13} />Add photos</>}
          </button>
        </div>
        <input ref={fileInput} type="file" accept="image/*" multiple className="hidden"
          onChange={e => {
            if (e.target.files) upload(e.target.files)
            // Reset so re-picking the same file fires change again.
            e.target.value = ''
          }} />
      </div>

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0" />{error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : photos.length === 0 ? (
        <p className="text-sm text-slate-400">
          No photos yet — add scope shots, damage, or before/after so vendors and owners can see the work.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {photos.map(photo => (
            <div key={photo.id} className="group relative">
              <button type="button" onClick={() => setLightbox(photo.file_path)}
                className="block w-full rounded-lg overflow-hidden border border-slate-200 hover:border-slate-300">
                {urls[photo.file_path] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls[photo.file_path].url} alt={photo.caption ?? 'Project photo'}
                    className="w-full h-28 object-cover" />
                ) : (
                  <div className="w-full h-28 bg-slate-100 flex items-center justify-center">
                    <Camera size={16} className="text-slate-300" />
                  </div>
                )}
              </button>
              <button onClick={() => deletePhoto(photo)} aria-label="Delete photo"
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 border border-slate-200 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
                <Trash2 size={12} className="text-red-600" />
              </button>
              <div className="mt-1">
                <InlineText
                  value={photo.caption ?? ''}
                  onSave={v => saveCaption(photo, v)}
                  placeholder="Add a note…"
                  className="text-xs text-slate-600"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <Modal title="Photo" onClose={() => setLightbox(null)} maxWidth="4xl">
          <div className="p-4">
            {urls[lightbox] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[lightbox].url} alt="Project photo"
                className="w-full max-h-[70vh] object-contain rounded-lg" />
            ) : (
              <p className="text-sm text-slate-400">Photo unavailable.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
