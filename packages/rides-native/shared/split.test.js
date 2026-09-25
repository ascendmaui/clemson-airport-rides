import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FRIEND_REVIEW_TTL_MS,
  applyFriendChargeReview,
  friendChargeNeedsReview,
  friendQuoteRef,
  friendQuoteSignature,
  friendSplitPreview,
  liveCarpoolQuote,
  markFriendQuoteReviewed,
  mergeFriendQuote,
  quoteFromRide,
  reviewedFriendQuoteFresh,
  selfParticipantId,
  splitRows,
} from './split.js'

test('re-exports friendSplitPreview constants and functions', () => {
  assert.equal(FRIEND_REVIEW_TTL_MS, 600000)
  assert.equal(typeof applyFriendChargeReview, 'function')
  assert.equal(typeof friendChargeNeedsReview, 'function')
  assert.equal(typeof friendQuoteRef, 'function')
  assert.equal(typeof friendQuoteSignature, 'function')
  assert.equal(typeof friendSplitPreview, 'function')
  assert.equal(typeof markFriendQuoteReviewed, 'function')
  assert.equal(typeof mergeFriendQuote, 'function')
  assert.equal(typeof reviewedFriendQuoteFresh, 'function')

  const sig = friendQuoteSignature({
    participants: [
      { id: 'b', fare_cents: 850 },
      { id: 'a', fare_cents: 850 },
    ],
  })
  assert.equal(sig, 'a:850|b:850')
})

test('quoteFromRide: returns fare_breakdown.carpool when shares present', () => {
  const carpool = {
    shares: [{ id: 'r1', shareCents: 1200, soloCents: 3200 }],
    riderCount: 1,
    totalCents: 1200,
  }
  const ride = {
    id: 'ride-1',
    fare_breakdown: { carpool },
  }
  assert.equal(quoteFromRide(ride), carpool)
})

test('quoteFromRide: returns null when ride or shares are missing or empty', () => {
  assert.equal(quoteFromRide(null), null)
  assert.equal(quoteFromRide(undefined), null)
  assert.equal(quoteFromRide({}), null)
  assert.equal(quoteFromRide({ fare_breakdown: null }), null)
  assert.equal(quoteFromRide({ fare_breakdown: {} }), null)
  assert.equal(quoteFromRide({ fare_breakdown: { carpool: null } }), null)
  assert.equal(quoteFromRide({ fare_breakdown: { carpool: {} } }), null)
  assert.equal(quoteFromRide({ fare_breakdown: { carpool: { shares: null } } }), null)
  assert.equal(quoteFromRide({ fare_breakdown: { carpool: { shares: [] } } }), null)
  assert.equal(quoteFromRide({ fare_breakdown: { carpool: { shares: 'not-an-array' } } }), null)
  assert.equal(quoteFromRide({ fare_breakdown: { carpool: { shares: { 0: 'item' } } } }), null)
})

test('liveCarpoolQuote: prefers stored quote over recomputing', () => {
  const storedCarpool = {
    shares: [{ id: 'stored-1', shareCents: 999 }],
    storedFlag: true,
  }
  const ride = {
    fare_breakdown: { carpool: storedCarpool },
    participants: [
      {
        id: 'p1',
        display_name: 'Alice',
        pickup: { lat: 34.68, lng: -82.83 },
        dropoff: { lat: 34.67, lng: -82.84 },
      },
    ],
  }
  const quote = liveCarpoolQuote(ride)
  assert.equal(quote, storedCarpool)
  assert.equal(quote.storedFlag, true)
})

