import assert from 'node:assert/strict'
import test from 'node:test'
import {
  friendChargeNeedsReview,
  friendSplitPreview,
  mergeFriendQuote,
} from './friendSplitPreview.js'
import { splitRows } from '../../packages/rides-native/shared/split.js'

const quoted = {
  kind: 'friends',
  split_mode: 'even',
  total_fare_cents: 1700,
  fare_breakdown: {
    friend_split: {
      solo_route_cents: 2000,
      shares: [
        { id: 'a', solo_cents: 2000, share_cents: 850, savings_cents: 1150 },
        { id: 'b', solo_cents: 2000, share_cents: 850, savings_cents: 1150 },
      ],
    },
  },
  participants: [
    { id: 'a', display_name: 'Ada', fare_cents: 850 },
    { id: 'b', display_name: 'Bea', fare_cents: 850 },
  ],
}

test('friend preview uses server fare_cents and stored solo only when the share still matches', () => {
  const preview = friendSplitPreview(quoted)
  assert.equal(preview.eachCents, 850)
  assert.equal(preview.totalCents, 1700)
  assert.equal(preview.headline.soloCents, 2000)
  assert.equal(preview.headline.savingsCents, 1150)
  assert.equal(preview.rows[0].name, 'Ada')
  assert.equal(preview.rows[1].shareCents, 850)

  const drifted = friendSplitPreview({
    ...quoted,
    participants: [
      { id: 'a', display_name: 'Ada', fare_cents: 900 },
      { id: 'b', display_name: 'Bea', fare_cents: 850 },
    ],
  })
  assert.equal(drifted.rows[0].shareCents, 900)
  assert.equal(drifted.rows[0].soloCents, null)
  assert.equal(drifted.headline, null)
  assert.equal(drifted.eachCents, null)
})

test('friend preview does not invent a solo when the server did not store one', () => {
  const preview = friendSplitPreview({
    kind: 'friends',
    participants: [{ id: 'a', display_name: 'Ada', fare_cents: 850 }],
  })
  assert.equal(preview.rows.length, 1)
  assert.equal(preview.rows[0].shareCents, 850)
  assert.equal(preview.rows[0].soloCents, null)
  assert.equal(preview.rows[0].savingsCents, null)
  assert.equal(preview.headline, null)
  assert.equal(friendSplitPreview({ kind: 'carpool', participants: quoted.participants }).rows.length, 0)
})

test('friend lobby rows do not fall back to the carpool engine', () => {
  const rows = splitRows({
    kind: 'friends',
    participants: [
      {
        id: 'a',
        display_name: 'Ada',
        pickup: { lat: 34.68, lng: -82.84, label: 'Campus' },
        dropoff: { lat: 34.66, lng: -82.81, label: 'Grand Marc' },
      },
    ],
  })
  assert.deepEqual(rows, [])
})

test('confirm waits until the server shares on screen match the refreshed quote', () => {
  const shown = { kind: 'friends', participants: [{ id: 'a', fare_cents: null }] }
  const priced = { kind: 'friends', participants: [{ id: 'a', fare_cents: 850 }] }
  assert.equal(friendChargeNeedsReview(shown, priced), true)
  assert.equal(friendChargeNeedsReview(priced, priced), false)
  assert.equal(friendChargeNeedsReview(priced, {
    kind: 'friends',
    participants: [{ id: 'a', fare_cents: 860 }],
  }), true)
  assert.equal(friendChargeNeedsReview({ kind: 'carpool' }, { kind: 'carpool', participants: [] }), false)
})

test('merge keeps organizer flags and takes the refreshed fare', () => {
  const merged = mergeFriendQuote(
    { is_organizer: true, participants: [{ id: 'a', fare_cents: null, is_self: true }] },
    { kind: 'friends', participants: [{ id: 'a', fare_cents: 850 }] },
  )
  assert.equal(merged.is_organizer, true)
  assert.equal(merged.participants[0].fare_cents, 850)
  assert.equal(merged.participants[0].is_self, true)
})
