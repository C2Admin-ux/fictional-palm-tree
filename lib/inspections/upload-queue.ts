// Background upload queue for inspection finding photos.
//
// Saving a finding is instant with respect to photos: the inspection_items
// row lands first with its text fields, and the compressed photos are
// enqueued here — uploaded with per-photo retry + exponential backoff, and
// appended to the row's photo_paths as each one lands. Entries persist in
// IndexedDB (compressed blob + target ids) so a killed tab/app resumes
// pending uploads the next time a capture page opens.
//
// Invariants:
// - Orphaned storage files are acceptable; lost DB rows/paths are not.
// - Each entry's storage path is generated ONCE, so any re-upload (timeout
//   race, resume after crash) is idempotent — "already exists" = success.
// - photo_paths writes are read-modify-write, serialized per finding
//   through this module (nothing else on the client writes photo_paths),
//   so appends never clobber each other.
// - A deleted finding cancels its entries; an entry that discovers its row
//   is gone cleans up after itself (best-effort file removal).
//
// Module-level singleton: one queue per tab, shared across pages.

import { createClient } from '@/lib/supabase/client'
import { BUCKET, newInspectionPhotoPath, removeInspectionPhotos } from '@/lib/inspections/photos'
import type { CompressedPhoto } from '@/lib/inspections/compress'
import { withTimeout, withTimeoutRetry, randomUuid } from '@/lib/utils/retry'

// Attempts per entry before it parks as 'failed' (tap-to-retry in the UI;
// a later page open also retries from scratch).
const MAX_ATTEMPTS = 5
// Backoff before attempt N+1; the last value repeats.
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000]
// Two lanes: weak uplinks choke on wide parallel uploads (the old
// Promise.all over a whole batch is exactly what stalled), but one photo
// shouldn't serialize a second finding's photos behind it.
const MAX_CONCURRENT_UPLOADS = 2
// storage-js can't abort an in-flight upload; this just frees the lane.
// Generous because a compressed photo on 2G legitimately takes a while.
const UPLOAD_TIMEOUT_MS = 120_000

export type UploadStatus = 'queued' | 'uploading' | 'retrying' | 'failed'

export type UploadEntrySnapshot = {
  id: string
  inspectionId: string
  itemId: string
  status: UploadStatus
  attempts: number
  // Local object URL of the compressed photo — what the UI shows until the
  // upload lands and a signed URL exists.
  previewUrl: string
  error: string | null
}

export type PhotoPathsUpdate = {
  inspectionId: string
  itemId: string
  // The row's full photo_paths after this upload was appended.
  photoPaths: string[]
  uploadedPath: string
  // Object URL of the just-uploaded photo. The subscriber that receives
  // this OWNS it (keeps showing it until a signed URL exists, revokes it
  // on unmount); if nobody is subscribed the queue revokes it itself.
  previewUrl: string
}

export type UploadQueueSubscriber = {
  onChange: (entries: UploadEntrySnapshot[]) => void
  onPathsUpdated?: (update: PhotoPathsUpdate) => void
}

type QueueEntry = {
  id: string
  propertyId: string
  inspectionId: string
  itemId: string
  blob: Blob
  contentType: string
  path: string
  createdAt: number
  status: UploadStatus
  attempts: number
  nextAttemptAt: number
  inFlight: boolean
  canceled: boolean
  previewUrl: string
  error: string | null
}

// ── IndexedDB persistence (best-effort) ──────────────────────
// The in-memory list is the session's source of truth; IndexedDB only
// exists so a killed tab resumes. Every IDB call is allowed to fail
// (private mode, quota, iOS Blob quirks) without breaking uploads.

const DB_NAME = 'c2-inspection-uploads'
const DB_VERSION = 1
const STORE = 'photos'

type PersistedEntry = {
  id: string
  propertyId: string
  inspectionId: string
  itemId: string
  blob: Blob
  contentType: string
  path: string
  createdAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onblocked = () => reject(new Error('IndexedDB blocked'))
  })
}