test('liveCarpoolQuote: builds from participants with lat/lng when no stored quote', () => {
  const ride = {
    participants: [
      {
        id: 'p1',
        display_name: 'Alice Cooper',
        pickup: { lat: 34.68, lng: -82.83 },
        dropoff: { lat: 34.67, lng: -82.84 },
      },
      {
        id: 'p2',
        display_name: 'Bob Marley',
        pickup: { lat: 34.68, lng: -82.83 },
        dropoff: { lat: 34.67, lng: -82.84 },
      },
    ],
  }
  const quote = liveCarpoolQuote(ride)
  assert.ok(quote != null)
  assert.equal(quote.riderCount, 2)
  assert.equal(quote.shares.length, 2)
  assert.equal(quote.shares[0].id, 'p1')
  assert.equal(quote.shares[0].firstName, 'Alice')
  assert.equal(quote.shares[1].id, 'p2')
  assert.equal(quote.shares[1].firstName, 'Bob')
  assert.ok(quote.shares[0].shareCents > 0)
  assert.ok(quote.shares[0].soloCents > 0)
})

test('liveCarpoolQuote: returns null when empty or incomplete', () => {
  assert.equal(liveCarpoolQuote(null), null)
  assert.equal(liveCarpoolQuote(undefined), null)
  assert.equal(liveCarpoolQuote({}), null)
  assert.equal(liveCarpoolQuote({ participants: null }), null)
  assert.equal(liveCarpoolQuote({ participants: [] }), null)
  assert.equal(
    liveCarpoolQuote({
      participants: [{ id: 'p1', pickup: null, dropoff: null }],
    }),
    null,
  )
  assert.equal(
    liveCarpoolQuote({
      participants: [{ id: 'p1', pickup: { lat: 34.68 }, dropoff: null }],
    }),
    null,
  )
  assert.equal(
    liveCarpoolQuote({
      participants: [{ id: 'p1', pickup: { lat: 34.68 }, dropoff: { lat: null } }],
    }),
    null,
  )
  assert.equal(
    liveCarpoolQuote({
      participants: [{ id: 'p1', pickup: { lat: null }, dropoff: { lat: 34.67 } }],
    }),
    null,
  )
})

test('liveCarpoolQuote: filters out incomplete participants and quotes remaining valid riders', () => {
  const ride = {
    participants: [
      {
        id: 'valid',
        display_name: 'Valid Rider',
        pickup: { lat: 34.68, lng: -82.83 },
        dropoff: { lat: 34.67, lng: -82.84 },
      },
      {
        id: 'incomplete',
        display_name: 'No Dropoff',
        pickup: { lat: 34.68, lng: -82.83 },
        dropoff: null,
      },
      {
        id: 'missing-lat',
        display_name: 'Null Lat',
        pickup: { lat: null, lng: -82.83 },
        dropoff: { lat: 34.67, lng: -82.84 },
      },
    ],
  }
  const quote = liveCarpoolQuote(ride)
  assert.ok(quote != null)
  assert.equal(quote.shares.length, 1)
  assert.equal(quote.shares[0].id, 'valid')
})

test('liveCarpoolQuote: BUG? checks lat != null but ignores lng != null, passing incomplete points to engine', () => {
  // BUG?: liveCarpoolQuote checks row?.pickup?.lat != null && row?.dropoff?.lat != null,
  // but does not check lng != null. If lng is missing, quoteCarpool calculates with undefined coords,
  // resulting in NaN for hopM and fares.
  const ride = {
    participants: [
      {
        id: 'p1',
        display_name: 'Missing Lng',
        pickup: { lat: 34.68 },
        dropoff: { lat: 34.67 },
      },
    ],
  }
  const quote = liveCarpoolQuote(ride)
  assert.ok(quote != null)
  assert.equal(quote.shares.length, 1)
  assert.ok(Number.isNaN(quote.shares[0].shareCents))
})

test('liveCarpoolQuote: BUG? does not check ride.kind, attempting carpool engine for kind=friends with coords', () => {
  // BUG?: liveCarpoolQuote does not inspect ride.kind, so a friends ride with coordinate-bearing
  // participants will be quoted through the carpool engine if liveCarpoolQuote is called directly.
  const friendRideWithCoords = {
    kind: 'friends',
    participants: [
      {
        id: 'f1',
        display_name: 'Friend',
        pickup: { lat: 34.68, lng: -82.83 },
        dropoff: { lat: 34.67, lng: -82.84 },
      },
    ],
  }
  const quote = liveCarpoolQuote(friendRideWithCoords)
  assert.ok(quote != null)
  assert.equal(quote.shares.length, 1)
})

