import assert from 'node:assert/strict'
import test from 'node:test'
import {
  coarsePlaceLabel,
  firstNameOnly,
  hasRideChat,
  toPublicReport,
  toPublicTrip,
} from './lostFoundPrivacy.js'

test('firstNameOnly extracts first names and capitalizes appropriately', () => {
  assert.equal(firstNameOnly('John Doe'), 'John')
  assert.equal(firstNameOnly('alice smith'), 'Alice')
  assert.equal(firstNameOnly('sarah-jane doe'), 'Sarah-jane')
  assert.equal(firstNameOnly("o'connor test"), "O'connor")
})

test('firstNameOnly parses email handles cleanly', () => {
  assert.equal(firstNameOnly('clemson_tiger@clemson.edu'), 'Clemson')
  assert.equal(firstNameOnly('john.matveyev@gmail.com'), 'John')
  assert.equal(firstNameOnly('student+tag@clemson.edu'), 'Student')
})

test('firstNameOnly falls back safely for short tokens, symbols, or missing inputs', () => {
  assert.equal(firstNameOnly(''), 'Them')
  assert.equal(firstNameOnly(null), 'Them')
  assert.equal(firstNameOnly(undefined, 'Friend'), 'Friend')
  assert.equal(firstNameOnly('J', 'Fallback'), 'Fallback', 'Single-char names fallback')
  assert.equal(firstNameOnly('$$$', 'Fallback'), 'Fallback', 'Symbols only fallback')
})

test('coarsePlaceLabel identifies airports', () => {
  assert.equal(coarsePlaceLabel('GSP Airport Terminal B'), 'GSP Airport')
  assert.equal(coarsePlaceLabel('Greenville-Spartanburg International'), 'GSP Airport')
  assert.equal(coarsePlaceLabel('CLT Airport Departures'), 'CLT Airport')
  assert.equal(coarsePlaceLabel('Charlotte Douglas International'), 'CLT Airport')
  assert.equal(coarsePlaceLabel('Regional airport concourse'), 'Airport')
})

test('coarsePlaceLabel preserves known campus landmarks and housing', () => {
  assert.equal(coarsePlaceLabel('Near Tillman Hall clock tower'), 'Tillman Hall')
  assert.equal(coarsePlaceLabel('Memorial Stadium Gate 1'), 'Memorial Stadium')
  assert.equal(coarsePlaceLabel('Cooper Library 4th floor'), 'Cooper Library')
  assert.equal(coarsePlaceLabel('Bowman Field tailgate spot'), 'Bowman Field')
  assert.equal(coarsePlaceLabel('The Pier clubhouse'), 'The Pier')
  assert.equal(coarsePlaceLabel('114 Earle St lobby'), '114 Earle')
  assert.equal(coarsePlaceLabel("Tiger Town Tavern (Triple T's) patio"), "Tiger Town Tavern (Triple T's)")
  assert.equal(coarsePlaceLabel('The Esso Club parking lot'), 'The Esso Club')
})

test('coarsePlaceLabel strips exact street addresses and apartment numbers', () => {
  assert.equal(coarsePlaceLabel('105 College Ave Apt 4B'), 'Area')
  assert.equal(coarsePlaceLabel('500 Highway 123'), 'Area')
  assert.equal(coarsePlaceLabel('1200 Old Stone Church Rd'), 'Area')
  assert.equal(coarsePlaceLabel('Suite 200, 300 Calhoun St'), 'Area')
  assert.equal(coarsePlaceLabel('224 Parkway Dr'), 'Area')
})

test('coarsePlaceLabel falls back to municipality or generic labels when exact street or long text', () => {
  assert.equal(coarsePlaceLabel('123 Main St, Clemson, SC'), 'Clemson area')
  assert.equal(coarsePlaceLabel('450 Downtown Blvd, Suite 100'), 'Downtown')
  assert.equal(coarsePlaceLabel('999 Campus Way North'), 'Campus')
  assert.equal(coarsePlaceLabel('777 Main St, Simpsonville, SC'), 'Simpsonville area')
  assert.equal(coarsePlaceLabel('Quiet Spot', 'Custom Area'), 'Quiet Spot', 'Non-exact short label preserved')
  assert.equal(coarsePlaceLabel('', 'Custom Area'), 'Custom Area')
  assert.equal(coarsePlaceLabel(null, 'Default'), 'Default')
})