async function idbWrite(mode: 'put' | 'delete', value: PersistedEntry | string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      if (mode === 'put') tx.objectStore(STORE).put(value)
      else tx.objectStore(STORE).delete(value as string)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
    })
    db.close()
  } catch { /* best-effort — memory queue still uploads this session */ }
}

async function idbGetAll(): Promise<PersistedEntry[]> {
  try {
    const db = await openDb()
    const rows = await new Promise<PersistedEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result ?? []) as PersistedEntry[])
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
    })
    db.close()
    return rows
  } catch {
    return []
  }
}

// ── Queue state ──────────────────────────────────────────────

const entries: QueueEntry[] = []
const subscribers = new Set<UploadQueueSubscriber>()
// Serializes photo_paths read-modify-write per finding (see invariants).
const patchChains = new Map<string, Promise<unknown>>()
let pumpTimer: ReturnType<typeof setTimeout> | null = null
let resumeStarted = false
let visibilityHooked = false

function snapshot(): UploadEntrySnapshot[] {
  return entries
    .filter(e => !e.canceled)
    .map(e => ({
      id: e.id,
      inspectionId: e.inspectionId,
      itemId: e.itemId,
      status: e.status,
      attempts: e.attempts,
      previewUrl: e.previewUrl,
      error: e.error,
    }))
}

function emitChange() {
  const snap = snapshot()
  subscribers.forEach(s => s.onChange(snap))
}

// Returns true if some subscriber took ownership of the preview URL.
function emitPathsUpdated(update: PhotoPathsUpdate): boolean {
  let delivered = false
  subscribers.forEach(s => {
    if (s.onPathsUpdated) { s.onPathsUpdated(update); delivered = true }
  })
  return delivered
}

function removeEntry(entry: QueueEntry, opts: { revokePreview: boolean }) {
  const idx = entries.indexOf(entry)
  if (idx !== -1) entries.splice(idx, 1)
  if (opts.revokePreview) URL.revokeObjectURL(entry.previewUrl)
  void idbWrite('delete', entry.id)
}

// ── Public API ───────────────────────────────────────────────

export function subscribeUploadQueue(subscriber: UploadQueueSubscriber): () => void {
  subscribers.add(subscriber)
  subscriber.onChange(snapshot())
  return () => { subscribers.delete(subscriber) }
}

// Queue a finding's compressed photos for background upload. The finding
// row must already exist (photo_paths appends discover a missing row and
// self-cancel). Returns immediately; progress arrives via subscription.
export function enqueueInspectionPhotos(input: {
  propertyId: string
  inspectionId: string
  itemId: string
  photos: CompressedPhoto[]
}): void {
  const stamp = Date.now()
  input.photos.forEach((photo, i) => {
    const entry: QueueEntry = {
      id: randomUuid(),
      propertyId: input.propertyId,
      inspectionId: input.inspectionId,
      itemId: input.itemId,
      blob: photo.blob,
      contentType: photo.contentType,
      path: newInspectionPhotoPath(input.propertyId, input.inspectionId, stamp, i, photo.ext),
      createdAt: stamp,
      status: 'queued',
      attempts: 0,
      nextAttemptAt: 0,
      inFlight: false,
      canceled: false,
      previewUrl: URL.createObjectURL(photo.blob),
      error: null,
    }
    entries.push(entry)
    void idbWrite('put', {
      id: entry.id,
      propertyId: entry.propertyId,
      inspectionId: entry.inspectionId,
      itemId: entry.itemId,
      blob: entry.blob,
      contentType: entry.contentType,
      path: entry.path,
      createdAt: entry.createdAt,
    })
  })
  emitChange()
  pump()
}

