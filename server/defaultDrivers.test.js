import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PRIMARY_DEFAULT_DRIVER_EMAIL,
  SECONDARY_DEFAULT_DRIVER_EMAIL,
  chooseDefaultDriver,
  defaultDriverOrder,
  isDefaultDriverUnavailable,
  isKimMauiGmail,
  prepareDefaultDriverRow,
  resolveSecondaryEmail,
  withDefaultDriver,
} from './defaultDrivers.js'

const JOHN = PRIMARY_DEFAULT_DRIVER_EMAIL
const KIM = SECONDARY_DEFAULT_DRIVER_EMAIL

test('default order is John then the spoken Kim Gmail', () => {
  assert.deepEqual(defaultDriverOrder([]), [JOHN, KIM])
  assert.equal(isKimMauiGmail(KIM), true)
  assert.equal(isKimMauiGmail('kim.maui@gmail.com'), true)
  assert.equal(isKimMauiGmail('kim@gmail.com'), false)
  assert.equal(isKimMauiGmail('maui@gmail.com'), false)
  assert.equal(isKimMauiGmail('kimubermaui@clemson.edu'), false)
  assert.equal(resolveSecondaryEmail(['kim.maui@gmail.com', KIM]), KIM)
  assert.equal(resolveSecondaryEmail(['kim.maui@gmail.com']), 'kim.maui@gmail.com')
  assert.equal(resolveSecondaryEmail(['kim.maui@gmail.com', 'kim-maui-other@gmail.com']), KIM)
})

test('unavailable means offline, not approved, or a failed availability read', () => {
  assert.equal(isDefaultDriverUnavailable({ approved: true, online: true, availabilityError: null }), false)
  assert.equal(isDefaultDriverUnavailable({ approved: true, online: false, availabilityError: null }), true)
  assert.equal(isDefaultDriverUnavailable({ approved: false, online: true, availabilityError: null }), true)
  assert.equal(isDefaultDriverUnavailable({ approved: true, online: true, availabilityError: 'timeout' }), true)
})

