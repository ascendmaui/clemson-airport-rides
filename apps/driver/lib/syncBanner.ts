/**
 * App-wide "waiting to sync" banner. Driven by the offline action queue:
 * shows while taps are saved without signal, clears once they are sent.
 * Pure, so it runs under node:test.
 */
export type SyncBannerInput = { offline: boolean; pending: number }
export type SyncBannerView = { title: string; body: string; announce: string } | null

export function syncBannerView({ offline, pending }: SyncBannerInput): SyncBannerView {
  const n = Math.max(0, Number(pending) || 0)
  if (n === 0) return null
  const actions = `${n} ${n === 1 ? 'action' : 'actions'} waiting to sync`
  const title = offline ? `No signal · ${actions}` : `Syncing · ${actions}`
  const body = offline
    ? 'Your taps are saved and send in order when signal returns.'
    : 'Sending your saved taps now.'
  return { title, body, announce: `${title}. ${body}` }
}

/** The trip screen shows its own signal note; skip the banner there. */
export function showSyncBannerOn(pathname: string | null | undefined): boolean {
  return !/^\/trip(\/|$|\?)/.test(String(pathname || ''))
}
