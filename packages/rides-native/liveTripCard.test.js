import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  LIVE_TRIP_MAP_HEIGHT,
  liveTripMapChip,
  liveTripMapHeight,
  liveTripRoutePrefix,
  liveTripSecondaryActions,
} from './liveTripCard.js'

test('map chip follows the status label and spins only while searching', () => {
  const searching = liveTripMapChip('searching')
  assert.deepEqual(searching, { label: 'Looking for a driver', tone: 'searching', spinning: true })
  assert.deepEqual(liveTripMapChip('offered'), searching)
  assert.deepEqual(liveTripMapChip('accepted'), { label: 'Driver accepted', tone: 'accepted', spinning: false })
  assert.deepEqual(liveTripMapChip('arriving'), { label: 'En route', tone: 'en_route', spinning: false })
  assert.deepEqual(liveTripMapChip('en_route'), liveTripMapChip('arriving'))
  assert.equal(liveTripMapChip('arrived').tone, 'arrived')
  assert.equal(liveTripMapChip('in_progress').spinning, false)
  assert.equal(liveTripMapChip('completed').label, 'Completed')

  assert.equal(liveTripMapChip(null), null)
  assert.equal(liveTripMapChip(''), null)
  assert.equal(liveTripMapChip('canceled'), null)
  assert.equal(liveTripMapChip('canceled_midride'), null)
  assert.equal(liveTripMapChip('scheduled'), null)
})

test('map stays tall while a chip, a preview, or an accepted driver is on it', () => {
  assert.equal(LIVE_TRIP_MAP_HEIGHT.tracking, 280)
  assert.equal(LIVE_TRIP_MAP_HEIGHT.compact, 220)
  assert.equal(liveTripMapHeight({ preview: true, status: 'searching' }), 280)
  assert.equal(liveTripMapHeight({ status: 'accepted' }), 280)
  assert.equal(liveTripMapHeight({ driverOnMap: true, status: 'canceled' }), 280)
  assert.equal(liveTripMapHeight({ status: 'canceled' }), 220)
  assert.equal(liveTripMapHeight({}), 220)
  assert.equal(liveTripMapHeight({ status: 'arrived' }), 280)
})

test('route prefix is empty once the driver card is showing', () => {
  assert.equal(liveTripRoutePrefix('Sam', false), 'Sam · ')
  assert.equal(liveTripRoutePrefix('  Sam  ', false), 'Sam · ')
  assert.equal(liveTripRoutePrefix('Sam', true), '')
  assert.equal(liveTripRoutePrefix('', false), '')
  assert.equal(liveTripRoutePrefix('   ', false), '')
  assert.equal(liveTripRoutePrefix(null, false), '')
  assert.equal(liveTripRoutePrefix(undefined, true), '')
})

test('secondary actions stay empty until there is something to do', () => {
  assert.deepEqual(liveTripSecondaryActions({}), [])
  assert.deepEqual(liveTripSecondaryActions({ status: 'accepted', tripId: 'trip-1' }), [])
  assert.deepEqual(liveTripSecondaryActions({ status: 'in_progress', tripMissing: true, tripId: 'trip-1' }), [])
  assert.deepEqual(liveTripSecondaryActions({ status: 'canceled_midride', tripId: 'trip-1' }), [])
  assert.deepEqual(liveTripSecondaryActions({ status: 'searching', tripId: 'trip-1', showMessages: false, rateNudge: false }), [])

  assert.deepEqual(
    liveTripSecondaryActions({ status: 'in_progress', tripId: 'trip-1', showMessages: true }),
    [
      { id: 'messages', label: 'Message' },
      { id: 'cancel', label: 'Cancel this ride' },
    ],
  )
  assert.deepEqual(
    liveTripSecondaryActions({ status: 'completed', tripId: 'trip-1', rateNudge: true }),
    [
      { id: 'lost-found', label: 'Left something in the car?' },
      { id: 'rate', label: 'Rate now' },
    ],
  )
  assert.deepEqual(
    liveTripSecondaryActions({ status: 'accepted', tripId: 'trip-1', showMessages: true }),
    [{ id: 'messages', label: 'Message' }],
  )

  for (const action of liveTripSecondaryActions({
    status: 'completed',
    tripId: 'trip-1',
    showMessages: true,
    rateNudge: true,
  })) {
    assert.equal(typeof action.label, 'string')
    assert.ok(action.label.trim().length > 0)
  }
})

test('the web live trip screen uses the chip, the tall map, and the secondary-action list', () => {
  const screen = readFileSync(new URL('../../src/screens/Requested.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
  assert.match(screen, /liveTripMapChip\(status\)/)
  assert.match(screen, /liveTripMapHeight\(/)
  assert.match(screen, /liveTripRoutePrefix\(driver, driverOnCard\)/)
  assert.match(screen, /liveTripSecondaryActions\(/)
  assert.match(screen, /secondaryActions\.length > 0/)
  assert.match(screen, /data-live-trip-chip=\{mapChip\.tone\}/)
  assert.match(screen, /search-map-chip--\$\{mapChip\.tone\}/)
  assert.doesNotMatch(screen, /isMidrideStatus/)
  assert.match(screen, /driverPosition=\{preview \? null : driverPos\}/)
  assert.match(css, /\.search-map-chip \{[^}]*left: 16px/)
  assert.match(css, /\.live-trip-actions__secondary:empty/)
  assert.match(css, /max-width: calc\(100% - 80px\)/)
})
