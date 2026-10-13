import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { toCounterpartView } from '../packages/rides-native/partyProfile.js'
import { notifyTripCounterpart } from '../server/tripMessageNotify.js'
import { sweepTripStatusNotices } from '../server/tripStatusNotices.js'
import { nameInitials } from '../shared/driverPortrait.js'
import {
  riderDriverFirstName,
  riderDriverLeaks,
  sanitizeRiderNotice,
  selectRiderDriver,
} from '../shared/riderDriverPrivacy.js'

const PHONE = '8645550199'
const LAST = 'Rivera'

test('rider-facing driver objects keep the first name and drop phone and last name', () => {
  assert.equal(riderDriverFirstName('Alex Rivera'), 'Alex')
  assert.equal(riderDriverFirstName('Rivera, Alex'), 'Alex')
  assert.equal(riderDriverFirstName('Dr. Ada Lovelace'), 'Ada')
  assert.equal(riderDriverFirstName('A. Rivera', 'Driver'), 'Driver')
  assert.equal(riderDriverFirstName('alex.rivera@clemson.edu'), 'alex')
  assert.equal(nameInitials('Jordan Hale'), 'J')
  assert.equal(nameInitials('A. Rivera'), '?')

  const card = selectRiderDriver({
    id: 'driver-1',
    full_name: 'Alex Rivera',
    fullName: 'Alex Rivera',
    last_name: LAST,
    lastName: LAST,
    phone: PHONE,
    phone_number: PHONE,
    email: 'alex.rivera@clemson.edu',
    make: 'Honda',
    plate: 'TGR1',
  })
  assert.equal(card.first_name, 'Alex')
  assert.equal(card.name, 'Alex')
  assert.equal(card.make, 'Honda')
  assert.equal(riderDriverLeaks(card), false)
  assert.equal(JSON.stringify(card).includes(LAST), false)
  assert.equal(JSON.stringify(card).includes(PHONE), false)
  for (const key of ['phone', 'last_name', 'lastName', 'email', 'full_name', 'fullName']) {
    assert.equal(key in card, false, key)
  }

  const view = toCounterpartView({
    id: 'driver-1',
    full_name: 'Alex Rivera',
    phone: PHONE,
    last_name: LAST,
    rating_avg: 4.9,
    rating_count: 8,
  }, { viewerIsRider: true })
  assert.equal(view.name, 'Alex')
  assert.equal(view.roleLabel, 'Your driver')
  assert.equal('phone' in view, false)
  assert.equal('last_name' in view, false)
  assert.equal(riderDriverLeaks(view), false)
  assert.equal(JSON.stringify(view).includes(LAST), false)
  assert.equal(JSON.stringify(view).includes(PHONE), false)

  const riderSeenByDriver = toCounterpartView({
    full_name: 'Sam Okonkwo',
    phone: '8645551212',
  })
  assert.equal(riderSeenByDriver.name, 'Sam')
  assert.equal(riderSeenByDriver.phone, '(864) 555-1212')
})

test('rider push and email payloads do not carry a driver phone or last name', () => {
  const notice = sanitizeRiderNotice({
    to: 'ExponentPushToken[rider]',
    title: 'Alex is on the way',
    body: 'Heading to Cooper Library.',
    driverName: 'Alex Rivera',
    driver_name: 'Alex Rivera',
    name: 'Alex Rivera',
    phone: PHONE,
    last_name: LAST,
    email: 'alex.rivera@clemson.edu',
    data: {
      tripId: 't1',
      kind: 'driver_en_route',
      status: 'arriving',
      phone: PHONE,
      driver_phone: PHONE,
      driver_name: 'Alex Rivera',
      full_name: 'Alex Rivera',
    },
  })
  assert.equal(notice.driverName, 'Alex')
  assert.equal(notice.driver_name, 'Alex')
  assert.equal(notice.name, 'Alex')
  assert.equal(notice.data.driver_name, 'Alex')
  assert.equal(notice.data.tripId, 't1')
  assert.equal(riderDriverLeaks(notice), false)
  const encoded = JSON.stringify(notice)
  assert.equal(encoded.includes(LAST), false)
  assert.equal(encoded.includes(PHONE), false)
  assert.equal(encoded.includes('full_name'), false)
})

