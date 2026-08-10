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
  ACTION_PRIORITIES, PRIORITY_LABELS, type ActionPriority, type TemplateSection,
} from '@/lib/inspections/templates'
import { signedPhotoUrls, removeInspectionPhotos, signedFileUrl, type SignedPhotoUrl } from '@/lib/inspections/photos'
import { invalidateInspectionReports } from '@/lib/inspections/invalidate'
import { compressImage } from '@/lib/inspections/compress'
import {
  enqueueInspectionPhotos, cancelItemUploads, resumePendingUploads,
  subscribeUploadQueue, retryUpload, type UploadEntrySnapshot,
} from '@/lib/inspections/upload-queue'
import { withTimeoutRetry, randomUuid } from '@/lib/utils/retry'
import {
  instanceKey, instanceLabel, buildSectionInstances, countItemsByInstance,
  groupItemsByInstance, type SectionInstance,
} from '@/lib/inspections/sections'
import {
  DISPOSITIONS, DISPOSITION_LABELS, isSettled, normalizeDisposition, type Disposition,
} from '@/lib/inspections/dispositions'
import { DispositionChip } from '@/components/inspections/disposition-chip'
import { Modal } from '@/components/ui/modal'
import { InlineText, InlineDate } from '@/components/ui/inline-edit'
import { toast } from '@/components/ui/toast'
import { isOverlayOpen } from '@/lib/ui/overlay'
import { findingTaskInsertPayload, insertTask } from '@/lib/tasks/create'
import {
  ArrowLeft, Camera, X, Flag, Trash2, Pencil,
  ImagePlus, Check, AlertTriangle, ClipboardCheck, RotateCcw,
  FileText, Mail, ExternalLink, ListTodo, CheckSquare, UploadCloud,
  Copy, Eye, HardHat, Keyboard,
} from 'lucide-react'

type InspectionDetail = Inspection & { properties: { name: string } | null }

