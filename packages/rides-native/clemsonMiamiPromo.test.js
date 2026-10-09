import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLEMSON_MIAMI_END_MS,
  CLEMSON_MIAMI_PROMO_ID,
  CLEMSON_MIAMI_PUBLIC_URL,
  CLEMSON_MIAMI_START_MS,
  clemsonMiamiDriverNotification,
  clemsonMiamiPromoOpen,
  clemsonMiamiRemainingLabel,
} from './clemsonMiamiPromo.js'
import { toDriverCard } from './tripTags.js'

test('clemson miami window is October 3 2026 Eastern through 7:30 PM', () => {
  assert.equal(CLEMSON_MIAMI_PUBLIC_URL, 'https://clemsonrides.com/#/sign-up?ride=clemson-miami')
  assert.equal(clemsonMiamiPromoOpen(new Date(CLEMSON_MIAMI_START_MS)), true)
  assert.equal(clemsonMiamiPromoOpen(new Date(CLEMSON_MIAMI_END_MS)), true)
  assert.equal(clemsonMiamiPromoOpen(new Date(CLEMSON_MIAMI_START_MS - 1)), false)
  assert.equal(clemsonMiamiPromoOpen(new Date(CLEMSON_MIAMI_END_MS + 1)), false)
  assert.equal(clemsonMiamiPromoOpen(new Date('2026-10-04T00:00:00.000Z')), false)
  assert.equal(clemsonMiamiRemainingLabel(new Date('2026-10-03T19:00:00.000Z')), '4 hr 30 min until 7:30 PM')
  assert.equal(clemsonMiamiRemainingLabel(new Date(CLEMSON_MIAMI_END_MS)), '0 min until 7:30 PM')
})

test('driver card flags the promo trip that the local notification reads', () => {
  const promo = toDriverCard({
    id: 'promo',
    status: 'searching',
    fare_cents: 100,
    deposit_cents: 100,
    pickup_label: 'College Avenue, Clemson, South Carolina',
    dropoff_label: 'Clemson Miami game',
    metadata: { promo: CLEMSON_MIAMI_PROMO_ID, promo_ride: true, purpose: 'game_day' },
  })
  assert.equal(promo.promoRide, true)
  assert.equal(promo.fareCents, 100)
  assert.match(promo.pickupLabel, /Clemson/)
  assert.equal(promo.dropoffLabel, 'Clemson Miami game')
  const ordinary = toDriverCard({ id: 'plain', status: 'searching', fare_cents: 2500, metadata: {} })
  assert.equal(ordinary.promoRide, false)
})

test('driver promo notification names the $1 Clemson Miami ride and the time left', () => {
  const note = clemsonMiamiDriverNotification(new Date('2026-10-03T19:00:00.000Z'))
  assert.match(note.title, /promo ride/i)
  assert.match(note.body, /promo ride/i)
  assert.match(note.body, /fare \$1/)
  assert.match(note.body, /within Clemson/)
  assert.match(note.body, /Clemson Miami game/)
  assert.match(note.body, /4 hr 30 min until 7:30 PM/)
})
