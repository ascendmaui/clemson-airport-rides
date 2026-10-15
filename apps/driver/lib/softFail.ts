/**
 * Non-blocking failure handling for the driver app.
 *
 * - logSoft / quiet: a background failure the driver cannot act on is still logged
 *   ('[driver] <tag>') instead of vanishing in an empty catch.
 * - failureToast: a driver action that failed (accept, start, arrive, end, go online,
 *   cash out, documents) shows an error toast; tapping it retries.
 * - withRetry: bounded retries with backoff for idempotent calls (reads, location).
 *
 * Relative imports keep this file runnable under node:test.
 */
import { showToast } from '../../../packages/rides-native/toastStore.js'
import { isUserFacing } from '../../../packages/rides-native/apiErrors.js'

type Logger = (...args: unknown[]) => void

export const NETWORK_HINT = 'Check your signal and try again.'

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return ''
}

/** A short driver-facing sentence; technical or secret-looking text becomes the fallback. */
export function driverErrorText(err: unknown, fallback: string): string {
  const text = rawMessage(err).trim()
  if (!text || text.length > 160 || !isUserFacing(text)) return fallback
  if (/network request failed|failed to fetch|load failed|timed out|timeout/i.test(text)) return `${fallback} ${NETWORK_HINT}`
  return text
}

export function logSoft(tag: string, err: unknown, log: Logger = console.warn) {
  try {
    const text = rawMessage(err) || String(err ?? 'unknown error')
    log(`[driver] ${tag}`, text.slice(0, 300))
  } catch {
    /* logging never throws */
  }
}

/** Drop-in for `.catch(() => {})`: still non-blocking, but logged. */
export function quiet(tag: string, log: Logger = console.warn) {
  return (err: unknown) => { logSoft(tag, err, log) }
}

type ToastFn = typeof showToast

export type FailureToast = {
  /** Stable key so repeated failures of one action merge instead of stacking. */
  key: string
  title: string
  err?: unknown
  fallback: string
  retry?: (() => void) | null
}

export function failureToast(input: FailureToast, toast: ToastFn = showToast, log: Logger = console.warn) {
  logSoft(input.key, input.err, log)
  const body = driverErrorText(input.err, input.fallback)
  return toast({
    tone: 'error',
    key: `driver-fail:${input.key}`,
    title: input.title,
    body: input.retry ? `${body} Tap to retry.` : body,
    durationMs: 6000,
    onPress: input.retry ? () => { input.retry?.() } : undefined,
  })
}

export type RetryOptions = {
  attempts?: number
  baseMs?: number
  /** Return false to stop retrying (e.g. a 4xx that will not change). */
  shouldRetry?: (err: unknown, attempt: number) => boolean
  sleep?: (ms: number) => Promise<void>
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Not worth retrying: auth, permission, validation, or a state change the server rejected. */
export function isPermanentFailure(err: unknown): boolean {
  const status = Number((err as { status?: unknown })?.status)
  if (Number.isFinite(status) && status >= 400 && status < 500 && status !== 408 && status !== 429) return true
  return /sign in|not allowed|permission|forbidden|unauthori[sz]ed|already|changed|no longer|invalid/i.test(rawMessage(err))
}

/** Run an idempotent call with bounded exponential backoff. Rethrows the last error. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3)
  const baseMs = opts.baseMs ?? 600
  const sleep = opts.sleep ?? wait
  const shouldRetry = opts.shouldRetry ?? ((err: unknown) => !isPermanentFailure(err))
  let last: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (attempt >= attempts || !shouldRetry(err, attempt)) break
      await sleep(baseMs * 2 ** (attempt - 1))
    }
  }
  throw last
}

/** Toast title for a failed trip step, named for the button the driver tapped. */
export function tripStepFailureTitle(status: string | null | undefined): string {
  switch (status) {
    case 'accepted': return 'Could not mark arriving'
    case 'arriving': return 'Could not mark arrived'
    case 'arrived': return 'Could not start the trip'
    case 'in_progress': return 'Could not end the trip'
    default: return 'Could not update this trip'
  }
}

/** Drop-in for `.catch(() => null)`: logs, then resolves to the fallback. */
export function quietly<T>(tag: string, fallback: T, log: Logger = console.warn) {
  return (err: unknown): T => { logSoft(tag, err, log); return fallback }
}
