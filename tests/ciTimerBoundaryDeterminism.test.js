import assert from 'node:assert/strict'
import test from 'node:test'
import scheduleTripHandler from '../server/endpoints/scheduleTrip.js'

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[k] = v
    },
    end(data) {
      if (data) this.body = data
    },
  }
}

async function callHandler(handler, req, deps = {}) {
  const res = mockRes()
  await handler({ headers: {}, ...req }, res, deps)
  let json = null
  try {
    json = res.body ? JSON.parse(res.body) : null
  } catch {
    json = res.body
  }
  return { status: res.statusCode, headers: res.headers, body: res.body, json }
}

function fakeSb() {
  const tripsInserted = []
  const events = []
  const sb = {
    from(table) {
      const q = {
        select() { return q },
        eq() { return q },
        limit() { return q },
        maybeSingle: async () => ({ data: null, error: null }),
        insert: (row) => {
          if (table === 'trips') tripsInserted.push(row)
          if (table === 'trip_events') events.push(row)
          return {
            select() {
              return {
                single: async () => ({ data: { id: 't_mock', ...row }, error: null }),
              }
            },
          }
        },
      }
      return q
    },
  }
  return { sb, tripsInserted, events }
}

test('scheduleTripHandler deterministically enforces 30m boundary via deps.now without clock drift', async () => {
  const fixedNow = 1770000000000 // 2026-02-02T05:20:00.000Z
  const exactlyThirty = new Date(fixedNow + 30 * 60 * 1000).toISOString()
  const insideThirty = new Date(fixedNow + 30 * 60 * 1000 - 1).toISOString()

  const defaultBody = {
    pickup: { label: 'Campus', lat: 34.678, lng: -82.839 },
    dropoff: { label: 'Downtown', lat: 34.685, lng: -82.835 },
  }

  const { sb: sbValid, tripsInserted } = fakeSb()
  const validRes = await callHandler(
    scheduleTripHandler,
    {
      method: 'POST',
      body: { ...defaultBody, pickupAt: exactlyThirty },
    },
    {
      sb: sbValid,
      user: { id: 'u1', email: 'test@clemson.edu' },
      ensureProfile: async () => ({ ok: true }),
      now: fixedNow,
    },
  )

  assert.equal(validRes.status, 200)
  assert.equal(tripsInserted.length, 1)
  assert.equal(tripsInserted[0].pickup_at, exactlyThirty)

  const { sb: sbInvalid } = fakeSb()
  const invalidRes = await callHandler(
    scheduleTripHandler,
    {
      method: 'POST',
      body: { ...defaultBody, pickupAt: insideThirty },
    },
    {
      sb: sbInvalid,
      user: { id: 'u1', email: 'test@clemson.edu' },
      ensureProfile: async () => ({ ok: true }),
      now: fixedNow,
    },
  )

  assert.equal(invalidRes.status, 400)
  assert.equal(invalidRes.json.error, 'Schedule at least 30 minutes ahead.')
})

test('scheduleTripHandler accepts a function for deps.now', async () => {
  const fixedNow = 1770000000000
  const pickupAt = new Date(fixedNow + 45 * 60 * 1000).toISOString()

  const { sb, tripsInserted } = fakeSb()
  const res = await callHandler(
    scheduleTripHandler,
    {
      method: 'POST',
      body: {
        pickup: { label: 'Campus', lat: 34.678, lng: -82.839 },
        dropoff: { label: 'Downtown', lat: 34.685, lng: -82.835 },
        pickupAt,
      },
    },
    {
      sb,
      user: { id: 'u1', email: 'test@clemson.edu' },
      ensureProfile: async () => ({ ok: true }),
      now: () => fixedNow,
    },
  )

  assert.equal(res.status, 200)
  assert.equal(tripsInserted.length, 1)
})
