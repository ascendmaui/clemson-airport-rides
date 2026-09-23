import assert from 'node:assert/strict'
import test from 'node:test'
import { claimChoices } from './lostFoundFlow.js'
import { coarsePlaceLabel, firstNameOnly, hasRideChat, toPublicReport, toPublicTrip } from './lostFoundPrivacy.js'

const rider = '11111111-1111-1111-1111-111111111111'
const driver = '22222222-2222-2222-2222-222222222222'

test('first names only', () => {
  assert.equal(firstNameOnly('Alex Johnson'), 'Alex')
  assert.equal(firstNameOnly('mary anne'), 'Mary')
  assert.equal(firstNameOnly('a@clemson.edu'), 'Them')
  assert.equal(firstNameOnly(''), 'Them')
})

test('coarse places hide street addresses after a ride', () => {
  assert.equal(coarsePlaceLabel('1900 GSP Dr', 'Dropoff area'), 'GSP Airport')
  assert.equal(coarsePlaceLabel('CLT Airport arrivals', 'Dropoff area'), 'CLT Airport')
  assert.equal(coarsePlaceLabel('120 College Ave', 'Pickup area'), 'Pickup area')
  assert.equal(coarsePlaceLabel('Memorial Stadium'), 'Memorial Stadium')
  assert.equal(coarsePlaceLabel('88 Main St Apt 4', 'Pickup area'), 'Pickup area')
  assert.doesNotMatch(coarsePlaceLabel('410 Cedar Ln, Clemson, SC 29631'), /\d/)
})

test('public trip drops coordinates and last names', () => {
  const pub = toPublicTrip({
    id: 'trip-1',
    rider_id: rider,
    driver_id: driver,
    pickup_label: '55 Newman Rd',
    dropoff_label: '1900 GSP Dr',
    pickup_lat: 34.68,
    pickup_lng: -82.83,
    completed_at: '2026-09-01T18:00:00Z',
  }, rider, { [driver]: 'Jordan' })
  assert.equal(pub.otherFirstName, 'Jordan')
  assert.equal(pub.pickup, 'Pickup area')
  assert.equal(pub.dropoff, 'GSP Airport')
  assert.equal(pub.otherId, driver)
  assert.equal('pickup_lat' in pub, false)
  assert.equal('pickup_label' in pub, false)
  assert.equal(JSON.stringify(pub).includes('Johnson'), false)
  assert.equal(JSON.stringify(pub).includes('55'), false)
})

test('claim flow: other party confirms found or not found, then return', () => {
  const open = { status: 'open', reporterId: rider, counterpartId: driver }
  const asDriver = claimChoices(open, driver)
  assert.equal(asDriver.canConfirmFound, true)
  assert.equal(asDriver.canConfirmNotFound, true)
  assert.equal(asDriver.canMessage, false)
  const asRider = claimChoices(open, rider)
  assert.equal(asRider.canConfirmFound, false)
  assert.equal(asRider.canWithdraw, true)

  const claimed = { status: 'claimed', reporterId: rider, counterpartId: driver }
  const arrange = claimChoices(claimed, rider)
  assert.equal(arrange.canMessage, true)
  assert.equal(arrange.canSupportNote, true)
  assert.equal(arrange.canMarkReturned, true)
  assert.equal(arrange.canConfirmFound, false)

  const returned = claimChoices({ status: 'returned', reporterId: rider, counterpartId: driver }, driver)
  assert.equal(returned.canClose, true)
  assert.equal(returned.canMarkReturned, false)

  const closed = claimChoices({ status: 'closed', reporterId: rider, counterpartId: driver }, driver)
  assert.deepEqual(Object.values(closed).every((v) => v === false), true)
})

test('report view keeps first names and never a street number', () => {
  const view = toPublicReport({
    id: 'r1',
    trip_id: 't1',
    reporter_id: rider,
    counterpart_id: driver,
    item_description: 'Orange lanyard',
    status: 'open',
    resolution: null,
    support_note: null,
    created_at: '2026-09-01T18:00:00Z',
    claimed_at: null,
    returned_at: null,
    closed_at: null,
  }, rider, {
    reporterFirstName: 'Alex',
    counterpartFirstName: 'Jordan',
    pickup: 'Campus',
    dropoff: 'GSP Airport',
  })
  assert.equal(view.reporterFirstName, 'Alex')
  assert.equal(view.counterpartFirstName, 'Jordan')
  assert.equal(JSON.stringify(view).includes('lanyard'), true)
  assert.equal(JSON.stringify(view).includes('Ave'), false)
})

test('ride chat is optional', () => {
  assert.equal(hasRideChat(null), false)
  assert.equal(hasRideChat({}), false)
  assert.equal(hasRideChat({ ride_chat_id: 'thread-1' }), true)
})