test('splitRows: delegates to friendSplitPreview when kind === "friends"', () => {
  const friendRide = {
    kind: 'friends',
    split_mode: 'even',
    total_fare_cents: 1800,
    fare_breakdown: {
      friend_split: {
        shares: [
          { id: 'f1', solo_cents: 2000, share_cents: 900 },
          { id: 'f2', solo_cents: 2000, share_cents: 900 },
        ],
      },
    },
    participants: [
      { id: 'f1', display_name: 'Frank', fare_cents: 900 },
      { id: 'f2', display_name: 'Fiona', fare_cents: 900 },
    ],
  }
  const rows = splitRows(friendRide)
  const preview = friendSplitPreview(friendRide)
  assert.deepEqual(rows, preview.rows)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].id, 'f1')
  assert.equal(rows[0].name, 'Frank')
  assert.equal(rows[0].shareCents, 900)
  assert.equal(rows[0].soloCents, 2000)
  assert.equal(rows[0].savingsCents, 1100)
})

test('splitRows: maps quote.shares with provided savingsCents and firstRideFree', () => {
  const ride = {
    fare_breakdown: {
      carpool: {
        shares: [
          {
            id: 101,
            firstName: 'Sarah',
            shareCents: 1200,
            soloCents: 3200,
            savingsCents: 2000,
            firstRideFree: true,
          },
          {
            id: 102,
            firstName: '',
            shareCents: 1500,
            soloCents: 3500,
            savingsCents: 2000,
            firstRideFree: false,
          },
        ],
      },
    },
  }
  const rows = splitRows(ride)
  assert.deepEqual(rows, [
    {
      id: '101',
      name: 'Sarah',
      shareCents: 1200,
      soloCents: 3200,
      savingsCents: 2000,
      firstRideFree: true,
    },
    {
      id: '102',
      name: 'Rider',
      shareCents: 1500,
      soloCents: 3500,
      savingsCents: 2000,
      firstRideFree: false,
    },
  ])
})

test('splitRows: computes default savingsCents when missing in quote.shares', () => {
  const ride = {
    fare_breakdown: {
      carpool: {
        shares: [
          {
            id: 's1',
            firstName: 'Sam',
            shareCents: 1100,
            soloCents: 3000,
            savingsCents: null,
          },
          {
            id: 's2',
            firstName: 'Max',
            shareCents: 4000,
            soloCents: 3000,
            // savingsCents undefined, shareCents > soloCents clamps to 0
          },
        ],
      },
    },
  }
  const rows = splitRows(ride)
  assert.equal(rows[0].savingsCents, 1900)
  assert.equal(rows[0].firstRideFree, false)
  assert.equal(rows[1].savingsCents, 0)
})

test('splitRows: builds rows from live carpool quote when stored quote is absent', () => {
  const ride = {
    participants: [
      {
        id: 'u1',
        display_name: 'Uma Thurman',
        pickup: { lat: 34.68, lng: -82.83 },
        dropoff: { lat: 34.67, lng: -82.84 },
      },
    ],
  }
  const rows = splitRows(ride)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'u1')
  assert.equal(rows[0].name, 'Uma')
  assert.ok(rows[0].shareCents > 0)
  assert.ok(rows[0].soloCents > 0)
  assert.equal(rows[0].savingsCents, rows[0].soloCents - rows[0].shareCents)
  assert.equal(rows[0].firstRideFree, false)
})

test('splitRows: falls back to participants.fare_cents when no carpool quote exists', () => {
  const ride = {
    participants: [
      { id: 201, display_name: 'Grace Hopper', fare_cents: 1400 },
      { id: 202, display_name: null, fare_cents: 0 },
      { id: 203, display_name: 'No Fare Rider', fare_cents: null },
      { id: 204, display_name: 'Undefined Fare Rider' },
    ],
  }
  const rows = splitRows(ride)
  assert.deepEqual(rows, [
    {
      id: '201',
      name: 'Grace Hopper',
      shareCents: 1400,
      soloCents: null,
      savingsCents: null,
    },
    {
      id: '202',
      name: 'Rider',
      shareCents: 0,
      soloCents: null,
      savingsCents: null,
    },
  ])
})

