import assert from 'node:assert/strict'
import test from 'node:test'
import { purposeLabel, toDriverQueueCard } from './scheduledRideModel.js'

test('weekend and party purpose is labeled for the driver queue', () => {
  assert.equal(purposeLabel('party_weekend'), 'Weekend / party')
  assert.equal(purposeLabel('airport'), 'Airport')
  const card = toDriverQueueCard({
    id: 'w1',
    status: 'scheduled',
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'GSP Airport',
    fare_cents: 6800,
    pickup_at: '2026-10-03T01:00:00.000Z',
    rider_note: 'party_weekend',
    passengers: 1,
    metadata: { purpose: 'party_weekend', rider_first_name: 'Ava' },
  })
  assert.equal(card.purpose, 'Weekend / party')
  assert.equal(card.pickupLabel, 'Memorial Stadium')
  assert.equal(card.dropoffLabel, 'GSP Airport')
  assert.equal(card.firstName, 'Ava')
})
