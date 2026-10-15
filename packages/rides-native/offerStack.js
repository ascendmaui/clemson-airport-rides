/**
 * One offer card per trip, countdown from the server expiry, and stacking
 * so the accept control stays above document banners.
 */
import { exclusiveSecondsLeft, poolSecondsLeft } from './offerLadder.js'

/** Above every home banner and card. Android uses elevation; iOS uses zIndex. */
export const OFFER_CARD_Z = 40
export const OFFER_CARD_ELEVATION = 24
export const DOCUMENT_BANNER_Z = 1
export const DOCUMENT_BANNER_ELEVATION = 2

/** Keep the first card for each trip or offer id. Later copies are the same offer. */
export function dedupeOffersById(offers) {
  const seen = new Set()
  const unique = []
  for (const card of offers || []) {
    const id = card && card.id != null ? String(card.id) : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    unique.push(card)
  }
  return unique
}

/**
 * Seconds until the server expires_at. Exclusive phase first, then the pool
 * window. Missing or unparseable expiry returns null — never a local seen-at clock.
 */
export function offerAcceptSeconds(card, nowMs = Date.now()) {
  const exclusive = exclusiveSecondsLeft(card, nowMs)
  if (exclusive != null) return { kind: 'exclusive', seconds: exclusive }
  const pool = poolSecondsLeft(card, nowMs)
  if (pool != null) return { kind: 'pool', seconds: pool }
  return null
}

/** Document and inspection banners collapse while an offer is up or the driver is online. */
export function documentBannersCollapsed({ online = false, offerId = null } = {}) {
  return Boolean(online) || Boolean(offerId)
}

/** The accept sheet owns the bottom of home. END, the queue, and the earnings pill step aside. */
export function offerSheetOwnsBottom({ offerId = null, activeTrip = false } = {}) {
  return Boolean(offerId) && !activeTrip
}

/** Home-indicator inset plus the tab bar the offer sheet has to clear. */
export function offerSheetBottomInset(bottomInset, tabContent = 72) {
  const inset = Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : 0
  const tab = Number.isFinite(tabContent) ? Math.max(0, tabContent) : 0
  return inset + tab
}

let homeOfferId = null

export function setHomeOfferId(id) {
  homeOfferId = id ? String(id) : null
}

export function homeIsShowingOffer(id) {
  if (!id || !homeOfferId) return false
  return homeOfferId === String(id)
}