test('splitRows: returns empty array when ride is null, undefined, or empty', () => {
  assert.deepEqual(splitRows(null), [])
  assert.deepEqual(splitRows(undefined), [])
  assert.deepEqual(splitRows({}), [])
  assert.deepEqual(splitRows({ participants: [] }), [])
  assert.deepEqual(splitRows({ participants: [{ id: 'p1' }] }), [])
})

test('splitRows: BUG? preserves explicit negative savingsCents via nullish coalescing', () => {
  // BUG?: When share.savingsCents is explicitly negative, `share.savingsCents ?? Math.max(0, ...)`
  // evaluates to the negative number rather than clamping at 0.
  const ride = {
    fare_breakdown: {
      carpool: {
        shares: [
          {
            id: 'n1',
            firstName: 'Negative',
            shareCents: 3500,
            soloCents: 3000,
            savingsCents: -500,
          },
        ],
      },
    },
  }
  const rows = splitRows(ride)
  assert.equal(rows[0].savingsCents, -500)
})

test('splitRows: BUG? fallback omits firstRideFree while quote.shares sets a boolean', () => {
  // BUG?: The fallback branch from participants.fare_cents omits firstRideFree entirely,
  // whereas the quote.shares branch always includes firstRideFree: Boolean(share.firstRideFree).
  const ride = {
    participants: [{ id: 'fb1', display_name: 'Fallback Rider', fare_cents: 900 }],
  }
  const rows = splitRows(ride)
  assert.equal(Object.hasOwn(rows[0], 'firstRideFree'), false)
})

test('splitRows: BUG? fallback converts undefined id to string "undefined"', () => {
  // BUG?: String(row.id) returns "undefined" when participant row has no id property.
  const ride = {
    participants: [{ display_name: 'No Id', fare_cents: 750 }],
  }
  const rows = splitRows(ride)
  assert.equal(rows[0].id, 'undefined')
})

test('selfParticipantId: finds participant with is_self', () => {
  const ride = {
    participants: [
      { id: 'user-other', display_name: 'Other', is_self: false },
      { id: 'user-me', display_name: 'Me', is_self: true },
      { id: 'user-another', display_name: 'Another' },
    ],
  }
  assert.equal(selfParticipantId(ride), 'user-me')
})

test('selfParticipantId: returns first matching is_self when multiple are marked self', () => {
  const ride = {
    participants: [
      { id: 'first-self', is_self: true },
      { id: 'second-self', is_self: true },
    ],
  }
  assert.equal(selfParticipantId(ride), 'first-self')
})

test('selfParticipantId: returns null when no participant is self or ride is missing', () => {
  assert.equal(selfParticipantId(null), null)
  assert.equal(selfParticipantId(undefined), null)
  assert.equal(selfParticipantId({}), null)
  assert.equal(selfParticipantId({ participants: null }), null)
  assert.equal(selfParticipantId({ participants: [] }), null)
  assert.equal(
    selfParticipantId({
      participants: [{ id: 'u1', is_self: false }, { id: 'u2' }],
    }),
    null,
  )
})

test('selfParticipantId: BUG? returns null when self participant id is 0 or empty string', () => {
  // BUG?: selfParticipantId uses `self?.id || null`. If self.id is 0 or "",
  // the falsy check returns null instead of preserving the id.
  const rideWithZeroId = {
    participants: [{ id: 0, is_self: true }],
  }
  assert.equal(selfParticipantId(rideWithZeroId), null)

  const rideWithEmptyId = {
    participants: [{ id: '', is_self: true }],
  }
  assert.equal(selfParticipantId(rideWithEmptyId), null)
})