// Reload persisted entries (killed tab/app) and restart uploading. Called
// on capture-page mount; resumes ALL inspections' pending photos, not just
// the open one. Guarded so a remount can't duplicate in-memory entries.
export async function resumePendingUploads(): Promise<void> {
  // iOS Safari throttles timers in background tabs and kills in-flight
  // fetches when the app is pocketed — kick the pump whenever the page
  // comes back so retries don't wait on a stale backoff timer.
  if (typeof document !== 'undefined' && !visibilityHooked) {
    visibilityHooked = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pump()
    })
  }
  if (resumeStarted) { pump(); return }
  resumeStarted = true
  const persisted = await idbGetAll()
  const known = new Set(entries.map(e => e.id))
  persisted.sort((a, b) => a.createdAt - b.createdAt)
  for (const p of persisted) {
    if (known.has(p.id)) continue
    if (!(p.blob instanceof Blob)) { void idbWrite('delete', p.id); continue }
    entries.push({
      ...p,
      status: 'queued',
      attempts: 0,
      nextAttemptAt: 0,
      inFlight: false,
      canceled: false,
      previewUrl: URL.createObjectURL(p.blob),
      error: null,
    })
  }
  emitChange()
  pump()
}

// Un-park a failed entry (tap-to-retry) with a fresh attempt budget.
export function retryUpload(entryId: string): void {
  const entry = entries.find(e => e.id === entryId)
  if (!entry || entry.inFlight || entry.canceled) return
  entry.attempts = 0
  entry.status = 'queued'
  entry.nextAttemptAt = 0
  entry.error = null
  emitChange()
  pump()
}

// Deleting a finding cancels its pending uploads.
export function cancelItemUploads(itemId: string): void {
  cancelWhere(e => e.itemId === itemId)
}

// Deleting a whole inspection cancels everything queued for it.
export function cancelInspectionUploads(inspectionId: string): void {
  cancelWhere(e => e.inspectionId === inspectionId)
}

function cancelWhere(match: (e: QueueEntry) => boolean): void {
  const toCancel = entries.filter(e => match(e) && !e.canceled)
  if (toCancel.length === 0) return
  const paths: string[] = []
  for (const entry of toCancel) {
    entry.canceled = true
    paths.push(entry.path)
    // In-flight entries clean themselves up when their attempt settles
    // (the canceled flag short-circuits the patch); idle ones go now.
    if (!entry.inFlight) removeEntry(entry, { revokePreview: true })
  }
  // Best-effort: some paths may already sit in storage (uploaded but not
  // yet patched, or a timed-out upload that landed anyway). Removing a
  // path that doesn't exist is a harmless no-op; one that lands AFTER this
  // remove is an acceptable orphan.
  void removeInspectionPhotos(createClient(), paths)
  emitChange()
}

// ── Processing ───────────────────────────────────────────────

function pump(): void {
  if (typeof window === 'undefined') return
  const now = Date.now()
  let slots = MAX_CONCURRENT_UPLOADS - entries.filter(e => e.inFlight).length
  for (const entry of entries) {
    if (slots <= 0) break
    if (entry.inFlight || entry.canceled || entry.status === 'failed') continue
    if (entry.nextAttemptAt > now) continue
    // One photo per finding at a time keeps photo_paths near capture order
    // (and the per-item patch chain short).
    if (entries.some(o => o !== entry && o.itemId === entry.itemId && o.inFlight)) continue
    slots--
    void processEntry(entry)
  }
  scheduleNextPump()
}

function scheduleNextPump(): void {
  if (pumpTimer) { clearTimeout(pumpTimer); pumpTimer = null }
  const now = Date.now()
  const waits = entries
    .filter(e => !e.inFlight && !e.canceled && e.status !== 'failed' && e.nextAttemptAt > now)
    .map(e => e.nextAttemptAt - now)
  if (waits.length > 0) pumpTimer = setTimeout(pump, Math.min(...waits) + 50)
}

function isAlreadyUploaded(error: { message?: string; statusCode?: string | number }): boolean {
  return String(error.statusCode ?? '') === '409' || /already exists|duplicate/i.test(error.message ?? '')
}

