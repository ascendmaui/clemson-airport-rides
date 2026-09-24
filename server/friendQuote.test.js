import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  FRIEND_QUOTE_TTL_MS,
  buildFriendQuote,
  clientQuoteRef,
  settleFriendQuote,
} from './friendQuote.js'

const T0 = Date.parse('2026-09-24T15:00:00.000Z')

function quoteAt(cents, { id = 'quote-1', now = T0, rideId = 'ride-1' } = {}) {
  return buildFriendQuote({
    rideId,
    id,
    now,
    participants: [
      { id: 'a', fare_cents: cents[0] },
      { id: 'b', fare_cents: cents[1] },
    ],
  })
}

function rideFor(quote, participants) {
  return {
    id: quote?.ride_id || 'ride-1',
    kind: 'friends',
    total_fare_cents: 9999,
    fare_breakdown: quote ? { friend_quote: quote } : {},
    participants,
  }
}

function people(cents, { extra } = {}) {
  const rows = [
    { id: 'b', fare_cents: cents[1], status: 'joined' },
    { id: 'a', fare_cents: cents[0], status: 'joined' },
  ]
  if (extra) rows.push(extra)
  return rows
}

test('buildFriendQuote stores id, shares, signature, and a 10 minute expiry', () => {
  const quote = quoteAt([850, 851])
  assert.equal(quote.id, 'quote-1')
  assert.equal(quote.ride_id, 'ride-1')
  assert.equal(quote.signature, 'a:850|b:851')
  assert.equal(quote.participant_set, 'a|b')
  assert.equal(quote.shares[0].share_cents, 850)
  assert.equal(Date.parse(quote.expires_at) - Date.parse(quote.created_at), FRIEND_QUOTE_TTL_MS)
  assert.equal(FRIEND_QUOTE_TTL_MS, 10 * 60 * 1000)
})

test('fresh quote charges the stored cents and does not recompute', async () => {
  const quote = quoteAt([850, 851])
  const drifted = people([900, 901])
  let recomputed = 0
  let chargedCents = null
  const outcome = await settleFriendQuote({
    ride: rideFor(quote),
    participants: drifted,
    body: {
      quoteId: 'quote-1',
      quoteSignature: quote.signature,
      fare_cents: 1,
      fareCents: 1,
      amount: 1,
      amountCents: 1,
      amount_cents: 1,
      total_fare_cents: 2,
      share_cents: 1,
      shares: [
        { id: 'a', share_cents: 1 },
        { id: 'b', share_cents: 1 },
      ],
      participants: [
        { id: 'a', fare_cents: 1 },
        { id: 'b', fare_cents: 1 },
      ],
      friend_quote: {
        id: 'quote-1',
        shares: [
          { id: 'a', share_cents: 1 },
          { id: 'b', share_cents: 1 },
        ],
      },
    },
    now: T0 + 60_000,
    recompute: async () => {
      recomputed += 1
      throw new Error('recompute must not run for a fresh quote')
    },
    charge: async ({ participants, ride }) => {
      chargedCents = participants.map((person) => [person.id, person.fare_cents])
      assert.equal(ride.total_fare_cents, 1701)
      return { results: chargedCents }
    },
  })
  assert.equal(recomputed, 0)
  assert.deepEqual(chargedCents, [['b', 851], ['a', 850]])
  assert.equal(outcome.status, 'charged')
  assert.equal(outcome.charged.results[0][1], 851)
})

test('a quote is still fresh at exactly 10 minutes', async () => {
  const quote = quoteAt([850, 850])
  let recomputed = 0
  const outcome = await settleFriendQuote({
    ride: rideFor(quote),
    participants: people([850, 850]),
    body: { quoteId: 'quote-1' },
    now: T0 + FRIEND_QUOTE_TTL_MS,
    recompute: async () => {
      recomputed += 1
      return { ok: false }
    },
    charge: async ({ participants }) => ({
      cents: participants.map((person) => person.fare_cents),
    }),
  })
  assert.equal(recomputed, 0)
  assert.equal(outcome.status, 'charged')
  assert.deepEqual(outcome.charged.cents, [850, 850])
})

test('expired quote re-quotes and requires review with no charge', async () => {
  const quote = quoteAt([850, 851])
  const drifted = quoteAt([860, 861], {
    id: 'quote-2',
    now: T0 + FRIEND_QUOTE_TTL_MS + 1,
  })
  let charged = false
  let recomputed = 0
  const outcome = await settleFriendQuote({
    ride: rideFor(quote),
    participants: people([850, 851]),
    body: {
      quoteId: 'quote-1',
      fare_cents: 1,
      amountCents: 1,
      shares: [{ id: 'a', share_cents: 1 }],
    },
    now: T0 + FRIEND_QUOTE_TTL_MS + 1,
    recompute: async () => {
      recomputed += 1
      return {
        ok: true,
        ride: rideFor(drifted),
        participants: people([860, 861]),
      }
    },
    charge: async () => {
      charged = true
      return {}
    },
  })
  assert.equal(charged, false)
  assert.equal(recomputed, 1)
  assert.equal(outcome.status, 'review_required')
  assert.equal(outcome.reason, 'expired')
  assert.equal(outcome.quote.id, 'quote-2')
  assert.deepEqual(
    outcome.quote.shares.map((share) => share.share_cents),
    [860, 861],
  )
})

