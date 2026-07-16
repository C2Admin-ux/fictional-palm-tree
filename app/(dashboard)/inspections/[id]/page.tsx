'use client'

// Inspection capture + review — the screen Nick walks a property with.
// Mobile-first: the add-finding form sits right under the header (one small
// scroll-to-top from anywhere) with a native section dropdown that follows
// how he walks (never forces an order), and findings save independently the
// moment he hits Save (flaky onsite connectivity must not lose work).
// Findings accumulate below, grouped by section instance.

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Inspection, InspectionItem } from '@/lib/supabase/types'
import {
  cn, propertyColor, formatDate,
  PRIORITY_STYLES, INSPECTION_STATUS_STYLES,
} from '@/lib/utils'
import {
  TEMPLATE_SECTIONS, INSPECTION_TYPE_LABELS, INSPECTION_STATUS_LABELS,
  ACTION_PRIORITIES, type ActionPriority, type TemplateSection,
} from '@/lib/inspections/templates'
import { uploadInspectionPhotos, signedPhotoUrls, removeInspectionPhotos, BUCKET, type SignedPhotoUrl } from '@/lib/inspections/photos'
import {
  instanceKey, instanceLabel, buildSectionInstances, countItemsByInstance,
  groupItemsByInstance, type SectionInstance,
} from '@/lib/inspections/sections'
import { Modal } from '@/components/ui/modal'
import { InlineText, InlineDate } from '@/components/ui/inline-edit'
import {
  ArrowLeft, Camera, X, Flag, Trash2, Pencil,
  ImagePlus, Check, AlertTriangle, ClipboardCheck, RotateCcw,
  FileText, Send, ExternalLink,
} from 'lucide-react'

type InspectionDetail = Inspection & { properties: { name: string } | null }

const PRIORITY_LABELS: Record<ActionPriority, string> = {
  low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent',
}