async function processEntry(entry: QueueEntry): Promise<void> {
  entry.inFlight = true
  entry.attempts++
  entry.status = entry.attempts > 1 ? 'retrying' : 'uploading'
  entry.error = null
  emitChange()
  const supabase = createClient()
  try {
    // 1. Storage upload. The fixed path makes this idempotent: a timed-out
    // request that lands anyway surfaces as "already exists" next attempt,
    // which counts as success.
    const { error } = await withTimeout(
      supabase.storage.from(BUCKET).upload(entry.path, entry.blob, { contentType: entry.contentType }),
      UPLOAD_TIMEOUT_MS,
      'Upload timed out',
    )
    if (error && !isAlreadyUploaded(error)) throw new Error(error.message)

    if (entry.canceled) {
      // Canceled mid-upload — the file may have landed; cancelWhere already
      // issued a best-effort remove, and a late landing is an acceptable
      // orphan.
      entry.inFlight = false
      removeEntry(entry, { revokePreview: true })
      emitChange()
      pump()
      return
    }

    // 2. Append to the row's photo_paths (serialized per finding).
    const outcome = await appendPathSerialized(entry)
    entry.inFlight = false

    if (outcome === 'gone') {
      // The finding row no longer exists (deleted while this was in
      // flight, possibly from another page). Drop every entry targeting
      // it and best-effort remove what we uploaded.
      const siblings = entries.filter(e => e.itemId === entry.itemId)
      for (const s of siblings) {
        s.canceled = true
        if (!s.inFlight) removeEntry(s, { revokePreview: true })
      }
      void removeInspectionPhotos(supabase, [entry.path])
    } else {
      removeEntry(entry, { revokePreview: outcome.previewHandedOff ? false : true })
    }
    // Last entry for this finding gone → its patch chain can go too.
    if (!entries.some(e => e.itemId === entry.itemId)) patchChains.delete(entry.itemId)
    emitChange()
    pump()
  } catch (e) {
    entry.inFlight = false
    if (entry.canceled) {
      removeEntry(entry, { revokePreview: true })
      emitChange()
      pump()
      return
    }
    entry.error = e instanceof Error ? e.message : 'Upload failed'
    if (entry.attempts >= MAX_ATTEMPTS) {
      entry.status = 'failed'
    } else {
      entry.status = 'retrying'
      entry.nextAttemptAt = Date.now() + BACKOFF_MS[Math.min(entry.attempts - 1, BACKOFF_MS.length - 1)]
    }
    emitChange()
    pump()
  }
}

type AppendOutcome = 'gone' | { previewHandedOff: boolean }

function appendPathSerialized(entry: QueueEntry): Promise<AppendOutcome> {
  const prev = patchChains.get(entry.itemId) ?? Promise.resolve()
  const next = prev.then(() => appendPathToItem(entry), () => appendPathToItem(entry))
  // Chain settles regardless of outcome so one failure can't wedge the lane.
  patchChains.set(entry.itemId, next.catch(() => { /* handled by caller */ }))
  return next
}

// Read-modify-write append of entry.path onto the finding's photo_paths.
// Safe because (a) it's serialized per finding via patchChains, and (b)
// nothing else client-side writes photo_paths (the edit modal's payload
// doesn't carry it). Idempotent: a retry that finds its path already
// present is done.
async function appendPathToItem(entry: QueueEntry): Promise<AppendOutcome> {
  if (entry.canceled) return { previewHandedOff: false }
  const supabase = createClient()
  const result = await withTimeoutRetry(async signal => {
    const { data, error } = await supabase.from('inspection_items')
      .select('photo_paths').eq('id', entry.itemId).abortSignal(signal).single()
    if (error) {
      if (error.code === 'PGRST116') return 'gone' as const
      throw new Error(error.message)
    }
    const current = (data?.photo_paths ?? []) as string[]
    if (current.includes(entry.path)) return current
    const nextPaths = [...current, entry.path]
    const { error: updateError } = await supabase.from('inspection_items')
      .update({ photo_paths: nextPaths }).eq('id', entry.itemId).abortSignal(signal)
    if (updateError) throw new Error(updateError.message)
    return nextPaths
  })
  if (result === 'gone') return 'gone'
  const previewHandedOff = emitPathsUpdated({
    inspectionId: entry.inspectionId,
    itemId: entry.itemId,
    photoPaths: result,
    uploadedPath: entry.path,
    previewUrl: entry.previewUrl,
  })
  return { previewHandedOff }
}
