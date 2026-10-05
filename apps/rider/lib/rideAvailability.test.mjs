import assert from 'node:assert/strict'
import test from 'node:test'
import { availabilityRequestBody, parseRideAvailability } from './rideAvailability.js'

test('availability requests send places and scheduled_for only', () => {
  const body = availabilityRequestBody({
    scheduledFor: '2026-10-10T01:00:00.000Z',
    pickup: { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 },
    dropoff: { label: 'Sikes Hall', lat: 34.68, lng: -82.84 },
  })
  assert.deepEqual(body, {
    scheduled_for: '2026-10-10T01:00:00.000Z',
    pickup: { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 },
    dropoff: { label: 'Sikes Hall', lat: 34.68, lng: -82.84 },
  })
  const encoded = JSON.stringify(body)
  for (const key of ['fare', 'deposit', 'amount', 'total', 'isStudent', 'discount']) {
    assert.equal(encoded.includes(key), false)
  }
  assert.equal(encoded.includes('0.9'), false)
})

test('availability parser drops unknown tiers and requires both server cents', () => {
  const parsed = parseRideAvailability({
    tiers: ['standard', 'tesla', 'xl', 'pet', 'wait', 'comfort', 'robotaxi', 'standard'],
    quotes: {
      standard: { listCents: 2000, fareCents: 1800 },
      wait: { listCents: 1500, fareCents: 1500 },
      comfort: { fareCents: 2400 },
      tesla: { listCents: 14500, fareCents: 13050 },
    },
  })
  assert.deepEqual(parsed.tiers, ['standard', 'wait', 'comfort'])
  assert.deepEqual(parsed.quotes.standard, { listCents: 2000, fareCents: 1800 })
  assert.equal(parsed.quotes.wait, undefined)
  assert.equal(parsed.quotes.comfort, undefined)
  assert.equal('tesla' in parsed.quotes, false)
  assert.equal(JSON.stringify(parsed).includes('0.9'), false)
})

test('a strikethrough is not derived when the server omits one price', () => {
  const parsed = parseRideAvailability({
    tiers: ['standard'],
    quotes: { standard: { listCents: 1000 } },
  })
  assert.deepEqual(parsed.tiers, ['standard'])
  assert.deepEqual(parsed.quotes, {})
})