function memorySb(tables) {
  return {
    from(table) {
      const rows = tables[table] || []
      let pattern = null
      const eqs = []
      const api = {
        select() { return api },
        ilike(_col, value) {
          pattern = String(value || '').toLowerCase()
          return api
        },
        eq(col, val) {
          eqs.push([col, val])
          return api
        },
        maybeSingle() {
          const found = rows.find((row) => eqs.every(([col, val]) => row[col] === val)) || null
          return Promise.resolve({ data: found, error: null })
        },
        then(resolve, reject) {
          const data = rows.filter((row) => {
            if (!pattern) return true
            if (!pattern.includes('%')) return String(row.email || '').toLowerCase() === pattern
            const parts = pattern.split('%').filter(Boolean)
            const email = String(row.email || '').toLowerCase()
            let from = 0
            for (const part of parts) {
              const at = email.indexOf(part, from)
              if (at < 0) return false
              from = at + part.length
            }
            return true
          })
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return api
    },
  }
}

function approvedOnline(id, online = true) {
  return {
    driver_applications: [{ profile_id: id, onboarding_status: 'approved' }],
    driver_status: [{ driver_id: id, online }],
  }
}

test('an available John is assigned even when Kim is also available', async () => {
  const sb = memorySb({
    profiles: [
      { id: 'john-id', email: 'JohnMatveyev@gmail.com' },
      { id: 'kim-id', email: KIM },
    ],
    driver_applications: [
      { profile_id: 'john-id', onboarding_status: 'approved' },
      { profile_id: 'kim-id', onboarding_status: 'approved' },
    ],
    driver_status: [
      { driver_id: 'john-id', online: true },
      { driver_id: 'kim-id', online: true },
    ],
  })
  const choice = await chooseDefaultDriver(sb)
  assert.equal(choice.driverId, 'john-id')
  assert.equal(choice.email, JOHN)
  const row = withDefaultDriver({ status: 'searching', pickup_label: 'Memorial Stadium' }, choice)
  assert.equal(row.driver_id, 'john-id')
  assert.equal(row.status, 'requested')
  assert.equal(row.metadata.match, 'default')
})

test('offline or unapproved John falls through to Kim', async () => {
  const offline = memorySb({
    profiles: [
      { id: 'john-id', email: JOHN },
      { id: 'kim-id', email: 'kim.maui@gmail.com' },
    ],
    ...approvedOnline('john-id', false),
    driver_applications: [
      { profile_id: 'john-id', onboarding_status: 'approved' },
      { profile_id: 'kim-id', onboarding_status: 'approved' },
    ],
    driver_status: [
      { driver_id: 'john-id', online: false },
      { driver_id: 'kim-id', online: true },
    ],
  })
  const kim = await chooseDefaultDriver(offline)
  assert.equal(kim.email, 'kim.maui@gmail.com')
  assert.equal(kim.driverId, 'kim-id')
  assert.equal(kim.considered[0].reason, 'offline')

  const pending = memorySb({
    profiles: [
      { id: 'john-id', email: JOHN },
      { id: 'kim-id', email: KIM },
    ],
    driver_applications: [
      { profile_id: 'john-id', onboarding_status: 'pending_review' },
      { profile_id: 'kim-id', onboarding_status: 'approved' },
    ],
    driver_status: [
      { driver_id: 'john-id', online: true },
      { driver_id: 'kim-id', online: true },
    ],
  })
  const next = await chooseDefaultDriver(pending)
  assert.equal(next.driverId, 'kim-id')
  assert.equal(next.considered[0].reason, 'not_approved')
})

test('a failed availability read skips John and does not invent a driver when Kim has no profile', async () => {
  const sb = {
    from(table) {
      const api = {
        select() { return api },
        ilike() { return api },
        eq() { return api },
        maybeSingle() {
          if (table === 'driver_applications') {
            return Promise.resolve({ data: null, error: { message: 'application read failed' } })
          }
          return Promise.resolve({ data: { online: true }, error: null })
        },
        then(resolve, reject) {
          const data = table === 'profiles' ? [{ id: 'john-id', email: JOHN }] : []
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return api
    },
  }
  const choice = await chooseDefaultDriver(sb)
  assert.equal(choice.driverId, null)
  assert.equal(choice.secondaryEmail, KIM)
  assert.equal(choice.considered[0].reason, 'availability_check_failed')
  assert.equal(choice.considered[1].reason, 'no_profile')
  assert.equal(choice.considered[1].profileExists, false)
  assert.equal(choice.considered[1].approved, false)
})

test('new-ride endpoints assign the default driver and notify that driver', () => {
  const files = [
    new URL('./endpoints/scheduleTrip.js', import.meta.url),
    new URL('./endpoints/airportCheckout.js', import.meta.url),
    new URL('../api/create-checkout-session.js', import.meta.url),
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /prepareDefaultDriverRow/)
    assert.match(source, /notifyPreparedAssignment/)
  }
  const request = readFileSync(new URL('./endpoints/requestDriverTrip.js', import.meta.url), 'utf8')
  assert.doesNotMatch(request, /prepareDefaultDriverRow/)
})

test('prepareDefaultDriverRow leaves an explicit driver and a scheduled status alone', async () => {
  const pinned = await prepareDefaultDriverRow(null, { driver_id: 'chosen', status: 'requested' })
  assert.equal(pinned.skipped, 'already_assigned')
  assert.equal(pinned.row.driver_id, 'chosen')

  const sb = memorySb({
    profiles: [{ id: 'john-id', email: JOHN }],
    driver_applications: [{ profile_id: 'john-id', onboarding_status: 'approved' }],
    driver_status: [{ driver_id: 'john-id', online: true }],
  })
  const scheduled = await prepareDefaultDriverRow(sb, { status: 'scheduled', pickup_label: 'Memorial Stadium' })
  assert.equal(scheduled.row.driver_id, 'john-id')
  assert.equal(scheduled.row.status, 'scheduled')

  const broken = await prepareDefaultDriverRow({ from() { throw new Error('no table') } }, { status: 'searching' })
  assert.equal(broken.row.status, 'searching')
  assert.equal(broken.row.driver_id, undefined)
  assert.match(broken.error, /no table/)
})