export default function InspectionDetailPage() {
  const params = useParams<{ id: string }>()
  const inspectionId = params.id
  const supabase = createClient()

  const [inspection, setInspection] = useState<InspectionDetail | null>(null)
  const [items, setItems] = useState<InspectionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Lightbox holds the storage PATH (not the URL) so a failed image load
  // can force a re-sign of exactly that path.
  const [photoUrls, setPhotoUrls] = useState<Record<string, SignedPhotoUrl>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [editItem, setEditItem] = useState<InspectionItem | null>(null)
  const [signTick, setSignTick] = useState(0)

  // Latest items, readable from async closures that may have gone stale
  // while an upload was in flight.
  const itemsRef = useRef<InspectionItem[]>([])
  useEffect(() => { itemsRef.current = items }, [items])

  // Latest inspection, for the same reason — invalidateReport runs after
  // async mutations and must see the current report/status fields.
  const inspectionRef = useRef<InspectionDetail | null>(null)
  useEffect(() => { inspectionRef.current = inspection }, [inspection])

  const fetchInspection = useCallback(async () => {
    const { data, error } = await supabase.from('inspections')
      .select('*, properties(name)').eq('id', inspectionId).single()
    if (error) {
      // Only a genuine no-rows result means "not found" — a transient
      // network/API failure must never kick an open inspection to a 404.
      if (error.code === 'PGRST116') { setNotFound(true); setLoading(false); return }
      setFetchError(error.message)
      setLoading(false)
      return
    }
    if (!data) { setNotFound(true); setLoading(false); return }
    setFetchError(null)
    setInspection(data as unknown as InspectionDetail)
    setLoading(false)
  }, [inspectionId])

  const fetchItems = useCallback(async () => {
    const { data, error } = await supabase.from('inspection_items')
      .select('*').eq('inspection_id', inspectionId).order('created_at')
    if (error) { setActionError(`Could not load findings: ${error.message}`); return }
    setItems((data as InspectionItem[]) ?? [])
  }, [inspectionId])

  useEffect(() => { fetchInspection(); fetchItems() }, [fetchInspection, fetchItems])

  // Sign URLs for photo paths that are missing or nearing expiry (private
  // bucket, 1hr TTL, re-signed 5min early). On failure/empty result, retry
  // once after a short delay — flaky onsite connectivity is the norm here.
  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    const stale = Array.from(new Set(items.flatMap(i => i.photo_paths)))
      .filter(p => { const e = photoUrls[p]; return !e || e.expiresAt <= now })
    if (stale.length === 0) return
    const sign = async (retry: boolean) => {
      try {
        const fresh = await signedPhotoUrls(supabase, stale)
        if (cancelled) return
        if (Object.keys(fresh).length) setPhotoUrls(prev => ({ ...prev, ...fresh }))
        else if (retry) setTimeout(() => { if (!cancelled) sign(false) }, 3000)
      } catch {
        if (retry) setTimeout(() => { if (!cancelled) sign(false) }, 3000)
      }
    }
    sign(true)
    return () => { cancelled = true }
  }, [items, signTick])

  // While the page is open, periodically re-run the signing pass so URLs
  // are refreshed before their TTL lapses mid-walk.
  useEffect(() => {
    const t = setInterval(() => setSignTick(n => n + 1), 10 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // A thumbnail/lightbox image failed to load — drop its signed URL and
  // trigger a fresh signing pass for it.
  const invalidatePhoto = useCallback((path: string) => {
    setPhotoUrls(prev => {
      const next = { ...prev }
      delete next[path]
      return next
    })
    setSignTick(n => n + 1)
  }, [])

  async function patchInspection(patch: Partial<Inspection>): Promise<boolean> {
    if (!inspection) return false
    setActionError(null)
    const { error } = await supabase.from('inspections').update(patch).eq('id', inspection.id)
    if (error) { setActionError(`Save failed: ${error.message}`); return false }
    setInspection(prev => prev ? { ...prev, ...patch } : prev)
    return true
  }

  // Rule: an existing report is invalidated by ANY change to findings or to
  // the inspection date — the stored PDF no longer reflects reality. Clear
  // the path + sent state (reverting a report_sent status) so the panel
  // returns to the fresh Generate state. Removing the orphaned PDF from
  // storage is best-effort: orphaned files are acceptable, stale sent
  // badges are not.
  const invalidateReport = useCallback(async () => {
    const insp = inspectionRef.current
    if (!insp?.report_file_path) return
    const oldPath = insp.report_file_path
    const patch: Partial<Inspection> = {
      report_file_path: null,
      report_sent_at: null,
      ...(insp.status === 'report_sent' ? { status: 'submitted' as const } : {}),
    }
    const { error } = await supabase.from('inspections').update(patch).eq('id', insp.id)
    if (error) {
      setActionError(`Change saved, but the now-outdated report could not be cleared (${error.message}) — regenerate it before sending.`)
      return
    }
    setInspection(prev => prev ? { ...prev, ...patch } : prev)
    try { await supabase.storage.from(BUCKET).remove([oldPath]) } catch { /* non-fatal */ }
  }, [])

  // ── Section instances: template + instances already on saved items ──

  // Fallback guards against an out-of-vocabulary type on a pre-existing row.
  const template = TEMPLATE_SECTIONS[inspection?.inspection_type ?? 'site_visit'] ?? TEMPLATE_SECTIONS.site_visit

  const instances = useMemo<SectionInstance[]>(
    () => buildSectionInstances(template, items), [template, items])

  const countByInstance = useMemo(() => countItemsByInstance(items), [items])

  // ── Item mutations ───────────────────────────────────────────

  async function deleteItem(item: InspectionItem) {
    if (!confirm(`Delete this finding${item.item_label ? ` ("${item.item_label}")` : ''}? Its photos will be removed too.`)) return
    setActionError(null)
    // DB row first — if this fails the finding survives intact. Storage
    // cleanup after, best-effort (orphaned files acceptable, lost rows not).
    const { error } = await supabase.from('inspection_items').delete().eq('id', item.id)
    if (error) { setActionError(`Delete failed: ${error.message}`); return }
    await removeInspectionPhotos(supabase, item.photo_paths)
    setItems(prev => prev.filter(i => i.id !== item.id))
    invalidateReport()
  }

  async function appendPhotos(item: InspectionItem, files: File[]) {
    if (!inspection || files.length === 0) return
    try {
      const paths = await uploadInspectionPhotos(supabase, inspection.property_id, inspection.id, files)
      // Re-read the item from the LATEST state — the prop may be stale if
      // another mutation resolved while the upload was in flight.
      const current = itemsRef.current.find(i => i.id === item.id) ?? item
      const { data, error } = await supabase.from('inspection_items')
        .update({ photo_paths: [...current.photo_paths, ...paths] })
        .eq('id', item.id)
        .select()
        .single()
      if (error || !data) throw new Error(error?.message ?? 'Save failed')
      const updated = data as InspectionItem
      setItems(prev => prev.map(i => i.id === updated.id ? updated : i))
      invalidateReport()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Photo upload failed — try again.')
    }
  }

  // ── Render ───────────────────────────────────────────────────

  if (loading) return <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
  if (fetchError && !inspection) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-3">
        <p className="text-sm text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={14} className="flex-shrink-0" />
          Could not load this inspection — {fetchError}
        </p>
        <button
          onClick={() => { setLoading(true); setFetchError(null); fetchInspection() }}
          className="btn-secondary">
          <RotateCcw size={14} />Retry
        </button>
        <div>
          <Link href="/inspections" className="text-sm text-blue-600 hover:underline inline-block">← Back to inspections</Link>
        </div>
      </div>
    )
  }
  if (notFound || !inspection) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-slate-500">Inspection not found.</p>
        <Link href="/inspections" className="text-sm text-blue-600 hover:underline mt-2 inline-block">← Back to inspections</Link>
      </div>
    )
  }

  const propertyName = inspection.properties?.name ?? ''
  const isDraft = inspection.status === 'draft'

  // Groups in template/instance order; only instances that actually have items.
  const groups = groupItemsByInstance(instances, items)

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4 pb-6">
      {/* Header */}
      <div className="space-y-2">
        <Link href="/inspections" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
          <ArrowLeft size={12} />All inspections
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: propertyColor(propertyName) }} />
              <h1 className="page-title truncate">{propertyName || 'Inspection'}</h1>
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                {INSPECTION_TYPE_LABELS[inspection.inspection_type] ?? inspection.inspection_type}
              </span>
              <span className={cn('badge', INSPECTION_STATUS_STYLES[inspection.status])}>
                {INSPECTION_STATUS_LABELS[inspection.status] ?? inspection.status}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1.5">
              <span>Inspected</span>
              <InlineDate value={inspection.inspection_date}
                onSave={async v => {
                  if (v && await patchInspection({ inspection_date: v })) invalidateReport()
                }} />
              <span className="text-slate-300">·</span>
              <span>{items.length} finding{items.length === 1 ? '' : 's'}</span>
              {items.some(i => i.requires_action) && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="text-amber-600 font-medium">
                    {items.filter(i => i.requires_action).length} follow-up{items.filter(i => i.requires_action).length === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </div>
          </div>
          {isDraft ? (
            <button
              onClick={() => patchInspection({ status: 'submitted' })}
              className="btn-secondary flex-shrink-0">
              <Check size={14} />Mark submitted
            </button>
          ) : (
            <button
              onClick={() => patchInspection({ status: 'draft' })}
              className="btn-secondary flex-shrink-0">
              <RotateCcw size={14} />Reopen draft
            </button>
          )}
        </div>
        <div className="text-sm text-slate-600 max-w-2xl">
          <InlineText multiline value={inspection.notes} placeholder="Add inspection notes…"
            onSave={v => { patchInspection({ notes: v || null }) }} />
        </div>
      </div>

      {/* Report: generate/view/send — only once the walk is submitted, and
          nothing is automatic; both actions are explicit buttons. */}
      {!isDraft && (
        <ReportPanel
          inspection={inspection}
          onUpdated={patch => setInspection(prev => prev ? { ...prev, ...patch } : prev)}
        />
      )}

      {/* Mutation errors surface inline — never silently pretend success */}
      {actionError && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)} aria-label="Dismiss error"
            className="text-red-400 hover:text-red-600 flex-shrink-0">
            <X size={12} />
          </button>
        </p>
      )}

      {/* Add-finding form — in normal flow right under the header, so it's
          one small scroll-to-top from anywhere. Not keyed on the selected
          section: switching sections mid-composition must never wipe pending
          photos or text. */}
      {isDraft ? (
        <AddFindingForm
          inspection={inspection}
          template={template}
          instances={instances}
          countByInstance={countByInstance}
          onSaved={saved => { setItems(prev => [...prev, saved]); invalidateReport() }}
        />
      ) : (
        <div className="card px-4 py-3 text-xs text-slate-400 flex items-center gap-2">
          <ClipboardCheck size={14} className="text-slate-300" />
          Inspection is {INSPECTION_STATUS_LABELS[inspection.status]?.toLowerCase() ?? inspection.status} — reopen the draft to add findings.
        </div>
      )}

      {/* Findings grouped by section instance, accumulating below the form */}
      {groups.length === 0 ? (
        <div className="card py-12 text-center">
          <Camera size={28} className="text-slate-200 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No findings yet</p>
          <p className="text-xs text-slate-300 mt-1">
            {isDraft ? 'Pick a section above, then snap photos as you walk' : 'Reopen the draft to add findings'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(({ inst, items: groupItems }) => (
            <div key={instanceKey(inst.name, inst.unit)}>
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{instanceLabel(inst)}</h2>
                <span className="text-xs text-slate-300">{groupItems.length}</span>
              </div>
              <div className="space-y-2">
                {groupItems.map(item => (
                  <FindingCard
                    key={item.id}
                    item={item}
                    photoUrls={photoUrls}
                    onView={setLightbox}
                    onEdit={() => setEditItem(item)}
                    onDelete={() => deleteItem(item)}
                    onAppendPhotos={files => appendPhotos(item, files)}
                    onPhotoError={invalidatePhoto}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox — keyed by storage path so a load failure can re-sign */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white" aria-label="Close photo">
            <X size={22} />
          </button>
          {photoUrls[lightbox] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrls[lightbox].url} alt="Inspection photo"
              onError={() => invalidatePhoto(lightbox)}
              className="max-h-full max-w-full rounded-lg object-contain" />
          ) : (
            <div className="w-64 h-64 rounded-lg bg-white/10 animate-pulse" />
          )}
        </div>
      )}

      {/* Edit finding modal */}
      {editItem && (
        <EditFindingModal
          item={editItem}
          instances={instances}
          onClose={() => setEditItem(null)}
          onSaved={updated => {
            setEditItem(null)
            setItems(prev => prev.map(i => i.id === updated.id ? updated : i))
            invalidateReport()
          }}
        />
      )}
    </div>
  )
}

// ── Report panel ─────────────────────────────────────────────
// Generate (or regenerate) the PDF report, open it via a signed URL, and
// email it to the PM. Everything is an explicit button — no auto-sends.

function ReportPanel({ inspection, onUpdated }: {
  inspection: InspectionDetail
  onUpdated: (patch: Partial<Inspection>) => void
}) {
  const supabase = createClient()
  const [generating, setGenerating] = useState(false)
  const [opening, setOpening] = useState(false)
  const [showSend, setShowSend] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasReport = !!inspection.report_file_path

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/inspections/${inspection.id}/report`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) throw new Error(json.error ?? `Report generation failed (${res.status})`)
      // Mirror the server: a freshly generated PDF has by definition not
      // been sent, so the sent marker clears alongside the new path.
      onUpdated({ report_file_path: json.path, report_sent_at: null })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Report generation failed — try again.')
    } finally {
      setGenerating(false)
    }
  }

  async function viewPdf() {
    if (!inspection.report_file_path) return
    setOpening(true)
    setError(null)
    const { data, error: signError } = await supabase.storage
      .from(BUCKET).createSignedUrl(inspection.report_file_path, 3600)
    setOpening(false)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else setError(`Could not open the report${signError ? ` — ${signError.message}` : ''}`)
  }

  return (
    <div className="card px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
          <FileText size={13} className="text-blue-600" />Report
        </span>
        {/* Invalidation + regeneration both clear report_sent_at, so this
            only ever describes the PDF currently behind "View PDF". */}
        {hasReport && inspection.report_sent_at && (
          <span className="text-xs text-slate-400">
            Sent to PM {formatDate(inspection.report_sent_at)}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <button onClick={generate} disabled={generating} className="btn-secondary">
            <FileText size={14} />
            {generating ? 'Generating…' : hasReport ? 'Regenerate report' : 'Generate report'}
          </button>
          {hasReport && (
            <>
              <button onClick={viewPdf} disabled={opening} className="btn-secondary">
                <ExternalLink size={14} />{opening ? 'Opening…' : 'View PDF'}
              </button>
              <button onClick={() => setShowSend(true)} className="btn-primary">
                <Send size={14} />Send to PM
              </button>
            </>
          )}
        </div>
      </div>
      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0" />{error}
        </p>
      )}
      {showSend && (
        <SendReportModal
          inspection={inspection}
          onClose={() => setShowSend(false)}
          onSent={patch => { setShowSend(false); onUpdated(patch) }}
        />
      )}
    </div>
  )
}

// ── Send-to-PM modal ─────────────────────────────────────────
// Pre-fills the property's PMC primary contact; PMC-linked contacts with
// emails surface as one-tap add chips. Recipients stay fully editable
// (comma-separated) — the server only falls back to the PMC contact when
// the list is empty.

function SendReportModal({ inspection, onClose, onSent }: {
  inspection: InspectionDetail
  onClose: () => void
  onSent: (patch: Partial<Inspection>) => void
}) {
  const supabase = createClient()
  const [to, setTo] = useState('')
  const [candidates, setCandidates] = useState<{ name: string; email: string }[]>([])
  const [loadingRecipients, setLoadingRecipients] = useState(true)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('properties')
        .select('pmc_id, pmcs(primary_contact_name, primary_contact_email)')
        .eq('id', inspection.property_id).single()
      if (cancelled) return
      const prop = data as unknown as {
        pmc_id: string | null
        pmcs: { primary_contact_name: string | null; primary_contact_email: string | null } | null
      } | null
      const primaryEmail = prop?.pmcs?.primary_contact_email ?? null
      if (primaryEmail) setTo(primaryEmail)
      if (prop?.pmc_id) {
        const { data: contacts } = await supabase.from('contacts')
          .select('full_name, email').eq('pmc_id', prop.pmc_id).not('email', 'is', null).order('full_name')
        if (!cancelled) {
          setCandidates((contacts ?? [])
            .filter(c => c.email && c.email !== primaryEmail)
            .map(c => ({ name: c.full_name, email: c.email as string })))
        }
      }
      if (!cancelled) setLoadingRecipients(false)
    })()
    return () => { cancelled = true }
  }, [inspection.property_id])

  const recipients = to.split(',').map(s => s.trim()).filter(Boolean)

  function addCandidate(email: string) {
    if (recipients.includes(email)) return
    setTo(prev => prev.trim() ? `${prev.trim().replace(/,\s*$/, '')}, ${email}` : email)
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (recipients.length === 0) { setError('Add at least one recipient.'); return }
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/inspections/${inspection.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipients, message: message.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) throw new Error(json.error ?? `Send failed (${res.status})`)
      onSent({ status: 'report_sent', report_sent_at: json.sent_at ?? new Date().toISOString() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed — check connection and try again.')
      setSending(false)
    }
  }

  return (
    <Modal title="Send Report to PM" onClose={onClose} maxWidth="md">
      <form onSubmit={send} className="px-6 py-5 space-y-4">
        <div>
          <label className="label">To (comma-separated)</label>
          <input
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder={loadingRecipients ? 'Loading PMC contact…' : 'pm@example.com'}
            className="input"
          />
          {candidates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {candidates.map(c => (
                <button key={c.email} type="button" onClick={() => addCandidate(c.email)}
                  disabled={recipients.includes(c.email)}
                  className={cn(
                    'text-xs border rounded-full px-2.5 py-1 transition-colors',
                    recipients.includes(c.email)
                      ? 'border-slate-100 text-slate-300'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  )}>
                  + {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="label">Message (optional)</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)}
            className="input min-h-[70px] resize-none"
            placeholder="Short note to include above the summary…" />
        </div>
        <p className="text-xs text-slate-400">
          Sends the generated PDF as an attachment with a short summary (score, findings, action items).
        </p>
        {error && (
          <p className="text-xs text-red-600 flex items-center gap-1.5">
            <AlertTriangle size={12} className="flex-shrink-0" />{error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={sending || recipients.length === 0} className="btn-primary">
            <Send size={14} />{sending ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Finding card ─────────────────────────────────────────────

function FindingCard({ item, photoUrls, onView, onEdit, onDelete, onAppendPhotos, onPhotoError }: {
  item: InspectionItem
  photoUrls: Record<string, SignedPhotoUrl>
  onView: (path: string) => void
  onEdit: () => void
  onDelete: () => void
  onAppendPhotos: (files: File[]) => Promise<void>
  onPhotoError: (path: string) => void
}) {
  const [uploading, setUploading] = useState(false)

  async function handleAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setUploading(true)
    await onAppendPhotos(files)
    setUploading(false)
  }

  return (
    <div className="card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm', item.item_label ? 'text-slate-800' : 'text-slate-300 italic')}>
            {item.item_label || 'No description'}
          </p>
          {item.requires_action && (
            <span className={cn('badge mt-1.5', PRIORITY_STYLES[item.action_priority ?? 'medium'] ?? 'text-slate-600 bg-slate-100 border-slate-200')}>
              <Flag size={9} className="mr-1" />
              Follow up{item.action_priority ? ` · ${PRIORITY_LABELS[item.action_priority as ActionPriority] ?? item.action_priority}` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={onEdit} title="Edit finding" className="text-slate-300 hover:text-blue-500 p-1.5">
            <Pencil size={14} />
          </button>
          <button onClick={onDelete} title="Delete finding" className="text-slate-300 hover:text-red-400 p-1.5">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 mt-2 flex-wrap">
          {item.photo_paths.map(path => {
            const signed = photoUrls[path]
            return signed ? (
              <button key={path} onClick={() => onView(path)} className="block" title="View full size">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={signed.url} alt="Finding photo"
                  onError={() => onPhotoError(path)}
                  className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-lg border border-slate-200" />
              </button>
            ) : (
              <div key={path} className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-slate-100 animate-pulse" />
            )
          })}
          <label
            title="Add photos to this finding"
            className={cn(
              'w-16 h-16 sm:w-20 sm:h-20 rounded-lg border border-dashed border-slate-200 flex items-center justify-center cursor-pointer text-slate-300 hover:text-blue-500 hover:border-blue-300 transition-colors',
              uploading && 'opacity-50 pointer-events-none'
            )}>
            {uploading ? <span className="text-xs">…</span> : <ImagePlus size={16} />}
            <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={handleAdd} />
          </label>
      </div>
    </div>
  )
}

// ── Add-finding form ─────────────────────────────────────────
// Each finding saves independently (autosave per item); on failure the
// form stays populated so nothing captured onsite is lost.
//
// The section instance a new finding lands on is chosen here: a native
// <select> (iOS gives it the wheel/sheet picker — ideal one-handed onsite)
// lists template sections plus instances already on saved items, and a
// unit-number input appears for duplicable sections. Section + unit
// together define the instance, exactly like the old chips did.

function AddFindingForm({ inspection, template, instances, countByInstance, onSaved }: {
  inspection: Inspection
  template: TemplateSection[]
  instances: SectionInstance[]
  countByInstance: Record<string, number>
  onSaved: (item: InspectionItem) => void
}) {
  const supabase = createClient()
  const [sectionName, setSectionName] = useState('')
  const [unitNumber, setUnitNumber] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [followUp, setFollowUp] = useState(false)
  const [priority, setPriority] = useState<ActionPriority>('medium')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const duplicable = template.some(s => s.name === sectionName && s.duplicable)
  // The instance the new finding saves to. For non-duplicable sections the
  // unit box is hidden, but a unit picked via an existing-instance option
  // (off-template legacy data) still carries through unitNumber.
  const active: SectionInstance | null = sectionName
    ? { name: sectionName, unit: unitNumber.trim() || null }
    : null

  const optionKeys = useMemo(() => new Set(instances.map(i => instanceKey(i.name, i.unit))), [instances])
  // Keep the <select> honest when the typed unit doesn't match an existing
  // instance option: fall back to the base section option.
  const activeKey = active ? instanceKey(active.name, active.unit) : ''
  const selectValue = activeKey && optionKeys.has(activeKey)
    ? activeKey
    : sectionName && optionKeys.has(instanceKey(sectionName, null))
      ? instanceKey(sectionName, null)
      : activeKey

  function pickSection(key: string) {
    if (!key) { setSectionName(''); setUnitNumber(''); return }
    const inst = instances.find(i => instanceKey(i.name, i.unit) === key)
    if (!inst) return
    // Picking "Vacant Unit · 204" prefills the unit box; picking the base
    // section clears it so the next unit number starts fresh.
    setSectionName(inst.name)
    setUnitNumber(inst.unit ?? '')
  }

  // Revoke any leftover object URLs on unmount only — pending previews are
  // revoked individually as they're removed or saved.
  const previewsRef = useRef<string[]>([])
  useEffect(() => { previewsRef.current = previews }, [previews])
  useEffect(() => () => {
    previewsRef.current.forEach(URL.revokeObjectURL)
    if (savedTimer.current) clearTimeout(savedTimer.current)
  }, [])

  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return
    setFiles(f => [...f, ...picked])
    setPreviews(p => [...p, ...picked.map(f => URL.createObjectURL(f))])
  }

  function removeFile(index: number) {
    URL.revokeObjectURL(previews[index])
    setFiles(f => f.filter((_, i) => i !== index))
    setPreviews(p => p.filter((_, i) => i !== index))
  }

  const canSave = active != null && (files.length > 0 || description.trim().length > 0)

  async function save() {
    if (!canSave || !active || state === 'saving') return
    setState('saving')
    setError(null)
    try {
      const paths = files.length > 0
        ? await uploadInspectionPhotos(supabase, inspection.property_id, inspection.id, files)
        : []
      const { data, error: insertError } = await supabase.from('inspection_items').insert({
        inspection_id: inspection.id,
        section_name: active.name,
        unit_number: active.unit,
        item_label: description.trim(),
        requires_action: followUp,
        action_priority: followUp ? priority : null,
        photo_paths: paths,
      }).select().single()
      if (insertError || !data) throw new Error(insertError?.message ?? 'Save failed')

      // Saved — reset for the next finding.
      previews.forEach(URL.revokeObjectURL)
      setFiles([])
      setPreviews([])
      setDescription('')
      setFollowUp(false)
      setPriority('medium')
      setState('saved')
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setState(s => s === 'saved' ? 'idle' : s), 2500)
      onSaved(data as InspectionItem)
    } catch (e) {
      // Keep the form populated — nothing captured is lost.
      setState('error')
      setError(e instanceof Error ? e.message : 'Save failed — check connection and try again.')
    }
  }

  return (
    <div className="card shadow-sm px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">New finding</span>
        {state === 'saved' && (
          <span className="text-xs text-emerald-600 flex items-center gap-1 font-medium">
            <Check size={12} />Saved
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <select
          value={selectValue}
          onChange={e => pickSection(e.target.value)}
          aria-label="Section"
          className="input min-h-[42px] min-w-0 flex-1">
          <option value="" disabled>Section…</option>
          {instances.map(inst => {
            const key = instanceKey(inst.name, inst.unit)
            const count = countByInstance[key] ?? 0
            return (
              <option key={key} value={key}>
                {instanceLabel(inst)}{count > 0 ? ` (${count})` : ''}
              </option>
            )
          })}
        </select>
        {duplicable && (
          <input
            value={unitNumber}
            onChange={e => setUnitNumber(e.target.value)}
            placeholder="Unit #"
            aria-label="Unit number"
            inputMode="numeric"
            className="input min-h-[42px] w-24 flex-shrink-0"
          />
        )}
      </div>

      {previews.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {previews.map((url, i) => (
            <div key={url} className="relative flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Pending photo ${i + 1}`}
                className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
              <button onClick={() => removeFile(i)} aria-label="Remove photo"
                className="absolute -top-1.5 -right-1.5 bg-slate-700 text-white rounded-full p-0.5 hover:bg-red-500">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <label className={cn(
          'flex items-center justify-center gap-1.5 border border-slate-200 rounded-lg px-3 min-h-[42px] text-sm font-medium cursor-pointer flex-shrink-0 transition-colors',
          'text-slate-600 hover:bg-slate-50 active:bg-slate-100'
        )}>
          <Camera size={16} className="text-blue-600" />
          <span>Photos</span>
          {files.length > 0 && <span className="text-xs text-blue-600 font-semibold">{files.length}</span>}
          <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={addFiles} />
        </label>
        <input
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
          placeholder="Short description…"
          className="input min-h-[42px]"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setFollowUp(f => !f)}
          className={cn(
            'flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            followUp
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-slate-200 text-slate-500 hover:bg-slate-50'
          )}>
          <Flag size={13} />Follow up
        </button>
        {followUp && (
          <select value={priority} onChange={e => setPriority(e.target.value as ActionPriority)}
            className="input-sm w-auto py-2 text-sm" aria-label="Follow-up priority">
            {ACTION_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        )}
        <button
          onClick={save}
          disabled={!canSave || state === 'saving'}
          className="btn-primary ml-auto min-h-[42px] px-6">
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>

      {state === 'error' && error && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0" />
          {error} — your photos and notes are still here, tap Save to retry.
        </p>
      )}
    </div>
  )
}