// A prior inspection's watch-listed finding, with its walk date embedded.
type WatchRow = InspectionItem & { inspections: { property_id: string; inspection_date: string } }

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
  // Signed-in user — stamped onto tasks spawned from findings
  const [userId, setUserId] = useState<string | null>(null)
  // Finding id with a task creation in flight (disables its button)
  const [creatingTaskFor, setCreatingTaskFor] = useState<string | null>(null)
  // Findings left with an orphaned task: the link write failed AND the
  // compensating delete failed, so a real (unlinked) task exists in
  // Tasks. Retrying create would duplicate it — the button stays
  // disabled for these items this session.
  const [orphanedTaskItems, setOrphanedTaskItems] = useState<Set<string>>(new Set())
  // Finding currently in the capex attach/create mini-modal (triage `b`)
  const [capexItem, setCapexItem] = useState<InspectionItem | null>(null)
  // capex project id → title, for the CapEx chips on findings
  const [capexNames, setCapexNames] = useState<Record<string, string>>({})

  useEffect(() => {
    // getSession reads the local session — no network round-trip.
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Latest inspection, readable from async closures — invalidateReport runs after
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

  // ── Watch loop ───────────────────────────────────────────────
  // While capturing (draft), prior inspections' 'watch' findings on this
  // property surface at the top of the screen: re-confirm ("Still an
  // issue" — clones into THIS inspection and re-enters triage), verify
  // resolved, or skip for next time. Deliberately mobile-friendly — this
  // is an onsite ritual, unlike the desk-only triage sweep.
  const [watchItems, setWatchItems] = useState<WatchRow[]>([])

  const propertyId = inspection?.property_id
  const isDraftStatus = inspection?.status === 'draft'
  useEffect(() => {
    if (!propertyId || !isDraftStatus) { setWatchItems([]); return }
    let cancelled = false
    supabase.from('inspection_items')
      .select('*, inspections!inner(property_id, inspection_date)')
      .eq('inspections.property_id', propertyId)
      .neq('inspection_id', inspectionId)
      .eq('disposition', 'watch')
      .order('created_at')
      .then(({ data, error }) => {
        if (cancelled) return
        // Non-fatal: the walk works without the watch list.
        if (error) { console.warn('Could not load the watch list:', error.message); return }
        setWatchItems((data ?? []) as unknown as WatchRow[])
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, isDraftStatus, inspectionId])

  // Sign URLs for photo paths that are missing or nearing expiry (private
  // bucket, 1hr TTL, re-signed 5min early). On failure/empty result, retry
  // once after a short delay — flaky onsite connectivity is the norm here.
  // Watch-list rows sign their first photo alongside the findings' own.
  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    const stale = Array.from(new Set([
      ...items.flatMap(i => i.photo_paths),
      ...watchItems.map(w => w.photo_paths[0]).filter((p): p is string => !!p),
    ]))
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
  }, [items, watchItems, signTick])

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

  // Stall-protected (10s timeout + retry): a hung request in the field
  // surfaces as a quick "retrying" toast, never an indefinite spinner.
  // Safe to retry — the patch payload is fixed, so a duplicate is a no-op.
  async function patchInspection(patch: Partial<Inspection>): Promise<boolean> {
    if (!inspection) return false
    setActionError(null)
    try {
      await withTimeoutRetry(async signal => {
        const { error } = await supabase.from('inspections')
          .update(patch).eq('id', inspection.id).abortSignal(signal)
        if (error) throw new Error(error.message)
      }, { onRetry: retryIndex => { if (retryIndex === 1) toast('Slow connection — retrying save…') } })
    } catch (e) {
      setActionError(`Save failed: ${e instanceof Error ? e.message : 'check connection and try again.'}`)
      return false
    }
    setInspection(prev => prev ? { ...prev, ...patch } : prev)
    return true
  }

  // Rule: an existing report is invalidated by ANY change to findings or to
  // the inspection date — the stored PDF no longer reflects reality. The
  // shared helper (lib/inspections/invalidate) clears the path + sent
  // state (reverting a report_sent status) so the panel returns to the
  // fresh Generate state; this wrapper mirrors the change into local
  // state and surfaces a failure on the page banner.
  const invalidateReport = useCallback(async () => {
    const insp = inspectionRef.current
    if (!insp?.report_file_path) return
    const { failed } = await invalidateInspectionReports(supabase, [insp.id])
    if (failed.length > 0) {
      setActionError('Change saved, but the now-outdated report could not be cleared — regenerate it before emailing the PM.')
      return
    }
    const patch: Partial<Inspection> = {
      report_file_path: null,
      report_sent_at: null,
      ...(insp.status === 'report_sent' ? { status: 'submitted' as const } : {}),
    }
    setInspection(prev => prev ? { ...prev, ...patch } : prev)
  }, [])

  // ── Background photo uploads ─────────────────────────────────
  // Photos upload through the background queue (lib/inspections/upload-queue)
  // so saving a finding never waits on the network for photos. The queue
  // feeds two things back: per-entry status (for thumbnails + the global
  // pill) and photo_paths appends as uploads land. Local object URLs keep
  // showing a just-uploaded photo until its signed URL exists.
  const [uploads, setUploads] = useState<UploadEntrySnapshot[]>([])
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({})
  const localPreviewsRef = useRef<Record<string, string>>({})
  useEffect(() => { localPreviewsRef.current = localPreviews }, [localPreviews])

  useEffect(() => {
    const unsubscribe = subscribeUploadQueue({
      onChange: setUploads,
      onPathsUpdated: update => {
        // The queue also resumes other inspections' pending photos — their
        // previews are ours to release, nothing else to do.
        if (update.inspectionId !== inspectionId) { URL.revokeObjectURL(update.previewUrl); return }
        setItems(prev => prev.map(i => i.id === update.itemId ? { ...i, photo_paths: update.photoPaths } : i))
        setLocalPreviews(prev => ({ ...prev, [update.uploadedPath]: update.previewUrl }))
        // A photo landing is a change to report content like any other.
        invalidateReport()
      },
    })
    resumePendingUploads()
    return () => {
      unsubscribe()
      Object.values(localPreviewsRef.current).forEach(URL.revokeObjectURL)
    }
  }, [inspectionId, invalidateReport])

  // Once a path has a live signed URL its local preview is redundant —
  // release the blob memory (a long walk can queue dozens of photos).
  useEffect(() => {
    setLocalPreviews(prev => {
      const stale = Object.keys(prev).filter(p => photoUrls[p])
      if (stale.length === 0) return prev
      const next = { ...prev }
      for (const p of stale) { URL.revokeObjectURL(prev[p]); delete next[p] }
      return next
    })
  }, [photoUrls])

  // This inspection's queue entries, grouped for the finding cards.
  const inspectionUploads = useMemo(
    () => uploads.filter(u => u.inspectionId === inspectionId), [uploads, inspectionId])
  const uploadsByItem = useMemo(() => {
    const map: Record<string, UploadEntrySnapshot[]> = {}
    for (const u of inspectionUploads) (map[u.itemId] ??= []).push(u)
    return map
  }, [inspectionUploads])
  const failedUploadCount = inspectionUploads.filter(u => u.status === 'failed').length

  // ── Section instances: template + instances already on saved items ──

  // Fallback guards against an out-of-vocabulary type on a pre-existing row.
  const template = TEMPLATE_SECTIONS[inspection?.inspection_type ?? 'site_visit'] ?? TEMPLATE_SECTIONS.site_visit

  const instances = useMemo<SectionInstance[]>(
    () => buildSectionInstances(template, items), [template, items])

  const countByInstance = useMemo(() => countItemsByInstance(items), [items])

  // ── Dispositions (triage) ────────────────────────────────────

  // CapEx chips show the linked project's name — resolve titles for any
  // linked ids we haven't seen yet (best-effort; the chip renders bare
  // "CapEx" until the title lands).
  useEffect(() => {
    const missing = Array.from(new Set(
      items.map(i => i.capex_project_id).filter((id): id is string => !!id)
    )).filter(id => !(id in capexNames))
    if (missing.length === 0) return
    let cancelled = false
    supabase.from('capex_projects').select('id, title').in('id', missing)
      .then(({ data }) => {
        if (cancelled || !data?.length) return
        setCapexNames(prev => {
          const next = { ...prev }
          for (const p of data) next[p.id] = p.title
          return next
        })
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // One write path for every triage verb: optimistic, stamps
  // disposition_at, undo toast restoring the exact prior values. The score
  // and the report email both read dispositions, so any change invalidates
  // a stored report. Findings are never hidden by a disposition — this
  // only changes how the risk is accounted for.
  async function applyDisposition(
    item: InspectionItem,
    disposition: Disposition,
    note: string | null = null,
    opts?: { capexProjectId?: string | null; toastMessage?: string },
  ): Promise<boolean> {
    const prior = {
      disposition: item.disposition,
      disposition_note: item.disposition_note,
      disposition_at: item.disposition_at,
      capex_project_id: item.capex_project_id,
    }
    const patch = {
      disposition,
      disposition_note: note,
      disposition_at: new Date().toISOString(),
      capex_project_id: opts?.capexProjectId !== undefined ? opts.capexProjectId : item.capex_project_id,
    }
    const applyLocal = (fields: Partial<InspectionItem>) =>
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...fields } : i))
    setActionError(null)
    applyLocal(patch)
    const { error } = await supabase.from('inspection_items').update(patch).eq('id', item.id)
    if (error) {
      applyLocal(prior)
      toast(`Could not save — ${error.message}`, { tone: 'error' })
      return false
    }
    invalidateReport()
    toast(opts?.toastMessage ?? `Marked ${DISPOSITION_LABELS[disposition].toLowerCase()}`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          applyLocal(prior)
          const { error: undoError } = await supabase.from('inspection_items')
            .update(prior).eq('id', item.id)
          if (undoError) {
            applyLocal(patch)
            toast('Could not undo', { tone: 'error' })
            return
          }
          invalidateReport()
        },
      },
    })
    return true
  }

  // "Mark as sent" side-effect: flagged findings in the emailed report
  // are now COMMUNICATED — stamp communicated_at on every currently-
  // flagged item. Prior values are captured so "Mark not sent" can walk
  // back exactly the stamps this session set (a reload forfeits the
  // capture — best-effort by design; stamping never blocks the status
  // flip either way).
  const commStampPriorsRef = useRef<Record<string, string | null> | null>(null)

  async function stampFlaggedCommunicated() {
    const flagged = items.filter(i => normalizeDisposition(i.disposition) === 'flagged')
    if (flagged.length === 0) return
    const now = new Date().toISOString()
    const priors = Object.fromEntries(flagged.map(i => [i.id, i.communicated_at]))
    const { error } = await supabase.from('inspection_items')
      .update({ communicated_at: now })
      .eq('inspection_id', inspectionId)
      .eq('disposition', 'flagged')
    if (error) {
      console.warn('Could not stamp communicated_at on flagged findings:', error.message)
      return
    }
    commStampPriorsRef.current = priors
    setItems(prev => prev.map(i =>
      normalizeDisposition(i.disposition) === 'flagged' ? { ...i, communicated_at: now } : i))
  }

  async function unstampFlaggedCommunicated() {
    const priors = commStampPriorsRef.current
    if (!priors) return
    commStampPriorsRef.current = null
    // Values differ per item — restore row by row, best-effort.
    const results = await Promise.all(Object.entries(priors).map(([id, prior]) =>
      supabase.from('inspection_items').update({ communicated_at: prior }).eq('id', id)))
    if (results.some(r => r.error)) console.warn('Could not fully revert communicated stamps')
    setItems(prev => prev.map(i =>
      i.id in priors ? { ...i, communicated_at: priors[i.id] } : i))
  }

  // Triage `b`: the capex modal resolved a project (existing or freshly
  // created) — link the finding and disposition it.
  async function attachCapex(item: InspectionItem, projectId: string, projectTitle: string) {
    setCapexNames(prev => ({ ...prev, [projectId]: projectTitle }))
    setCapexItem(null)
    await applyDisposition(item, 'capex', null, {
      capexProjectId: projectId,
      toastMessage: `Linked to CapEx — ${projectTitle}`,
    })
  }

  // "Still an issue": clone the watched finding into THIS inspection —
  // same section/description/priority, no photos (fresh ones get snapped
  // onsite), carried_from_item_id pointing home, watch_count incremented,
  // disposition 'open' so it re-enters triage. The original resolves with
  // a carried-forward note. 3+ carries escalates: deferred decisions get
  // priority high forced on.
  async function carryWatchItem(w: WatchRow): Promise<void> {
    if (!inspection) return
    const newCount = (w.watch_count ?? 0) + 1
    const escalate = newCount >= 3
    const { data, error } = await supabase.from('inspection_items').insert({
      id: randomUuid(),
      inspection_id: inspection.id,
      section_name: w.section_name,
      unit_number: w.unit_number,
      item_label: w.item_label,
      requires_action: escalate ? true : w.requires_action,
      action_priority: escalate ? 'high' : w.action_priority,
      photo_paths: [],
      disposition: 'open',
      carried_from_item_id: w.id,
      watch_count: newCount,
    }).select().single()
    if (error || !data) {
      toast(`Could not carry the finding forward — ${error?.message ?? 'try again'}`, { tone: 'error' })
      return
    }
    // The original leaves the watch loop as resolved-by-carry. A failure
    // here is surfaced but doesn't undo the clone — worst case the item
    // shows on the next walk's list once more.
    const { error: oldError } = await supabase.from('inspection_items').update({
      disposition: 'resolved',
      disposition_note: `Carried forward to ${formatDate(inspection.inspection_date)} inspection`,
      disposition_at: new Date().toISOString(),
    }).eq('id', w.id)
    if (oldError) {
      toast(`Carried forward, but the original could not be marked resolved — ${oldError.message}`, { tone: 'error' })
    } else {
      // The ORIGINAL finding just changed — the PRIOR inspection's stored
      // report (if any) no longer reflects reality.
      void invalidateInspectionReports(supabase, [w.inspection_id])
    }
    setItems(prev => [...prev, data as InspectionItem])
    setWatchItems(prev => prev.filter(x => x.id !== w.id))
    invalidateReport()
    toast(escalate
      ? `Carried into this inspection — watched ${newCount} visits, priority raised to high`
      : 'Carried into this inspection — it will re-enter triage')
  }

  // "Resolved": the watched issue is verified gone onsite.
  async function resolveWatchItem(w: WatchRow): Promise<void> {
    if (!inspection) return
    const prior = {
      disposition: w.disposition,
      disposition_note: w.disposition_note,
      disposition_at: w.disposition_at,
    }
    const { error } = await supabase.from('inspection_items').update({
      disposition: 'resolved',
      disposition_note: `Verified resolved onsite ${formatDate(inspection.inspection_date)}`,
      disposition_at: new Date().toISOString(),
    }).eq('id', w.id)
    if (error) {
      toast(`Could not mark resolved — ${error.message}`, { tone: 'error' })
      return
    }
    // The finding lives in a PRIOR inspection — its stored report (if
    // any) is stale now.
    void invalidateInspectionReports(supabase, [w.inspection_id])
    setWatchItems(prev => prev.filter(x => x.id !== w.id))
    toast('Verified resolved', {
      action: {
        label: 'Undo',
        onClick: async () => {
          const { error: undoError } = await supabase.from('inspection_items')
            .update(prior).eq('id', w.id)
          if (undoError) { toast('Could not undo', { tone: 'error' }); return }
          void invalidateInspectionReports(supabase, [w.inspection_id])
          setWatchItems(prev => [...prev, { ...w, ...prior }])
        },
      },
    })
  }

  // ── Item mutations ───────────────────────────────────────────

  async function deleteItem(item: InspectionItem) {
    if (!confirm(`Delete this finding${item.item_label ? ` ("${item.item_label}")` : ''}? Its photos will be removed too.`)) return
    setActionError(null)
    // DB row first — if this fails the finding survives intact. Storage
    // cleanup after, best-effort (orphaned files acceptable, lost rows not).
    const { error } = await supabase.from('inspection_items').delete().eq('id', item.id)
    if (error) { setActionError(`Delete failed: ${error.message}`); return }
    // Pending/in-flight photo uploads for this finding are now pointless —
    // cancel them (the queue best-effort removes anything already landed).
    cancelItemUploads(item.id)
    await removeInspectionPhotos(supabase, item.photo_paths)
    setItems(prev => prev.filter(i => i.id !== item.id))
    invalidateReport()
  }

  // One-tap task from a finding (card icon button, edit modal, triage
  // `t`). The task is created via the shared creation layer, then the
  // finding is linked through inspection_items.task_id AND dispositioned
  // 'task' — the task is its triage outcome. If the link write fails
  // the task is removed again — a spawned task the finding doesn't
  // know about would allow silent duplicates (and if even that delete
  // fails, the item is flagged so retrying can't duplicate). Undo
  // deletes the task, clears the link and restores the prior
  // disposition. Dispositions feed the score/report, so linking also
  // invalidates a stored report.
  async function createTaskFromItem(item: InspectionItem) {
    if (!inspection || item.task_id || creatingTaskFor || orphanedTaskItems.has(item.id)) return
    // Failures surface as a toast (visible above the edit modal's
    // overlay — this can be triggered from inside it) AND the page
    // banner (persists after the toast fades).
    const fail = (msg: string) => {
      setCreatingTaskFor(null)
      setActionError(msg)
      toast(msg, { tone: 'error' })
    }
    if (!userId) { fail('Sign in to create tasks from findings.'); return }
    setActionError(null)
    setCreatingTaskFor(item.id)
    const section = instanceLabel({ name: item.section_name, unit: item.unit_number })
    const created = await insertTask(supabase, findingTaskInsertPayload({
      title: item.item_label.trim() || `Inspection finding — ${section}`,
      propertyId: inspection.property_id,
      actionPriority: item.action_priority,
      sourceNote: `From inspection finding — ${section} · ${formatDate(inspection.inspection_date)}`,
      userId,
    }))
    if (!created) {
      fail('Could not create the task — check connection and try again.')
      return
    }
    const priorDisposition = {
      disposition: item.disposition,
      disposition_note: item.disposition_note,
      disposition_at: item.disposition_at,
    }
    const linkPatch = {
      task_id: created.id,
      disposition: 'task' as const,
      disposition_note: null,
      disposition_at: new Date().toISOString(),
    }
    const { error: linkError } = await supabase.from('inspection_items')
      .update(linkPatch).eq('id', item.id)
    if (linkError) {
      // Compensate: remove the task the finding doesn't know about. If
      // THAT also fails, an unlinked task really exists — saying
      // "retry" would invite a duplicate, so flag the item and keep
      // its button disabled for this session.
      const { error: deleteError } = await supabase.from('tasks').delete().eq('id', created.id)
      if (deleteError) {
        setOrphanedTaskItems(prev => new Set(prev).add(item.id))
        fail('Task created but couldn’t be linked to this finding — it exists in Tasks; delete it there, or link it by retrying after a reload.')
        return
      }
      fail(`Could not link the task to this finding: ${linkError.message}`)
      return
    }
    setCreatingTaskFor(null)
    const applyFields = (fields: Partial<InspectionItem>) => {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...fields } : i))
      setEditItem(prev => prev && prev.id === item.id ? { ...prev, ...fields } : prev)
    }
    applyFields(linkPatch)
    invalidateReport()
    toast('Task created', {
      action: {
        label: 'Undo',
        onClick: async () => {
          // Link first (a finding pointing at a deleted task is worse
          // than an unlinked task), then the task row. The prior
          // disposition rides back with the unlink.
          const { error: unlinkError } = await supabase.from('inspection_items')
            .update({ task_id: null, ...priorDisposition }).eq('id', item.id)
          if (unlinkError) {
            toast('Could not undo task creation', { tone: 'error' })
            return
          }
          applyFields({ task_id: null, ...priorDisposition })
          invalidateReport()
          const { error: deleteError } = await supabase.from('tasks').delete().eq('id', created.id)
          if (deleteError) toast('Task unlinked, but could not be deleted — remove it from Tasks', { tone: 'error' })
        },
      },
    })
  }

  // Adding photos to an existing finding: compress locally (fails fast on
  // an unsupported format, before anything is queued), then hand off to the
  // background queue — photo_paths and thumbnails update as uploads land.
  async function appendPhotos(item: InspectionItem, files: File[]) {
    if (!inspection || files.length === 0) return
    try {
      const photos = await Promise.all(files.map(compressImage))
      enqueueInspectionPhotos({
        propertyId: inspection.property_id,
        inspectionId: inspection.id,
        itemId: item.id,
        photos,
      })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not read those photos — try again.')
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

      {/* Report: generate/view/draft the PM email — only once the walk is
          submitted. Nothing is automatic and nothing is ever sent from the
          app; even "sent" status is an explicit manual button. */}
      {!isDraft && (
        <ReportPanel
          inspection={inspection}
          pendingPhotoCount={inspectionUploads.length}
          onUpdated={patch => setInspection(prev => prev ? { ...prev, ...patch } : prev)}
          onPatch={patchInspection}
          onMarkedSent={stampFlaggedCommunicated}
          onMarkedNotSent={unstampFlaggedCommunicated}
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

      {/* Desk triage: one-key disposition sweep over untriaged findings.
          Desktop-only — the day-after review happens at a desk, not onsite
          (below md a one-line note points there). Findings never leave the
          list below; triage only assigns their verb. */}
      {!isDraft && items.length > 0 && (
        <TriageSection
          items={items}
          photoUrls={photoUrls}
          localPreviews={localPreviews}
          onDisposition={applyDisposition}
          onCreateTask={createTaskFromItem}
          creatingTaskFor={creatingTaskFor}
          orphanedTaskItems={orphanedTaskItems}
          onCapex={setCapexItem}
        />
      )}

      {/* Watch loop — prior walks' watched findings, checked while onsite.
          Mobile-friendly (unlike the desk triage sweep). */}
      {isDraft && watchItems.length > 0 && (
        <WatchListSection
          watchItems={watchItems}
          photoUrls={photoUrls}
          onView={setLightbox}
          onCarry={carryWatchItem}
          onResolve={resolveWatchItem}
          onSkip={id => setWatchItems(prev => prev.filter(x => x.id !== id))}
        />
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
                    localPreviews={localPreviews}
                    pendingUploads={uploadsByItem[item.id] ?? []}
                    onRetryUpload={retryUpload}
                    onView={setLightbox}
                    onEdit={() => setEditItem(item)}
                    onDelete={() => deleteItem(item)}
                    onAppendPhotos={files => appendPhotos(item, files)}
                    onPhotoError={invalidatePhoto}
                    onCreateTask={() => createTaskFromItem(item)}
                    creatingTask={creatingTaskFor === item.id}
                    createDisabled={orphanedTaskItems.has(item.id)}
                    capexName={item.capex_project_id ? capexNames[item.capex_project_id] ?? null : null}
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
          {photoUrls[lightbox] || localPreviews[lightbox] ? (
            // Freshly uploaded photos may not have a signed URL yet — fall
            // back to the local object URL the queue handed off.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrls[lightbox]?.url ?? localPreviews[lightbox]} alt="Inspection photo"
              onError={() => { if (photoUrls[lightbox]) invalidatePhoto(lightbox) }}
              className="max-h-full max-w-full rounded-lg object-contain" />
          ) : (
            <div className="w-64 h-64 rounded-lg bg-white/10 animate-pulse" />
          )}
        </div>
      )}

      {/* Unobtrusive global upload status — Nick shouldn't have to wonder
          whether it's safe to pocket the phone. */}
      {inspectionUploads.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
          <span className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white shadow-lg',
            failedUploadCount > 0 ? 'bg-red-600/95' : 'bg-slate-800/90'
          )}>
            <UploadCloud size={12} className={failedUploadCount > 0 ? undefined : 'animate-pulse'} />
            {failedUploadCount > 0
              ? `${failedUploadCount} photo${failedUploadCount === 1 ? '' : 's'} failed — tap the photo to retry`
              : `${inspectionUploads.length} photo${inspectionUploads.length === 1 ? '' : 's'} uploading`}
          </span>
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
            // Keep the task link — the finding update payload doesn't
            // carry task_id, so the fresh row does (unchanged).
            setItems(prev => prev.map(i => i.id === updated.id ? updated : i))
            invalidateReport()
          }}
          onCreateTask={() => createTaskFromItem(editItem)}
          creatingTask={creatingTaskFor === editItem.id}
          createDisabled={orphanedTaskItems.has(editItem.id)}
        />
      )}

      {/* CapEx attach/create mini-modal (triage `b` / row button) */}
      {capexItem && (
        <CapexAttachModal
          item={capexItem}
          propertyId={inspection.property_id}
          onClose={() => setCapexItem(null)}
          onDone={(projectId, title) => attachCapex(capexItem, projectId, title)}
        />
      )}
    </div>
  )
}

