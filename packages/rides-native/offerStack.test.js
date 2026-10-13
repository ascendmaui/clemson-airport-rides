import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  DOCUMENT_BANNER_ELEVATION,
  DOCUMENT_BANNER_Z,
  OFFER_CARD_ELEVATION,
  OFFER_CARD_Z,
  dedupeOffersById,
  documentBannersCollapsed,
  homeIsShowingOffer,
  offerAcceptSeconds,
  offerSheetBottomInset,
  offerSheetOwnsBottom,
  setHomeOfferId,
} from './offerStack.js'

const NOW = Date.parse('2026-10-13T15:00:00Z')

test('offers dedupe by trip id and keep the first copy', () => {
  const first = { id: 'trip-1', pickupLabel: 'A' }
  const duplicate = { id: 'trip-1', pickupLabel: 'A again' }
  const other = { id: 'trip-2', pickupLabel: 'B' }
  const unique = dedupeOffersById([first, duplicate, { id: '' }, null, other, { id: 'trip-2' }])
  assert.deepEqual(unique.map((card) => card.id), ['trip-1', 'trip-2'])
  assert.equal(unique[0], first)
})

test('countdown uses server expires_at and ignores a stale local clock', () => {
  const exclusive = offerAcceptSeconds({
    id: 'trip-1',
    offerPhase: 'exclusive',
    offerExpiresAt: new Date(NOW + 114_000).toISOString(),
  }, NOW)
  assert.deepEqual(exclusive, { kind: 'exclusive', seconds: 114 })

  const pool = offerAcceptSeconds({
    id: 'trip-1',
    offerPhase: 'pool',
    offer_expires_at: new Date(NOW + 114_000).toISOString(),
  }, NOW)
  assert.deepEqual(pool, { kind: 'pool', seconds: 114 })

  assert.equal(offerAcceptSeconds({ id: 'trip-1', offerPhase: 'exclusive' }, NOW), null)
  assert.equal(offerAcceptSeconds({ id: 'trip-1', offerPhase: 'pool' }, NOW), null)
})

test('document banners collapse while an offer is showing or the driver is online', () => {
  assert.equal(documentBannersCollapsed({ online: false, offerId: null }), false)
  assert.equal(documentBannersCollapsed({ online: true, offerId: null }), true)
  assert.equal(documentBannersCollapsed({ online: false, offerId: 'trip-1' }), true)
  assert.equal(documentBannersCollapsed({ online: true, offerId: 'trip-1' }), true)
})

test('an offer sheet takes the bottom and clears the home indicator and tab bar', () => {
  assert.equal(offerSheetOwnsBottom({ offerId: null, activeTrip: false }), false)
  assert.equal(offerSheetOwnsBottom({ offerId: 'trip-1', activeTrip: true }), false)
  assert.equal(offerSheetOwnsBottom({ offerId: 'trip-1', activeTrip: false }), true)
  assert.equal(offerSheetBottomInset(34), 106)
  assert.equal(offerSheetBottomInset(0), 72)
  assert.equal(offerSheetBottomInset(Number.NaN), 72)
  const home = readFileSync(new URL('../../apps/driver/app/(tabs)/index.tsx', import.meta.url), 'utf8')
  assert.match(home, /offerSheetOwnsBottom/)
  assert.match(home, /offerSheetBottomInset/)
  assert.match(home, /variant="offer"/)
  assert.match(home, /offerOwnsBottom \? null :/)
})

test('the offer card stacks above document banners', () => {
  assert.ok(OFFER_CARD_Z > DOCUMENT_BANNER_Z)
  assert.ok(OFFER_CARD_ELEVATION > DOCUMENT_BANNER_ELEVATION)
})

test('the home offer suppresses a second banner for the same id', () => {
  setHomeOfferId('trip-1')
  assert.equal(homeIsShowingOffer('trip-1'), true)
  assert.equal(homeIsShowingOffer('trip-2'), false)
  setHomeOfferId(null)
  assert.equal(homeIsShowingOffer('trip-1'), false)
})

test('home and the offer bridge do not invent a local accept countdown', () => {
  const home = readFileSync(new URL('../../apps/driver/app/(tabs)/index.tsx', import.meta.url), 'utf8')
  const bridge = readFileSync(new URL('../../apps/driver/components/OfferBridge.tsx', import.meta.url), 'utf8')
  assert.match(home, /dedupeOffersById/)
  assert.match(home, /offerAcceptSeconds/)
  assert.match(home, /documentBannersCollapsed/)
  assert.match(home, /zIndex: OFFER_CARD_Z/)
  assert.match(home, /elevation: OFFER_CARD_ELEVATION/)
  assert.match(home, /zIndex: DOCUMENT_BANNER_Z/)
  assert.match(home, /bannersCollapsed/)
  assert.doesNotMatch(home, /EXCLUSIVE_SECONDS - Math\.round\(\(tick - seenAt/)
  assert.match(bridge, /offerAcceptSeconds/)
  assert.match(bridge, /homeIsShowingOffer/)
  assert.equal((bridge.match(/s to accept/g) || []).length, 1)
  assert.doesNotMatch(bridge, /EXCLUSIVE_SECONDS - Math\.floor\(\(now - banner\.shownAt\)/)
  assert.doesNotMatch(bridge, /showBanner\(next\)\s*\n\s*if \(alertOk\)/)
})
