/**
 * Offline banner copy and the "show within 2s" budget.
 * Pure, so node:test can load it without NetInfo.
 */

export const OFFLINE_BANNER_BUDGET_MS = 2000

/** No debounce. The banner paints on the NetInfo event, inside the 2s budget. */
export const OFFLINE_BANNER_DELAY_MS = 0

export type NetSnapshot = {
  isConnected: boolean | null
  isInternetReachable: boolean | null
}

export type OfflineBannerView = {
  title: string
  body: string
  announce: string
}

export function isOfflineSnapshot(snapshot: NetSnapshot | null | undefined): boolean {
  if (!snapshot) return false
  if (snapshot.isConnected === false) return true
  if (snapshot.isInternetReachable === false) return true
  return false
}

export function offlineBannerView(offline: boolean): OfflineBannerView | null {
  if (!offline) return null
  const title = 'No signal'
  const body = 'You are offline. Ride actions retry when Clemson Rides reconnects.'
  return { title, body, announce: `${title}. ${body}` }
}

/** True once the banner is due. The delay is 0, so it is due on the same turn the link drops. */
export function bannerVisible(offline: boolean, elapsedMs: number): boolean {
  if (!offline || elapsedMs < OFFLINE_BANNER_DELAY_MS) return false
  return true
}

/** Permission denials are not fixed by a network return. */
export function retryableFailure(message: string | null | undefined): boolean {
  const text = String(message || '').trim()
  if (!text) return false
  if (/permission/i.test(text)) return false
  return true
}
