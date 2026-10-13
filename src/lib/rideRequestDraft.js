const KEY = 'clemson.pendingRideRequest'

/** Remember a pick-driver request while the rider adds a card. */
export function saveRideRequestDraft(draft) {
  if (typeof sessionStorage === 'undefined' || !draft) return
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft))
  } catch {
    /* private mode */
  }
}

export function peekRideRequestDraft() {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Route params that reopen pick-driver with the same selections. */
export function consumeRideRequestDraft() {
  const draft = peekRideRequestDraft()
  if (!draft) return null
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  return {
    dest: draft.dest || '',
    pickup: draft.pickup || '',
    tier: draft.tier || '',
    passengers: draft.passengers || '',
    listCents: draft.listCents || '',
    pickupLat: draft.pickupLat || '',
    pickupLng: draft.pickupLng || '',
    destLat: draft.destLat || '',
    destLng: draft.destLng || '',
    billing: draft.billing || '',
    driver: draft.driverId || '',
    tip: draft.tip != null ? String(draft.tip) : '',
  }
}