// ── Desk triage ──────────────────────────────────────────────
// The day-after sweep: every untriaged finding gets a disposition verb,
// one key each — w watch · f flag · t task · b capex · a accept (reason
// required, inline) · r resolved. j/k moves the selection; buttons mirror
// every key for mouse users. Desktop-only: below md the section collapses
// to a one-line pointer (triage happens at a desk, not onsite). The
// counter drains to "Fully triaged ✓". Keys are inert while any
// input/select/modal has focus — same guards as the tasks page keyboard
// layer (components/tasks/use-task-list-shortcuts).

function isEditableTarget(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1 py-0.5 rounded border border-slate-200 bg-slate-50 font-mono text-[10px] text-slate-500 leading-none">
      {children}
    </kbd>
  )
}

function TriageSection({ items, photoUrls, localPreviews, onDisposition, onCreateTask, creatingTaskFor, orphanedTaskItems, onCapex }: {
  items: InspectionItem[]
  photoUrls: Record<string, SignedPhotoUrl>
  localPreviews: Record<string, string>
  onDisposition: (item: InspectionItem, d: Disposition, note?: string | null) => Promise<boolean>
  onCreateTask: (item: InspectionItem) => void
  creatingTaskFor: string | null
  orphanedTaskItems: Set<string>
  onCapex: (item: InspectionItem) => void
}) {
  const untriaged = useMemo(
    () => items.filter(i => normalizeDisposition(i.disposition) === 'open'), [items])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Row with the inline "accept reason" input open (`a`)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [acceptReason, setAcceptReason] = useState('')

  // Selection repair: the selected row was dispositioned away (or undone
  // back in) — fall to the first remaining row rather than dangling.
  useEffect(() => {
    if (selectedId && !untriaged.some(i => i.id === selectedId)) {
      setSelectedId(untriaged[0]?.id ?? null)
    }
    if (acceptingId && !untriaged.some(i => i.id === acceptingId)) {
      setAcceptingId(null)
      setAcceptReason('')
    }
  }, [untriaged, selectedId, acceptingId])

  // Advance selection BEFORE the row leaves the list so the sweep flows
  // straight to the next finding.
  const advanceFrom = (id: string) => {
    const ids = untriaged.map(i => i.id)
    const idx = ids.indexOf(id)
    setSelectedId(ids[idx + 1] ?? ids[idx - 1] ?? null)
  }

  const disposition = (item: InspectionItem, d: Disposition, note?: string | null) => {
    advanceFrom(item.id)
    void onDisposition(item, d, note ?? null)
  }

  const startAccept = (item: InspectionItem) => {
    setSelectedId(item.id)
    setAcceptingId(item.id)
    setAcceptReason('')
  }

  const commitAccept = (item: InspectionItem) => {
    const reason = acceptReason.trim()
    if (!reason) return
    setAcceptingId(null)
    setAcceptReason('')
    disposition(item, 'accepted', reason)
  }

  // Single stable keydown listener reading the latest state via a ref —
  // the pattern from use-task-list-shortcuts.
  const ref = useRef({ untriaged, selectedId, disposition, startAccept, onCreateTask, onCapex })
  ref.current = { untriaged, selectedId, disposition, startAccept, onCreateTask, onCapex }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = ref.current
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // Desktop-only ritual: no keyboard layer on touch, and none while
      // the section itself is hidden below md.
      if (window.matchMedia('(pointer: coarse)').matches) return
      if (!window.matchMedia('(min-width: 768px)').matches) return
      if (isOverlayOpen()) return
      if (isEditableTarget()) {
        // Inputs own their keys — Escape just backs out of the field.
        if (e.key === 'Escape') (document.activeElement as HTMLElement | null)?.blur()
        return
      }
      if (s.untriaged.length === 0) return
      const ids = s.untriaged.map(i => i.id)
      const idx = s.selectedId ? ids.indexOf(s.selectedId) : -1
      const isNav = e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp'
      // Held-down keys only repeat navigation — a repeating disposition
      // key would mow through the queue.
      if (e.repeat && !isNav) return
      if (isNav) {
        e.preventDefault()
        const dir = e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1
        const next = idx === -1
          ? (dir === 1 ? 0 : ids.length - 1)
          : Math.min(Math.max(idx + dir, 0), ids.length - 1)
        setSelectedId(ids[next])
        document.querySelector(`[data-triage-id="${ids[next]}"]`)?.scrollIntoView({ block: 'nearest' })
        return
      }
      if (e.key === 'Escape') { setSelectedId(null); return }
      if (idx === -1) return
      const item = s.untriaged[idx]
      switch (e.key) {
        case 'w': e.preventDefault(); s.disposition(item, 'watch'); return
        case 'f': e.preventDefault(); s.disposition(item, 'flagged'); return
        case 'r': e.preventDefault(); s.disposition(item, 'resolved'); return
        case 'a': e.preventDefault(); s.startAccept(item); return
        case 't': e.preventDefault(); s.onCreateTask(item); return
        case 'b': e.preventDefault(); setSelectedId(item.id); s.onCapex(item); return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (untriaged.length === 0) {
    return (
      <div className="hidden md:flex card px-4 py-3 text-sm font-medium text-emerald-700 items-center gap-2">
        <Check size={15} />Fully triaged ✓
      </div>
    )
  }

  return (
    <>
      {/* Below md: a pointer, not the sweep — triage happens on desktop */}
      <div className="md:hidden card px-4 py-3 text-xs text-slate-400 flex items-center gap-2">
        <Keyboard size={14} className="text-slate-300 flex-shrink-0" />
        {untriaged.length} finding{untriaged.length === 1 ? '' : 's'} to triage — triage happens on desktop.
      </div>

      <div className="hidden md:block card overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Triage ({untriaged.length} untriaged)
          </span>
          {/* kbd hint strip */}
          <span className="text-xs text-slate-400 flex items-center gap-1.5 ml-auto flex-wrap">
            <Keyboard size={13} className="text-slate-300" />
            <Kbd>j</Kbd><Kbd>k</Kbd> move
            <span className="text-slate-200">·</span><Kbd>w</Kbd> watch
            <span className="text-slate-200">·</span><Kbd>f</Kbd> flag
            <span className="text-slate-200">·</span><Kbd>t</Kbd> task
            <span className="text-slate-200">·</span><Kbd>b</Kbd> capex
            <span className="text-slate-200">·</span><Kbd>a</Kbd> accept
            <span className="text-slate-200">·</span><Kbd>r</Kbd> resolved
          </span>
        </div>
        <div>
          {untriaged.map(item => {
            const selected = item.id === selectedId
            const firstPhoto = item.photo_paths[0]
            const src = firstPhoto ? photoUrls[firstPhoto]?.url ?? localPreviews[firstPhoto] : undefined
            const taskBlocked = creatingTaskFor === item.id || orphanedTaskItems.has(item.id)
            const btn = (title: string, onClick: () => void, icon: React.ReactNode, hover: string, disabled = false) => (
              <button
                onClick={e => { e.stopPropagation(); onClick() }}
                disabled={disabled}
                title={title}
                className={cn('p-1.5 text-slate-300 transition-colors', hover, disabled && 'opacity-40 pointer-events-none')}>
                {icon}
              </button>
            )
            return (
              <div key={item.id}>
                <div
                  data-triage-id={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    'group px-4 py-2 flex items-center gap-3 border-b border-slate-100 last:border-0',
                    selected ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-200' : 'hover:bg-slate-50'
                  )}>
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" className="w-9 h-9 rounded object-cover border border-slate-200 flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <Camera size={12} className="text-slate-300" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm truncate', item.item_label ? 'text-slate-800' : 'text-slate-300 italic')}>
                      {item.item_label || 'No description'}
                    </p>
                    <p className="text-xs text-slate-400 truncate flex items-center gap-1.5">
                      {instanceLabel({ name: item.section_name, unit: item.unit_number })}
                      {item.requires_action && (
                        <span className={cn('badge', PRIORITY_STYLES[item.action_priority ?? 'medium'] ?? 'text-slate-600 bg-slate-100 border-slate-200')}>
                          {PRIORITY_LABELS[item.action_priority as ActionPriority] ?? item.action_priority ?? 'Medium'}
                        </span>
                      )}
                    </p>
                  </div>
                  {/* Buttons mirror the keys for mouse users */}
                  <div className={cn('flex items-center flex-shrink-0 transition-opacity',
                    selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
                    {btn('Watch (w)', () => disposition(item, 'watch'), <Eye size={14} />, 'hover:text-amber-600')}
                    {btn('Flag for the PM (f)', () => disposition(item, 'flagged'), <Flag size={14} />, 'hover:text-red-600')}
                    {btn(orphanedTaskItems.has(item.id) ? 'Task exists in Tasks but is not linked to this finding' : 'Create task (t)',
                      () => onCreateTask(item), <ListTodo size={14} />, 'hover:text-blue-600', taskBlocked)}
                    {btn('Attach to CapEx (b)', () => { setSelectedId(item.id); onCapex(item) }, <HardHat size={14} />, 'hover:text-orange-600')}
                    {btn('Accept with reason (a)', () => startAccept(item), <X size={14} />, 'hover:text-slate-600')}
                    {btn('Resolved (r)', () => disposition(item, 'resolved'), <Check size={14} />, 'hover:text-emerald-600')}
                  </div>
                </div>
                {/* Inline required reason for accept — Enter commits, Esc backs out */}
                {acceptingId === item.id && (
                  <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                    <span className="text-xs text-slate-500 flex-shrink-0">Accepting — why?</span>
                    <input
                      autoFocus
                      value={acceptReason}
                      onChange={e => setAcceptReason(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitAccept(item) }
                        if (e.key === 'Escape') { setAcceptingId(null); setAcceptReason('') }
                      }}
                      placeholder="One-line reason (required)"
                      className="input py-1.5 text-sm flex-1"
                    />
                    <button onClick={() => commitAccept(item)} disabled={!acceptReason.trim()}
                      className="btn-secondary text-xs py-1.5">
                      Accept
                    </button>
                    <button onClick={() => { setAcceptingId(null); setAcceptReason('') }}
                      className="btn-ghost text-xs py-1.5">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

// ── Watch list (capture screen) ──────────────────────────────
// Prior inspections' watched findings, re-checked while walking the
// property. Three outcomes per row: Still an issue (clone into this
// inspection), Resolved (verified gone), or Skip (stays watched for the
// next walk — local dismiss only). Buttons stay big and wrap — this runs
// one-handed on a phone.

function WatchListSection({ watchItems, photoUrls, onView, onCarry, onResolve, onSkip }: {
  watchItems: WatchRow[]
  photoUrls: Record<string, SignedPhotoUrl>
  onView: (path: string) => void
  onCarry: (w: WatchRow) => Promise<void>
  onResolve: (w: WatchRow) => Promise<void>
  onSkip: (id: string) => void
}) {
  // Row with a write in flight — its buttons lock to prevent double-fires.
  const [busyId, setBusyId] = useState<string | null>(null)

  const run = async (w: WatchRow, action: (w: WatchRow) => Promise<void>) => {
    if (busyId) return
    setBusyId(w.id)
    try { await action(w) } finally { setBusyId(null) }
  }

  return (
    <div className="card overflow-hidden border-amber-200">
      <div className="px-4 py-3 border-b border-amber-100 bg-amber-50/60 flex items-center gap-2 flex-wrap">
        <Eye size={14} className="text-amber-600 flex-shrink-0" />
        <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">
          Watch list ({watchItems.length})
        </span>
        <span className="text-xs text-amber-700/70">from earlier walks — check these while you&apos;re here</span>
      </div>
      {watchItems.map(w => {
        const firstPhoto = w.photo_paths[0]
        const src = firstPhoto ? photoUrls[firstPhoto]?.url : undefined
        const busy = busyId === w.id
        return (
          <div key={w.id} className="px-4 py-3 border-b border-slate-100 last:border-0 flex gap-3">
            {firstPhoto ? (
              src ? (
                <button onClick={() => onView(firstPhoto)} className="flex-shrink-0" title="View photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="Watched finding"
                    className="w-14 h-14 rounded-lg object-cover border border-slate-200" />
                </button>
              ) : (
                <div className="w-14 h-14 rounded-lg bg-slate-100 animate-pulse flex-shrink-0" />
              )
            ) : (
              <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                <Camera size={14} className="text-slate-300" />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className={cn('text-sm', w.item_label ? 'text-slate-800' : 'text-slate-300 italic')}>
                {w.item_label || 'No description'}
              </p>
              <p className="text-xs text-slate-400">
                {instanceLabel({ name: w.section_name, unit: w.unit_number })}
                {' · '}watched {formatDate(w.inspections.inspection_date)}
                {(w.watch_count ?? 0) > 0 && ` · carried ${w.watch_count}×`}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => run(w, onCarry)} disabled={busy}
                  className="btn-secondary text-xs py-1.5 border-amber-300 text-amber-700 hover:bg-amber-50">
                  <RotateCcw size={12} />{busy ? 'Saving…' : 'Still an issue'}
                </button>
                <button onClick={() => run(w, onResolve)} disabled={busy}
                  className="btn-secondary text-xs py-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                  <Check size={12} />Resolved
                </button>
                <button onClick={() => onSkip(w.id)} disabled={busy}
                  title="Leave on the watch list for the next walk"
                  className="btn-ghost text-xs py-1.5">
                  Skip
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── CapEx attach/create mini-modal ───────────────────────────
// Triage `b`: attach the finding to an existing open capex project on the
// property, or create a new one (title prefilled from the finding,
// category 'other', status planning). The parent links the finding +
// sets its disposition once a project is resolved.

function CapexAttachModal({ item, propertyId, onClose, onDone }: {
  item: InspectionItem
  propertyId: string
  onClose: () => void
  onDone: (projectId: string, projectTitle: string) => void
}) {
  const supabase = createClient()
  // null = still loading the property's open projects
  const [projects, setProjects] = useState<{ id: string; title: string; status: string }[] | null>(null)
  const [mode, setMode] = useState<'existing' | 'new'>('new')
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState(item.item_label.trim() || 'Inspection finding')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('capex_projects')
      .select('id, title, status')
      .eq('property_id', propertyId)
      .neq('status', 'complete')
      .order('created_at', { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (cancelled) return
        if (fetchError) {
          // Creation still works without the list — surface, don't block.
          setError(`Could not load existing projects — ${fetchError.message}`)
          setProjects([])
          return
        }
        const rows = data ?? []
        setProjects(rows)
        if (rows.length > 0) {
          setMode('existing')
          setProjectId(rows[0].id)
        }
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (mode === 'existing') {
      const project = projects?.find(p => p.id === projectId)
      if (!project) { setError('Pick a project to attach to.'); return }
      onDone(project.id, project.title)
      return
    }
    if (!title.trim()) { setError('Give the new project a title.'); return }
    setSaving(true)
    const { data, error: insertError } = await supabase.from('capex_projects')
      .insert({ property_id: propertyId, title: title.trim(), category: 'other', status: 'planning' })
      .select('id, title')
      .single()
    setSaving(false)
    if (insertError || !data) {
      setError(`Could not create the project — ${insertError?.message ?? 'try again'}`)
      return
    }
    onDone(data.id, data.title)
  }

  return (
    <Modal title="Attach Finding to CapEx" onClose={onClose} maxWidth="md">
      <form onSubmit={submit} className="px-6 py-5 space-y-4">
        <p className="text-sm text-slate-600 line-clamp-2">
          {item.item_label.trim() || <span className="text-slate-300 italic">No description</span>}
        </p>
        {projects === null ? (
          <p className="text-xs text-slate-400">Loading projects…</p>
        ) : (
          <div className="space-y-3">
            {projects.length > 0 && (
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="radio" name="capex-mode" checked={mode === 'existing'}
                  onChange={() => setMode('existing')} className="accent-blue-600 mt-1" />
                <span className="flex-1">
                  Attach to an open project
                  {mode === 'existing' && (
                    <select value={projectId} onChange={e => setProjectId(e.target.value)}
                      className="input mt-1.5" aria-label="CapEx project">
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.title} ({p.status.replace('_', ' ')})
                        </option>
                      ))}
                    </select>
                  )}
                </span>
              </label>
            )}
            <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="radio" name="capex-mode" checked={mode === 'new'}
                onChange={() => setMode('new')} className="accent-blue-600 mt-1" />
              <span className="flex-1">
                Create a new project{projects.length === 0 && <span className="text-xs text-slate-400"> — none open on this property</span>}
                {mode === 'new' && (
                  <>
                    <input value={title} onChange={e => setTitle(e.target.value)}
                      className="input mt-1.5" placeholder="Project title" aria-label="New project title" />
                    <span className="block text-xs text-slate-400 mt-1">Category “other”, status “planning” — refine it on the CapEx page.</span>
                  </>
                )}
              </span>
            </label>
          </div>
        )}
        {error && (
          <p className="text-xs text-red-600 flex items-center gap-1.5">
            <AlertTriangle size={12} className="flex-shrink-0" />{error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving || projects === null} className="btn-primary">
            {saving ? 'Saving…' : mode === 'existing' ? 'Attach' : 'Create & attach'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Report panel ─────────────────────────────────────────────
// Generate (or regenerate) the PDF report, open it via a signed URL, and
// draft the PM email. The app never sends email — the modal only builds
// draft content Nick opens in Gmail (or copies) and sends personally —
// so "sent" is a status the app can't observe: it's recorded here by an
// explicit "Mark as sent" button, and only by that button.

function ReportPanel({ inspection, pendingPhotoCount, onUpdated, onPatch, onMarkedSent, onMarkedNotSent }: {
  inspection: InspectionDetail
  // Photos for this inspection still in the background upload queue
  // (uploading, retrying, or failed) — a report generated now would
  // silently miss them.
  pendingPhotoCount: number
  onUpdated: (patch: Partial<Inspection>) => void
  // The page's stall-protected inspection patch (timeout + retry, error
  // on the page banner, state updated on success) — the sent-status
  // buttons write through it.
  onPatch: (patch: Partial<Inspection>) => Promise<boolean>
  // Marking sent means the flagged findings in that email were
  // communicated — the page stamps/unstamps communicated_at on them
  // (best-effort, after the status flip lands).
  onMarkedSent: () => void
  onMarkedNotSent: () => void
}) {
  const supabase = createClient()
  const [generating, setGenerating] = useState(false)
  const [opening, setOpening] = useState(false)
  const [showDraft, setShowDraft] = useState(false)
  // Inline confirm for "Mark as sent" — flipping the status is a manual
  // claim ("I emailed this from Gmail"), so it gets a deliberate two-tap
  // instead of firing on a stray click.
  const [confirmingSent, setConfirmingSent] = useState(false)
  const [savingSent, setSavingSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasReport = !!inspection.report_file_path

  async function markSent() {
    setSavingSent(true)
    const ok = await onPatch({ status: 'report_sent', report_sent_at: new Date().toISOString() })
    setSavingSent(false)
    if (ok) {
      setConfirmingSent(false)
      onMarkedSent()
    }
  }

  // Undo affordance for a mistaken claim — back to submitted, sent
  // timestamp cleared (and the communicated stamps walked back).
  async function markNotSent() {
    setSavingSent(true)
    const ok = await onPatch({ status: 'submitted', report_sent_at: null })
    setSavingSent(false)
    if (ok) onMarkedNotSent()
  }

  async function generate() {
    // A report without the queued photos would be silently incomplete —
    // surface it, and only proceed on an explicit confirm.
    if (pendingPhotoCount > 0 && !confirm(
      `${pendingPhotoCount} photo${pendingPhotoCount === 1 ? ' is' : 's are'} still uploading (or failed) for this inspection. `
      + 'A report generated now will be missing them. Generate anyway?')) return
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/inspections/${inspection.id}/report`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        // Surface the route's detail too — "Report generation failed" alone
        // is undiagnosable from the field.
        const base = json.error ?? `Report generation failed (${res.status})`
        throw new Error(json.detail ? `${base} — ${json.detail}` : base)
      }
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
    const { url, error: signError } = await signedFileUrl(supabase, inspection.report_file_path)
    setOpening(false)
    if (url) window.open(url, '_blank')
    else setError(`Could not open the report${signError ? ` — ${signError}` : ''}`)
  }

  return (
    <div className="card px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
          <FileText size={13} className="text-blue-600" />Report
        </span>
        {/* Invalidation + regeneration both revert sent status, so this
            only ever describes the PDF currently behind "View PDF". */}
        {inspection.status === 'report_sent' && (
          <span className="text-xs text-slate-400 flex items-center gap-2">
            Sent to PM{inspection.report_sent_at ? ` ${formatDate(inspection.report_sent_at)}` : ''}
            <button onClick={markNotSent} disabled={savingSent}
              title="Revert — this report has not actually been emailed"
              className="underline hover:text-slate-600 disabled:opacity-50">
              {savingSent ? 'Reverting…' : 'Mark not sent'}
            </button>
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <button onClick={generate} disabled={generating} className="btn-secondary">
            <FileText size={14} />
            {generating ? 'Generating…' : hasReport ? 'Regenerate report' : 'Generate report'}
          </button>
          {hasReport && (
            <button onClick={viewPdf} disabled={opening} className="btn-secondary">
              <ExternalLink size={14} />{opening ? 'Opening…' : 'View PDF'}
            </button>
          )}
          {/* Records that Nick emailed the report from Gmail — the app
              can't observe that send, so the status flip is manual. */}
          {inspection.status === 'submitted' && (
            confirmingSent ? (
              <span className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500">Emailed from Gmail?</span>
                <button onClick={markSent} disabled={savingSent} className="btn-secondary text-xs py-1.5">
                  <Check size={13} />{savingSent ? 'Saving…' : 'Yes, mark sent'}
                </button>
                <button onClick={() => setConfirmingSent(false)} disabled={savingSent}
                  className="btn-ghost text-xs py-1.5">
                  Cancel
                </button>
              </span>
            ) : (
              <button onClick={() => setConfirmingSent(true)}
                title="Record that you emailed this report from Gmail"
                className="btn-secondary">
                <Check size={14} />Mark as sent
              </button>
            )
          )}
          {/* Drafting doesn't require a generated PDF — the findings
              format builds the email body from live findings (the modal
              disables the PDF-link format until a PDF exists). */}
          <button onClick={() => setShowDraft(true)} className="btn-primary">
            <Mail size={14} />Email PM…
          </button>
        </div>
      </div>
      {pendingPhotoCount > 0 && (
        <p className="text-xs text-amber-600 flex items-center gap-1.5">
          <UploadCloud size={12} className="flex-shrink-0" />
          {pendingPhotoCount} photo{pendingPhotoCount === 1 ? '' : 's'} still uploading — a report generated now would be missing {pendingPhotoCount === 1 ? 'it' : 'them'}.
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0" />{error}
        </p>
      )}
      {showDraft && (
        <EmailDraftModal
          inspection={inspection}
          hasReport={hasReport}
          onClose={() => setShowDraft(false)}
        />
      )}
    </div>
  )
}

// ── Email-PM drafting modal ──────────────────────────────────
// A drafting surface, not a send form — the app NEVER sends email. The
// server builds the draft (subject + Gmail-pasteable HTML + plain text)
// and this modal hands it to Nick two ways: a prefilled Gmail compose
// window, or a formatted clipboard copy. He types the recipients and
// sends personally — no recipient is collected or preloaded anywhere, so
// Gmail's To field always starts empty.

type DraftFormat = 'findings' | 'summary'

const DRAFT_FORMAT_OPTIONS: { value: DraftFormat; label: string; needsPdf: boolean }[] = [
  { value: 'findings', label: 'Bulleted findings', needsPdf: false },
  { value: 'summary', label: 'Short note + PDF link', needsPdf: true },
]

const DRAFT_FORMAT_HINTS: Record<DraftFormat, string> = {
  findings: 'Findings bulleted by section with hyperlinked photos — the report in the email body. Links stay valid for 30 days.',
  summary: 'A short note with the score and a link to the PDF report. The link stays valid for 30 days.',
}

// Gmail's compose URL is a GET request — an over-long &body= gets the
// whole URL rejected. Budget is for the ENCODED body; past it, the text
// is cut at a paragraph boundary and the full formatted draft goes onto
// the clipboard first, so pasting over the stub completes the email.
const GMAIL_BODY_ENCODED_BUDGET = 6000

function EmailDraftModal({ inspection, hasReport, onClose }: {
  inspection: InspectionDetail
  hasReport: boolean
  onClose: () => void
}) {
  const [format, setFormat] = useState<DraftFormat>('findings')
  const [message, setMessage] = useState('')
  // Debounced mirror of the message — the live preview refetches on it,
  // and a draft build (which signs photo URLs) per keystroke would
  // hammer the storage API.
  const [debouncedMessage, setDebouncedMessage] = useState('')
  const [draft, setDraft] = useState<{ subject: string; html: string; text: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedMessage(message.trim()), 400)
    return () => clearTimeout(t)
  }, [message])

  // Live preview: fetch the server-built draft on open and whenever the
  // format or debounced message changes. The action buttons always use
  // the LATEST fetched draft — they're disabled while a fetch is in
  // flight so a stale draft can't be opened or copied.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch(`/api/inspections/${inspection.id}/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ format, message: debouncedMessage || undefined }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || !json.success || typeof json.subject !== 'string'
          || typeof json.html !== 'string' || typeof json.text !== 'string') {
          throw new Error(json.error ?? `Could not build the email draft (${res.status})`)
        }
        if (!cancelled) setDraft({ subject: json.subject, html: json.html, text: json.text })
      } catch (err) {
        if (!cancelled) {
          // Clear the draft too — keeping one that no longer matches the
          // chosen format/message would let the buttons hand out stale
          // content.
          setDraft(null)
          setError(err instanceof Error ? err.message : 'Could not build the email draft.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [inspection.id, format, debouncedMessage])

  const ready = !!draft && !loading

  // Copy with text/html + text/plain flavors so Gmail pastes it fully
  // formatted; falls back to plain text where ClipboardItem isn't
  // available. Returns whether the rich flavor made it on. Throws only
  // when even the plain-text write fails.
  async function copyToClipboard(current: { html: string; text: string }): Promise<boolean> {
    let rich = false
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([current.html], { type: 'text/html' }),
          'text/plain': new Blob([current.text], { type: 'text/plain' }),
        })])
        rich = true
      } catch { /* fall through to plain text */ }
    }
    if (!rich) await navigator.clipboard.writeText(current.text)
    return rich
  }

  async function handleCopy() {
    if (!ready || !draft) return
    setError(null)
    try {
      const rich = await copyToClipboard(draft)
      toast(rich ? 'Formatted draft copied — paste into Gmail' : 'Draft copied as plain text')
    } catch {
      setError('Could not copy the draft — your browser may be blocking clipboard access.')
    }
  }

  // Open a Gmail compose window prefilled with subject + plain-text body.
  // Deliberately NO `to` parameter — the To field starts empty for Nick
  // to fill in. A body past the URL budget is truncated at a paragraph
  // boundary, with the full formatted draft copied to the clipboard
  // FIRST so pasting over the stub completes the email.
  async function openGmail() {
    if (!ready || !draft) return
    setError(null)
    let body = draft.text
    if (encodeURIComponent(body).length > GMAIL_BODY_ENCODED_BUDGET) {
      const marker = '\n\n[Full formatted version is on your clipboard — paste it here]'
      try {
        await copyToClipboard(draft)
      } catch {
        setError('This draft is too long for a Gmail compose link, and the clipboard copy failed — use "Copy formatted draft" and paste into a blank Gmail message instead.')
        return
      }
      let cut = body
      while (cut.length > 0 && encodeURIComponent(cut + marker).length > GMAIL_BODY_ENCODED_BUDGET) {
        const at = cut.lastIndexOf('\n\n')
        cut = at > 0 ? cut.slice(0, at) : cut.slice(0, cut.length - 400)
      }
      body = cut + marker
      toast('Long draft — Gmail opens truncated; the full version is on your clipboard')
    }
    window.open(
      `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(body)}`,
      '_blank',
    )
  }

  return (
    <Modal title="Draft Email to PM" onClose={onClose} maxWidth="md">
      <div className="px-6 py-5 space-y-4">
        <p className="text-xs text-slate-400">
          Nothing sends from here — open the draft in Gmail (you type the recipients) or copy it, and send it yourself.
        </p>
        <div>
          <label className="label">Format</label>
          <div className="space-y-1.5">
            {DRAFT_FORMAT_OPTIONS.map(opt => {
              const disabled = opt.needsPdf && !hasReport
              return (
                <label key={opt.value}
                  title={disabled ? 'Generate the PDF report first' : undefined}
                  className={cn('flex items-center gap-2 text-sm',
                    disabled ? 'text-slate-300' : 'text-slate-700 cursor-pointer')}>
                  <input type="radio" name="draft-format" value={opt.value}
                    checked={format === opt.value}
                    disabled={disabled}
                    onChange={() => setFormat(opt.value)}
                    className="accent-blue-600" />
                  {opt.label}
                  {disabled && <span className="text-xs text-slate-300">— generate the PDF report first</span>}
                </label>
              )
            })}
          </div>
          <p className="text-xs text-slate-400 mt-1.5">{DRAFT_FORMAT_HINTS[format]}</p>
        </div>
        <div>
          <label className="label">Message (optional)</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)}
            className="input min-h-[70px] resize-none"
            placeholder="Short note to include above the summary…" />
        </div>
        <div>
          <label className="label">Preview</label>
          <div className="relative border border-slate-200 rounded-lg overflow-hidden">
            {draft ? (
              // Full HTML document in an isolated frame (it carries its own
              // inline styles); the frame scrolls within the bordered box.
              <iframe srcDoc={draft.html} sandbox="" title="Email draft preview"
                className={cn('w-full h-72 bg-white', loading && 'opacity-50')} />
            ) : (
              <div className="h-72 bg-slate-50 flex items-center justify-center text-xs text-slate-400">
                {loading ? 'Building draft…' : 'Draft unavailable'}
              </div>
            )}
            {loading && draft && (
              <span className="absolute top-2 right-2 text-xs text-slate-400 bg-white/90 border border-slate-200 rounded-full px-2 py-0.5">
                Updating…
              </span>
            )}
          </div>
        </div>
        {error && (
          <p className="text-xs text-red-600 flex items-center gap-1.5">
            <AlertTriangle size={12} className="flex-shrink-0" />{error}
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={openGmail} disabled={!ready} className="btn-primary">
            <ExternalLink size={14} />Open Gmail draft
          </button>
          <button type="button" onClick={handleCopy} disabled={!ready} className="btn-secondary">
            <Copy size={14} />Copy formatted draft
          </button>
          <button type="button" onClick={onClose} className="btn-ghost ml-auto">Close</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Finding card ─────────────────────────────────────────────

function FindingCard({ item, photoUrls, localPreviews, pendingUploads, onRetryUpload, onView, onEdit, onDelete, onAppendPhotos, onPhotoError, onCreateTask, creatingTask, createDisabled, capexName }: {
  item: InspectionItem
  photoUrls: Record<string, SignedPhotoUrl>
  // Local object URLs for freshly uploaded photos without a signed URL yet.
  localPreviews: Record<string, string>
  // This finding's photos still in the background upload queue.
  pendingUploads: UploadEntrySnapshot[]
  onRetryUpload: (entryId: string) => void
  onView: (path: string) => void
  onEdit: () => void
  onDelete: () => void
  onAppendPhotos: (files: File[]) => Promise<void>
  onPhotoError: (path: string) => void
  onCreateTask: () => void
  creatingTask: boolean
  createDisabled: boolean  // orphaned unlinked task exists — retry would duplicate
  capexName: string | null // linked capex project title (when resolved)
}) {
  // Only covers local compression now — uploads continue in the background.
  const [uploading, setUploading] = useState(false)

  // Settled findings stay fully visible and reviewable — never filtered
  // away — just visually quieter than the live ones.
  const settled = isSettled(item.disposition)

  async function handleAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    setUploading(true)
    await onAppendPhotos(files)
    setUploading(false)
  }

  return (
    <div className={cn('card p-3', settled && 'opacity-70')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm', item.item_label ? 'text-slate-800' : 'text-slate-300 italic')}>
            {item.item_label || 'No description'}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.requires_action && (
              <span className={cn('badge mt-1.5', PRIORITY_STYLES[item.action_priority ?? 'medium'] ?? 'text-slate-600 bg-slate-100 border-slate-200')}>
                <Flag size={9} className="mr-1" />
                Follow up{item.action_priority ? ` · ${PRIORITY_LABELS[item.action_priority as ActionPriority] ?? item.action_priority}` : ''}
              </span>
            )}
            <DispositionChip item={item} capexName={capexName} className="mt-1.5" />
            {/* Legacy safety: a linked task on a non-'task' disposition
                (e.g. after a manual edit) keeps its pointer visible. */}
            {item.task_id && normalizeDisposition(item.disposition) !== 'task' && (
              <Link href="/tasks"
                className="badge mt-1.5 text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100 transition-colors">
                <CheckSquare size={9} className="mr-1" />Task
              </Link>
            )}
            {/* Escalation badge from the watch loop — carried 3+ walks */}
            {item.watch_count >= 3 && (
              <span className="badge mt-1.5 text-amber-700 bg-amber-50 border-amber-200"
                title="Carried forward from the watch list on 3+ inspections — priority auto-raised to high">
                <Eye size={9} className="mr-1" />Watched {item.watch_count} visits
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {!item.task_id && (
            <button
              onClick={onCreateTask}
              disabled={creatingTask || createDisabled}
              title={createDisabled ? 'Task exists in Tasks but is not linked to this finding' : 'Create task from finding'}
              className={cn('text-slate-300 hover:text-emerald-600 p-1.5',
                (creatingTask || createDisabled) && 'opacity-50 pointer-events-none')}>
              <ListTodo size={14} />
            </button>
          )}
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
            const src = signed?.url ?? localPreviews[path]
            return src ? (
              <button key={path} onClick={() => onView(path)} className="block" title="View full size">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="Finding photo"
                  onError={() => { if (signed) onPhotoError(path) }}
                  className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-lg border border-slate-200" />
              </button>
            ) : (
              <div key={path} className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-slate-100 animate-pulse" />
            )
          })}
          {/* Photos still uploading in the background: local preview with a
              per-photo status badge; a failed one is tappable to retry. */}
          {pendingUploads.map(u => (
            <div key={u.id} className="relative flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u.previewUrl} alt="Photo uploading"
                className={cn(
                  'w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-lg border',
                  u.status === 'failed' ? 'border-red-300 opacity-60' : 'border-slate-200 opacity-75'
                )} />
              {u.status === 'failed' ? (
                <button
                  onClick={() => onRetryUpload(u.id)}
                  title={`Upload failed${u.error ? ` (${u.error})` : ''} — tap to retry`}
                  aria-label="Retry photo upload"
                  className="absolute inset-0 flex items-center justify-center rounded-lg bg-red-500/25 text-red-700">
                  <RotateCcw size={16} />
                </button>
              ) : (
                <span
                  title={u.status === 'retrying' ? 'Connection hiccup — retrying upload' : 'Uploading…'}
                  className={cn(
                    'absolute bottom-1 right-1 rounded-full p-1 text-white',
                    u.status === 'retrying' ? 'bg-amber-500' : 'bg-blue-500 animate-pulse'
                  )}>
                  {u.status === 'retrying' ? <RotateCcw size={9} /> : <UploadCloud size={9} />}
                </span>
              )}
            </div>
          ))}
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
  const [state, setState] = useState<'idle' | 'saving' | 'retrying' | 'saved' | 'error'>('idle')
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
    if (!canSave || !active || state === 'saving' || state === 'retrying') return
    setState('saving')
    setError(null)
    try {
      // Compress first — pure local work (off the main thread where
      // supported), and an unsupported format must fail BEFORE the row
      // inserts and the form resets. The network wait for photos is gone:
      // they upload via the background queue after the row lands.
      const photos = files.length > 0 ? await Promise.all(files.map(compressImage)) : []

      // Client-generated id makes the insert retry-safe: if a timed-out
      // first attempt actually landed, the retry hits the duplicate key
      // and recovers the existing row instead of inserting a twin.
      const itemId = randomUuid()
      const inserted = await withTimeoutRetry<InspectionItem>(async signal => {
        const { data, error: insertError } = await supabase.from('inspection_items').insert({
          id: itemId,
          inspection_id: inspection.id,
          section_name: active.name,
          unit_number: active.unit,
          item_label: description.trim(),
          requires_action: followUp,
          action_priority: followUp ? priority : null,
          photo_paths: [],
        }).select().abortSignal(signal).single()
        if (insertError?.code === '23505') {
          const { data: existing, error: refetchError } = await supabase.from('inspection_items')
            .select('*').eq('id', itemId).abortSignal(signal).single()
          if (refetchError || !existing) throw new Error(refetchError?.message ?? 'Save failed')
          return existing as InspectionItem
        }
        if (insertError || !data) throw new Error(insertError?.message ?? 'Save failed')
        return data as InspectionItem
      }, { onRetry: () => setState('retrying') })

      if (photos.length > 0) {
        enqueueInspectionPhotos({
          propertyId: inspection.property_id,
          inspectionId: inspection.id,
          itemId: inserted.id,
          photos,
        })
      }

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
      onSaved(inserted)
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
          disabled={!canSave || state === 'saving' || state === 'retrying'}
          className="btn-primary ml-auto min-h-[42px] px-6">
          {state === 'saving' ? 'Saving…' : state === 'retrying' ? 'Retrying…' : 'Save'}
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

function EditFindingModal({ item, instances, onClose, onSaved, onCreateTask, creatingTask, createDisabled }: {
  item: InspectionItem
  instances: SectionInstance[]
  onClose: () => void
  onSaved: (item: InspectionItem) => void
  onCreateTask: () => void
  creatingTask: boolean
  createDisabled: boolean  // orphaned unlinked task exists — retry would duplicate
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
  const [disposition, setDisposition] = useState<Disposition>(normalizeDisposition(item.disposition))
  const [dispositionNote, setDispositionNote] = useState(item.disposition_note ?? '')
  const [saving, setSaving] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Stall-protected: 10s timeout per attempt + retry with backoff. The
  // update payload is fixed, so a retried write that already landed is a
  // harmless repeat. Form state survives failure.
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const note = dispositionNote.trim() || null
    // Accepting is a decision — it always carries the why.
    if (disposition === 'accepted' && !note) {
      setError('Add a one-line reason for accepting this finding.')
      return
    }
    setSaving(true)
    setError(null)
    // Payload computed once so a retried write is a harmless repeat.
    // disposition_at stamps only when the verb actually changed — editing
    // the description or note must not reset "flagged Nd" aging.
    const payload = {
      item_label: description.trim(),
      section_name: sectionName,
      unit_number: unitNumber.trim() || null,
      requires_action: followUp,
      action_priority: followUp ? priority : null,
      disposition,
      disposition_note: note,
      ...(disposition !== normalizeDisposition(item.disposition)
        ? { disposition_at: new Date().toISOString() }
        : {}),
    }
    try {
      const data = await withTimeoutRetry<InspectionItem>(async signal => {
        const { data, error: updateError } = await supabase.from('inspection_items')
          .update(payload).eq('id', item.id).select().abortSignal(signal).single()
        if (updateError || !data) throw new Error(updateError?.message ?? 'Save failed')
        return data as InspectionItem
      }, { onRetry: () => setRetrying(true) })
      onSaved(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
      setRetrying(false)
    }
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Disposition</label>
            <select value={disposition} onChange={e => setDisposition(e.target.value as Disposition)}
              className="input">
              {DISPOSITIONS.map(d => <option key={d} value={d}>{DISPOSITION_LABELS[d]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Disposition note{disposition === 'accepted' ? ' (required)' : ''}</label>
            <input value={dispositionNote} onChange={e => setDispositionNote(e.target.value)}
              className="input" placeholder={disposition === 'accepted' ? 'Why is this acceptable?' : 'Optional note'} />
          </div>
        </div>
        {/* Spawn a follow-up task (shared creation layer, undo on the
            toast); once linked, the chip points at the Tasks page */}
        {item.task_id ? (
          <Link href="/tasks"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 hover:bg-emerald-100 transition-colors">
            <CheckSquare size={11} />Task created — view in Tasks
          </Link>
        ) : (
          <button
            type="button"
            onClick={onCreateTask}
            disabled={creatingTask || createDisabled}
            title={createDisabled ? 'Task exists in Tasks but is not linked to this finding' : undefined}
            className="btn-secondary text-xs py-1.5">
            <ListTodo size={13} />{creatingTask ? 'Creating…' : 'Create task from finding'}
          </button>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? (retrying ? 'Retrying…' : 'Saving…') : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
