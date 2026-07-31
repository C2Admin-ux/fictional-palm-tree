// Stall protection for capture-path network calls.
//
// Onsite connectivity is flaky: a request that would eventually succeed can
// also hang for minutes, and an indefinite spinner in the field reads as
// "the app is broken". These helpers bound every attempt with a timeout and
// retry with backoff, so the UI can show a visible "Retrying…" state and
// either succeed or fail within a predictable window.

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_ATTEMPTS = 3
// Backoff before retry N (1-indexed); the last value repeats.
const RETRY_BACKOFF_MS = [1_000, 3_000]

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Abort errors surface with browser-internal wording ("signal is aborted
// without reason") — translate to something actionable in the field.
function normalizeError(e: unknown): Error {
  if (e instanceof Error) {
    return /abort/i.test(`${e.name} ${e.message}`)
      ? new Error('Timed out — check your connection and try again.')
      : e
  }
  return new Error('Request failed — check your connection and try again.')
}

// Run `run` with a fresh ~10s AbortSignal per attempt, retrying with backoff
// on ANY failure (timeouts and transient network errors are the norm here;
// a deterministic error just repeats quickly and then surfaces). `run` must
// throw on failure — Supabase-style `{ error }` results should be converted
// by the caller. IMPORTANT: retried writes must be idempotent (updates with
// fixed payloads, or inserts with a client-generated id so a timed-out
// attempt that actually landed is detected as a duplicate, not re-inserted).
export async function withTimeoutRetry<T>(
  run: (signal: AbortSignal) => Promise<T>,
  opts: {
    attempts?: number
    timeoutMs?: number
    // Called before each retry wait; retryIndex is 1 for the first retry.
    onRetry?: (retryIndex: number) => void
  } = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      opts.onRetry?.(attempt)
      await sleep(RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)])
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await run(controller.signal)
    } catch (e) {
      lastError = e
    } finally {
      clearTimeout(timer)
    }
  }
  throw normalizeError(lastError)
}

// Bound a promise that cannot be aborted (e.g. storage uploads — storage-js
// exposes no AbortSignal). The underlying request may still land after the
// timeout fires; callers must be idempotent about that.
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      err => { clearTimeout(timer); reject(err) },
    )
  })
}

// crypto.randomUUID with an RFC-4122-shaped fallback for older WebKit
// (pre-15.4). Used for client-generated row ids that make insert retries
// duplicate-detectable, and for upload-queue entry ids.
export function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