test('a status push and a trip-message email sent to a rider omit the driver phone and surname', async () => {
  const now = new Date('2026-10-09T15:00:00Z')
  const recent = new Date(now.getTime() - 5_000).toISOString()
  const tables = {
    trip_status_notices: [
      { id: 1, trip_id: 't1', kind: 'driver_en_route', recipient_id: 'r1', recipient_role: 'rider', driver_id: 'd1', created_at: recent, claimed_at: null, sent_at: null, attempts: 0 },
    ],
    trips: [{ id: 't1', status: 'arriving', rider_id: 'r1', driver_id: 'd1', pickup_label: 'Cooper Library' }],
    profiles: [{ id: 'd1', full_name: 'Alex Rivera', phone: PHONE, last_name: LAST, email: 'alex.rivera@clemson.edu' }],
    vehicles: [{ driver_id: 'd1', color: 'Silver', make: 'Honda', model: 'Civic', plate: 'abc123' }],
    rider_push_tokens: [{ rider_id: 'r1', token: 'ExponentPushToken[rider]' }],
  }
  function query(table) {
    const filters = []
    let op = 'select'
    let patch = null
    const rows = () => (tables[table] || []).filter((row) => filters.every((fn) => fn(row)))
    const run = () => {
      if (op === 'update') {
        const hit = rows()
        for (const row of hit) Object.assign(row, patch)
        return { data: hit.map((row) => ({ ...row })), error: null }
      }
      return { data: rows().map((row) => ({ ...row })), error: null }
    }
    const builder = {
      select() { return builder },
      update(value) { op = 'update'; patch = value; return builder },
      delete() { return builder },
      eq(col, value) { filters.push((row) => row[col] === value); return builder },
      is(col, value) { filters.push((row) => (row[col] ?? null) === value); return builder },
      gte(col, value) { filters.push((row) => String(row[col]) >= value); return builder },
      lt() { return builder },
      order() { return builder },
      limit() { return builder },
      maybeSingle() {
        const result = run()
        return Promise.resolve({ data: result.data?.[0] || null, error: null })
      },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
    }
    return builder
  }
  const sent = []
  await sweepTripStatusNotices(
    { from: query, tables },
    { now, sendPush: async (message) => { sent.push(message); return { sent: true } } },
  )
  assert.equal(sent.length, 1)
  assert.equal(sent[0].title, 'Alex is on the way')
  assert.equal(riderDriverLeaks(sent[0]), false)
  const pushJson = JSON.stringify(sent[0])
  assert.equal(pushJson.includes(LAST), false)
  assert.equal(pushJson.includes(PHONE), false)
  assert.equal(pushJson.includes('last_name'), false)

  const emails = []
  const pushes = []
  const sb = {
    from(table) {
      const filters = []
      const builder = {
        select() { return builder },
        eq(col, val) {
          filters.push([col, val])
          return builder
        },
        async maybeSingle() {
          const list = {
            trips: [{ id: 'trip-1', rider_id: 'rider', driver_id: 'driver', status: 'completed' }],
            trip_lost_item_reports: [{
              id: 'report-1',
              trip_id: 'trip-1',
              reporter_id: 'driver',
              reporter_role: 'driver',
              description: 'black backpack',
              status: 'open',
            }],
            profiles: [{ id: 'rider', email: 'rider@clemson.edu', full_name: 'Alex Rivera', phone: PHONE }],
            rider_push_tokens: [{ rider_id: 'rider', token: 'ExponentPushToken[rider]' }],
          }[table] || []
          const found = list.find((row) => filters.every(([col, val]) => row[col] === val)) || null
          return { data: found, error: null }
        },
      }
      return builder
    },
  }
  const lost = await notifyTripCounterpart({
    sb,
    actorId: 'driver',
    tripId: 'trip-1',
    kind: 'lost-item',
    reportId: 'report-1',
  }, {
    sendPush: async (payload) => {
      pushes.push(payload)
      return { sent: true }
    },
    sendEmail: async (payload) => {
      emails.push(payload)
      return { emailed: true }
    },
  })
  assert.equal(lost.ok, true)
  assert.equal(lost.email.emailed, true)
  for (const payload of [...pushes, ...emails]) {
    assert.equal(riderDriverLeaks(payload), false)
    const json = JSON.stringify(payload)
    assert.equal(json.includes(PHONE), false)
    assert.equal(json.includes(LAST), false)
    assert.equal(json.includes('last_name'), false)
  }
})

function riderSourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      out.push(...riderSourceFiles(path))
      continue
    }
    if (/\.(js|jsx|ts|tsx)$/.test(name)) out.push(path)
  }
  return out
}

test('rider app code has no driver phone, call, or SMS link', () => {
  const root = join(new URL('.', import.meta.url).pathname, '../apps/rider')
  const files = riderSourceFiles(root)
  assert.ok(files.length > 10)
  const problems = []
  const banned = [
    { re: /\bdriver\.phone\b/, label: 'driver.phone' },
    { re: /\bdriverPhone\b/, label: 'driverPhone' },
    { re: /\bdriver_phone\b/, label: 'driver_phone' },
    { re: /\bCall driver\b/i, label: 'Call driver' },
    { re: /\bText driver\b/i, label: 'Text driver' },
    { re: /\bSMS driver\b/i, label: 'SMS driver' },
  ]
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      for (const hit of line.matchAll(/tel:[^'"\s)`]*/g)) {
        if (hit[0] !== 'tel:911') problems.push(`${file}:${index + 1} ${hit[0]}`)
      }
      for (const rule of banned) {
        if (rule.re.test(line)) problems.push(`${file}:${index + 1} ${rule.label}`)
      }
    })
  }
  assert.deepEqual(problems, [])
})