test('hasRideChat detects presence of chat thread identifiers in metadata', () => {
  assert.equal(hasRideChat(null), false)
  assert.equal(hasRideChat(''), false)
  assert.equal(hasRideChat({}), false)
  assert.equal(hasRideChat({ other_field: 123 }), false)
  assert.equal(hasRideChat({ ride_chat_id: 'chat_123' }), true)
  assert.equal(hasRideChat({ chat_thread_id: 'thread_456' }), true)
  assert.equal(hasRideChat({ chat_id: 'c_789' }), true)
  assert.equal(hasRideChat({ ride_chat_id: '   ' }), false, 'Whitespace ID is not valid chat')
})

test('toPublicTrip masks addresses and identifies counter-party roles', () => {
  const tripRow = {
    id: 'trip_100',
    rider_id: 'user_rider_1',
    driver_id: 'user_driver_2',
    pickup_label: '105 College Ave Apt 4B',
    dropoff_label: 'GSP Airport Terminal A',
    completed_at: '2026-03-01T12:00:00Z',
  }

  // Viewed by the rider
  const riderView = toPublicTrip(tripRow, 'user_rider_1', {
    user_driver_2: 'Jane',
  })
  assert.equal(riderView.id, 'trip_100')
  assert.equal(riderView.pickup, 'Pickup area', 'Exact street masked to coarse area')
  assert.equal(riderView.dropoff, 'GSP Airport')
  assert.equal(riderView.otherId, 'user_driver_2')
  assert.equal(riderView.otherFirstName, 'Jane')
  assert.equal(riderView.otherRole, 'driver')
  assert.equal(riderView.completedAt, '2026-03-01T12:00:00Z')

  // Viewed by the driver
  const driverView = toPublicTrip(tripRow, 'user_driver_2', {
    user_rider_1: 'Bob',
  })
  assert.equal(driverView.otherId, 'user_rider_1')
  assert.equal(driverView.otherFirstName, 'Bob')
  assert.equal(driverView.otherRole, 'rider')

  // Missing IDs or invalid inputs
  assert.equal(toPublicTrip(null, 'user_rider_1'), null)
  assert.equal(toPublicTrip(tripRow, null), null)
})

test('toPublicReport sanitizes report details and sets ownership flag', () => {
  const reportRow = {
    id: 'report_50',
    trip_id: 'trip_100',
    status: 'open',
    resolution: null,
    item_description: 'AirPods Pro with orange case',
    support_note: 'Left in backseat',
    created_at: '2026-03-01T14:00:00Z',
    claimed_at: null,
    returned_at: null,
    closed_at: null,
    reporter_id: 'user_rider_1',
    counterpart_id: 'user_driver_2',
  }

  const extras = {
    reporterFirstName: 'Bob',
    counterpartFirstName: 'Jane',
    pickup: 'Downtown',
    dropoff: 'GSP Airport',
    completedAt: '2026-03-01T12:00:00Z',
    hasRideChat: true,
  }

  const publicReport = toPublicReport(reportRow, 'user_rider_1', extras)
  assert.equal(publicReport.id, 'report_50')
  assert.equal(publicReport.tripId, 'trip_100')
  assert.equal(publicReport.itemDescription, 'AirPods Pro with orange case')
  assert.equal(publicReport.reporterFirstName, 'Bob')
  assert.equal(publicReport.counterpartFirstName, 'Jane')
  assert.equal(publicReport.pickup, 'Downtown')
  assert.equal(publicReport.dropoff, 'GSP Airport')
  assert.equal(publicReport.hasRideChat, true)
  assert.equal(publicReport.mine, true)

  const otherUserView = toPublicReport(reportRow, 'user_driver_2', extras)
  assert.equal(otherUserView.mine, false)

  assert.equal(toPublicReport(null, 'user_rider_1'), null)
})
