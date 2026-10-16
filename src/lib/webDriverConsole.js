/**
 * Small, pure helpers for the web driver console (/driver) — the bridge
 * until the native Driver app is approved. No network and no React here, so
 * the auth gate, pickup-code check, today's earnings, and Sign in with Apple
 * flag can be unit tested in node.
 */
import { driverRouteForOnboarding } from '../../shared/driverRoute.js'
import { isPickupCode } from '../../shared/pickupBeacon.js'
import { sanitizeCompletedTripForDriver, summarizeDriverEarnings } from './driverEarnings.js'

/** Routes that sign a driver in on the web instead of the rider Google-only screen. */
export const DRIVER_SIGN_IN_ROUTE = 'driver-sign-in'
export const DRIVER_AUTH_PATHS = Object.freeze(['driver', 'earnings', 'driver-payouts', 'driver-w9'])

export function driverSignInTarget(path) {
  return DRIVER_AUTH_PATHS.includes(path) ? DRIVER_SIGN_IN_ROUTE : null
}

/**
 * Only an approved application may use the live console. Every other status
 * (none, pending_info, pending_docs, pending_review, rejected) gets the
 * approval status page. Same rule the server enforces on accept.
 */
export function webDriverConsoleAccess(application) {
  const status = application?.onboarding_status || 'none'
  return driverRouteForOnboarding(application?.onboarding_status) === 'driver'
    ? { allowed: true, status }
    : { allowed: false, status }
}

/**
 * Sign in with Apple on the web needs an Apple Services ID and a client secret
 * in the Supabase Apple provider. Until those exist the button stays hidden.
 * Turn on with VITE_APPLE_WEB_SIGNIN=1 at build time.
 */
export function appleWebSignInEnabled(env) {
  const raw = String(env?.VITE_APPLE_WEB_SIGNIN ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'on'
}

export function normalizePickupCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * The rider's phone shows the trip's pickup code; the driver types what the
 * rider shows. Start unlocks when they match. No code on file (beacon table
 * missing or lookup failed) never blocks a trip, same as the native app.
 */
export function pickupCodeState({ expected, entered }) {
  const code = isPickupCode(expected) ? expected : null
  if (!code) return { required: false, verified: true, mismatch: false }
  const typed = normalizePickupCode(entered)
  const verified = typed === code
  return { required: true, verified, mismatch: typed.length >= code.length && !verified }
}

/** Driver take for trips completed today in Clemson time (America/New_York). */
export function todayDriverEarnings(rows, { now = new Date(), timeZone = 'America/New_York' } = {}) {
  const trips = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.completed_at)
    .map((row) => sanitizeCompletedTripForDriver({ status: 'completed', ...row }))
  const summary = summarizeDriverEarnings(trips, { now, timeZone })
  return { cents: summary.todayEarningsCents, trips: summary.todayTripCount }
}

/** System notification for a new offer when the console tab is in the background. */
export function shouldShowBrowserOfferNotice({ hidden, permission, supported }) {
  return Boolean(supported && hidden && permission === 'granted')
}

export function showBrowserOfferNotice({ title, body, tag }, env = globalThis) {
  const NotificationCtor = env?.Notification
  const doc = env?.document
  const ok = shouldShowBrowserOfferNotice({
    supported: typeof NotificationCtor === 'function',
    hidden: Boolean(doc?.hidden),
    permission: NotificationCtor?.permission,
  })
  if (!ok) return false
  try {
    // eslint-disable-next-line no-new
    new NotificationCtor(title, { body, tag, renotify: true })
    return true
  } catch {
    return false
  }
}

/** Ask once, from the Go online tap (a user gesture). Never throws. */
export async function requestBrowserOfferPermission(env = globalThis) {
  const NotificationCtor = env?.Notification
  if (typeof NotificationCtor !== 'function' || typeof NotificationCtor.requestPermission !== 'function') return 'unsupported'
  if (NotificationCtor.permission !== 'default') return NotificationCtor.permission
  try {
    return await NotificationCtor.requestPermission()
  } catch {
    return 'denied'
  }
}
