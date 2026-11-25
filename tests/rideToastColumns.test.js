/**
 * Regression: every signed-in page load sent two PostgREST reads that 400'd
 * (42703): trips.updated_at and ride_bills.status do not exist (prod E2E
 * 2026-10-16). Columns below were read from prod information_schema with the
 * Supabase MCP on 2026-10-16.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  TOAST_BILL_COLUMNS,
  TOAST_TRIP_COLUMNS,
  TOAST_TRIP_POLL_COLUMNS,
  billToastCents,
  billToastStatus,
} from '../src/lib/rideToastQueries.js'

const PROD_RIDE_BILLS = new Set('id trip_id friend_ride_id participant_profile_id participant_id currency base_cents distance_cents time_cents surge_cents surge_multiplier split_cents total_fare_cents distance_m duration_s split_mode payment_method stripe_payment_intent_id line_items charged_at created_at display_name email subtotal_cents platform_fee_cents driver_earnings_cents discount_cents'.split(' '))
const PROD_TRIPS = new Set('id rider_id driver_id status tier pickup_label dropoff_label pickup_lat pickup_lng dropoff_lat dropoff_lng fare_cents deposit_cents passengers flight rider_note scheduled_for requested_at accepted_at completed_at canceled_at stops metadata pickup_at payment_status created_at arrived_at'.split(' '))

const cols = (list) => list.split(',').map((c) => c.trim()).filter(Boolean)

test('toast trip reads use only real trips columns (no updated_at)', () => {
  for (const list of [TOAST_TRIP_COLUMNS, TOAST_TRIP_POLL_COLUMNS]) {
    for (const c of cols(list)) assert.ok(PROD_TRIPS.has(c), `trips.${c} does not exist`)
    assert.ok(!cols(list).includes('updated_at'))
  }
})

test('toast bill reads use only real ride_bills columns (no status / amount_cents)', () => {
  for (const c of cols(TOAST_BILL_COLUMNS)) assert.ok(PROD_RIDE_BILLS.has(c), `ride_bills.${c} does not exist`)
})

test('bill toast state comes from charged_at and the participant share', () => {
  assert.equal(billToastStatus({ id: 'b', charged_at: null }), 'pending')
  assert.equal(billToastStatus({ id: 'b', charged_at: '2026-10-16T17:00:00Z' }), 'charged')
  assert.equal(billToastCents({ split_cents: 450, total_fare_cents: 1800 }), 450)
  assert.equal(billToastCents({ split_cents: null, total_fare_cents: 1800 }), 1800)
  assert.equal(billToastCents({}), 0)
})

test('RideToastWatcher selects through the shared column lists only', () => {
  const src = readFileSync(new URL('../src/components/RideToastWatcher.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /updated_at/)
  assert.doesNotMatch(src, /from\('ride_bills'\)\s*\.select\('/)
  assert.doesNotMatch(src, /from\('trips'\)\s*\.select\('/)
  assert.match(src, /\.select\(TOAST_BILL_COLUMNS\)/)
  assert.match(src, /\.select\(TOAST_TRIP_COLUMNS\)/)
})