// ── Edit finding modal ───────────────────────────────────────

function EditFindingModal({ item, instances, onClose, onSaved }: {
  item: InspectionItem
  instances: SectionInstance[]
  onClose: () => void
  onSaved: (item: InspectionItem) => void
}) {
  const supabase = createClient()
  const sectionNames = Array.from(new Set(instances.map(i => i.name)))
  const [description, setDescription] = useState(item.item_label)
  const [sectionName, setSectionName] = useState(item.section_name)
  const [unitNumber, setUnitNumber] = useState(item.unit_number ?? '')
  const [followUp, setFollowUp] = useState(item.requires_action)
  const [priority, setPriority] = useState<ActionPriority>(
    (ACTION_PRIORITIES as readonly string[]).includes(item.action_priority ?? '')
      ? item.action_priority as ActionPriority
      : 'medium')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { data, error: updateError } = await supabase.from('inspection_items').update({
      item_label: description.trim(),
      section_name: sectionName,
      unit_number: unitNumber.trim() || null,
      requires_action: followUp,
      action_priority: followUp ? priority : null,
    }).eq('id', item.id).select().single()
    if (updateError || !data) {
      setError(updateError?.message ?? 'Save failed')
      setSaving(false)
      return
    }
    onSaved(data as InspectionItem)
  }

  return (
    <Modal title="Edit Finding" onClose={onClose} maxWidth="md">
      <form onSubmit={save} className="px-6 py-5 space-y-4">
        <div>
          <label className="label">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            className="input min-h-[70px] resize-none" placeholder="What did you find?" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Section</label>
            <select value={sectionName} onChange={e => setSectionName(e.target.value)} className="input">
              {!sectionNames.includes(sectionName) && <option value={sectionName}>{sectionName}</option>}
              {sectionNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Unit #</label>
            <input value={unitNumber} onChange={e => setUnitNumber(e.target.value)}
              className="input" placeholder="e.g. 204" />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setFollowUp(f => !f)}
            className={cn(
              'flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              followUp
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            )}>
            <Flag size={13} />Follow up
          </button>
          {followUp && (
            <select value={priority} onChange={e => setPriority(e.target.value as ActionPriority)}
              className="input-sm w-auto py-2 text-sm" aria-label="Follow-up priority">
              {ACTION_PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </select>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