test('tampered or unknown quote id requires review and does not charge', async () => {
  const quote = quoteAt([850, 851])
  const next = quoteAt([870, 871], { id: 'quote-next' })
  for (const quoteId of ['quote-tampered', null, undefined]) {
    let charged = false
    const outcome = await settleFriendQuote({
      ride: rideFor(quote),
      participants: people([850, 851]),
      body: { quoteId, fare_cents: 5, amountCents: 5 },
      now: T0 + 1000,
      recompute: async () => ({
        ok: true,
        ride: rideFor(next),
        participants: people([870, 871]),
      }),
      charge: async () => {
        charged = true
        return {}
      },
    })
    assert.equal(charged, false, `charged for quoteId ${quoteId}`)
    assert.equal(outcome.status, 'review_required')
    assert.equal(outcome.reason, 'quote_mismatch')
    assert.equal(outcome.quote.id, 'quote-next')
    assert.notEqual(outcome.quote.shares[0].share_cents, 5)
  }
})

test('a missing stored quote requires review and does not charge', async () => {
  let charged = false
  const next = quoteAt([880, 881], { id: 'quote-new' })
  const outcome = await settleFriendQuote({
    ride: rideFor(null),
    participants: people([100, 100]),
    body: { quoteId: 'quote-1', fare_cents: 100, amountCents: 100 },
    now: T0,
    recompute: async () => ({
      ok: true,
      ride: rideFor(next),
      participants: people([880, 881]),
    }),
    charge: async () => {
      charged = true
      return {}
    },
  })
  assert.equal(charged, false)
  assert.equal(outcome.status, 'review_required')
  assert.equal(outcome.reason, 'missing')
  assert.equal(outcome.quote.id, 'quote-new')
})

test('participant change requires review and does not charge', async () => {
  const quote = quoteAt([850, 851])
  const next = buildFriendQuote({
    rideId: 'ride-1',
    id: 'quote-3',
    now: T0 + 5000,
    participants: [
      { id: 'a', fare_cents: 600 },
      { id: 'b', fare_cents: 600 },
      { id: 'c', fare_cents: 600 },
    ],
  })
  let charged = false
  const outcome = await settleFriendQuote({
    ride: rideFor(quote),
    participants: people([850, 851], { extra: { id: 'c', fare_cents: 1, status: 'joined' } }),
    body: {
      quoteId: 'quote-1',
      quoteSignature: quote.signature,
      fare_cents: 1,
      shares: [{ id: 'c', share_cents: 1 }],
    },
    now: T0 + 5000,
    recompute: async () => ({
      ok: true,
      ride: rideFor(next),
      participants: [
        { id: 'a', fare_cents: 600 },
        { id: 'b', fare_cents: 600 },
        { id: 'c', fare_cents: 600 },
      ],
    }),
    charge: async () => {
      charged = true
      return {}
    },
  })
  assert.equal(charged, false)
  assert.equal(outcome.status, 'review_required')
  assert.equal(outcome.reason, 'participants_changed')
  assert.equal(outcome.quote.id, 'quote-3')
  assert.equal(outcome.quote.shares.length, 3)
})

test('client amount fields are ignored', () => {
  assert.deepEqual(
    clientQuoteRef({
      quoteId: 'quote-1',
      quoteSignature: 'a:850|b:851',
      fare_cents: 1,
      fareCents: 2,
      amount: 3,
      amountCents: 4,
      amount_cents: 5,
      total_fare_cents: 6,
      share_cents: 7,
      shares: [{ id: 'a', share_cents: 1 }],
      participants: [{ id: 'a', fare_cents: 1 }],
      friend_quote: { shares: [{ id: 'a', share_cents: 1 }] },
    }),
    { quoteId: 'quote-1', signature: 'a:850|b:851' },
  )
  assert.deepEqual(clientQuoteRef({ fare_cents: 850, amountCents: 850 }), {
    quoteId: null,
    signature: null,
  })
})

test('a quote stored on a different ride requires review', async () => {
  const quote = quoteAt([850, 851], { rideId: 'ride-other' })
  let charged = false
  const outcome = await settleFriendQuote({
    ride: { ...rideFor(quote), id: 'ride-1' },
    participants: people([850, 851]),
    body: { quoteId: 'quote-1', fare_cents: 1 },
    now: T0 + 1000,
    recompute: async () => ({
      ok: true,
      ride: rideFor(quoteAt([860, 860], { id: 'quote-4' })),
      participants: people([860, 860]),
    }),
    charge: async () => {
      charged = true
      return {}
    },
  })
  assert.equal(charged, false)
  assert.equal(outcome.status, 'review_required')
  assert.equal(outcome.reason, 'ride_mismatch')
})

test('a failed re-quote does not charge', async () => {
  let charged = false
  const outcome = await settleFriendQuote({
    ride: rideFor(null),
    participants: people([850, 851]),
    body: { quoteId: 'missing' },
    now: T0,
    recompute: async () => ({ ok: false, code: 'routes_failed', error: 'no route' }),
    charge: async () => {
      charged = true
      return {}
    },
  })
  assert.equal(charged, false)
  assert.equal(outcome.status, 'reprice_failed')
  assert.equal(outcome.recompute.code, 'routes_failed')
})

test('pricing a friend ride stores friend_quote on the breakdown', () => {
  const source = readFileSync(new URL('./friendRideRecompute.js', import.meta.url), 'utf8')
  assert.match(source, /friend_quote:\s*buildFriendQuote\(/)
})
