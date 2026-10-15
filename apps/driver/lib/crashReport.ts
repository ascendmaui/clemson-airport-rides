/**
 * Crash reporting for the driver app's error boundaries.
 * Pure (no React Native imports) so it runs under node:test.
 *
 * The app logs through tagged console.warn lines ('[trip location]', '[auth] ...'),
 * which Expo forwards to device logs and EAS crash reports. Boundaries use the
 * same channel with a '[driver-crash]' tag.
 */

export type CrashScope = 'app' | 'trip' | 'offers' | 'offer-alerts' | 'home'

export type CrashRecord = {
  scope: string
  message: string
  name: string
  componentStack: string | null
  at: string
}

const SECRETISH = /(sk|pk|rk)_(live|test)_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+/g
const MAX_MESSAGE = 300
const MAX_STACK = 1200

/** Strip tokens/keys and cap length so a crash log never leaks a secret or floods logs. */
export function scrubCrashText(value: unknown, max = MAX_MESSAGE): string {
  const text = String(value ?? '').replace(SECRETISH, '[redacted]')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function crashRecord(scope: string, error: unknown, componentStack?: string | null, now: Date = new Date()): CrashRecord {
  const err = error instanceof Error ? error : null
  const raw = err ? err.message : typeof error === 'string' ? error : 'Unknown render error'
  return {
    scope: scope || 'app',
    message: scrubCrashText(raw || 'Unknown render error'),
    name: err?.name || 'Error',
    componentStack: componentStack ? scrubCrashText(componentStack.trim(), MAX_STACK) : null,
    at: now.toISOString(),
  }
}

type Logger = (...args: unknown[]) => void

let lastCrash: CrashRecord | null = null

/** Log a caught render error. Never throws, even if the logger does. */
export function reportCrash(scope: string, error: unknown, componentStack?: string | null, log: Logger = console.warn): CrashRecord {
  const record = crashRecord(scope, error, componentStack)
  lastCrash = record
  try {
    log('[driver-crash]', record.scope, `${record.name}: ${record.message}`, record.componentStack ?? '')
  } catch {
    /* logging must never take the recovery screen down with it */
  }
  return record
}

export function lastCrashRecord(): CrashRecord | null {
  return lastCrash
}

/**
 * Copy for the recovery screen. Online status and trip progress live outside
 * React (presence heartbeat, server trip row, offline action queue), so a
 * crash never takes the driver offline or loses a saved trip tap.
 */
export function recoveryCopy(scope: string, opts: { online?: boolean; onTrip?: boolean } = {}) {
  const where = scope === 'trip'
    ? 'Your trip screen hit a problem.'
    : scope === 'offers' || scope === 'offer-alerts'
      ? 'Ride offers hit a problem.'
      : scope === 'home'
        ? 'Home hit a problem.'
        : 'Clemson Rides hit a problem.'
  const state = scope === 'trip' || opts.onTrip
    ? 'Your trip is still active and saved taps will still send.'
    : opts.online
      ? 'You are still online.'
      : 'Nothing was changed on your account.'
  return { eyebrow: 'SOMETHING WENT WRONG', where, state, action: 'Try again' }
}

/** Boundary state transitions, kept pure for tests. */
export type BoundaryState = { error: unknown | null; nonce: number }
export const initialBoundaryState: BoundaryState = { error: null, nonce: 0 }
export function boundaryCaught(state: BoundaryState, error: unknown): BoundaryState {
  return { error: error ?? new Error('Unknown render error'), nonce: state.nonce }
}
export function boundaryRetried(state: BoundaryState): BoundaryState {
  return { error: null, nonce: state.nonce + 1 }
}

/**
 * Active-trip recovery. The trip screen records the trip it is showing; the root
 * recovery screen offers "Back to my trip", which queues that id so the remounted
 * app reopens the same trip (ActiveTripResume reads it on mount).
 */
let activeTripId: string | null = null
let pendingResumeId: string | null = null

export function rememberActiveTrip(tripId: string | null | undefined) {
  activeTripId = tripId ? String(tripId) : null
}

export function forgetActiveTrip(tripId?: string | null) {
  if (!tripId || activeTripId === tripId) activeTripId = null
}

export function rememberedActiveTrip(): string | null {
  return activeTripId
}

/** Queue a resume into the remembered trip (or the given id). Returns the queued id. */
export function requestTripResume(tripId: string | null = activeTripId): string | null {
  pendingResumeId = tripId || null
  return pendingResumeId
}

/** Read and clear the queued resume, so it fires once. */
export function takeTripResume(): string | null {
  const id = pendingResumeId
  pendingResumeId = null
  return id
}
