import assert from 'node:assert/strict'
import test from 'node:test'
import { handleMarkOffered, handlePassOffer } from './endpoints/driverOfferDesk.js'

const john = 'john-driver'
const kim = 'kim-driver'

function deskSb(seed) {
  const tables = {}
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((row) => ({ ...row, metadata: row.metadata ? { ...row.metadata } : row.metadata }))
  }
  function from(table) {
    if (!tables[table]) tables[table] = []
    const state = { filters: [], op: 'select', payload: null }
    const api = {
      select() { return api },
      eq(col, val) {
        state.filters.push({ kind: 'eq', col, val })
        return api
      },
      in(col, val) {
        state.filters.push({ kind: 'in', col, val })
        return api
      },
      lte() { return api },
      gte() { return api },
      order() { return api },
      limit() { return api },
      match(row) {
        return state.filters.every((filter) => {
          if (filter.kind === 'in') return filter.val.includes(row[filter.col])
          return row[filter.col] === filter.val
        })
      },
      async maybeSingle() {
        const found = tables[table].filter((row) => api.match(row))
        if (state.op === 'update') {
          if (!found[0]) return { data: null, error: null }
          Object.assign(found[0], state.payload)
          return { data: { ...found[0] }, error: null }
        }
        return { data: found[0] ? { ...found[0] } : null, error: null }
      },
      update(payload) {
        state.op = 'update'
        state.payload = payload
        return api
      },
      then(resolve) {
        resolve({ data: tables[table].filter((row) => api.match(row)), error: null })
      },
    }
    return api
  }
  return { sb: { from }, tables }
}

function mockRes() {
  return {
    statusCode: 200,
    body: '',
    setHeader() {},
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

async function call(handler, deps, body) {
  const res = mockRes()
  await handler({ headers: {}, method: 'POST', body }, res, deps)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

function seed() {
  return deskSb({
    driver_applications: [
      { profile_id: john, onboarding_status: 'approved' },
      { profile_id: kim, onboarding_status: 'approved' },
    ],
    driver_status: [
      { driver_id: john, online: true },
      { driver_id: kim, online: true },
    ],
    profiles: [
      { id: john, email: 'johnmatveyev@gmail.com' },
      { id: kim, email: 'kimubermaui@gmail.com' },
    ],
    trips: [{
      id: 'trip-1',
      status: 'searching',
      rider_id: 'rider-1',
      driver_id: null,
      tier: 'standard',
      metadata: {
        match: 'auto',
        offer_driver_id: john,
        auto_assign_queue: [john, kim],
      },
    }],
  })
}

test('mark-offered moves a visible searching trip to offered without claiming it', async () => {
  const desk = seed()
  const hidden = await call(handleMarkOffered, { sb: desk.sb, user: { id: kim } }, { tripId: 'trip-1' })
  assert.equal(hidden.status, 403)
  assert.equal(hidden.json.code, 'offer_not_yours')
  assert.equal(desk.tables.trips[0].status, 'searching')

  const shown = await call(handleMarkOffered, { sb: desk.sb, user: { id: john } }, { tripId: 'trip-1' })
  assert.equal(shown.status, 200)
  assert.equal(shown.json.status, 'offered')
  assert.equal(desk.tables.trips[0].status, 'offered')
  assert.equal(desk.tables.trips[0].driver_id, null)
})

test('pass-offer advances auto-assign to the next online driver', async () => {
  const desk = seed()
  desk.tables.trips[0].status = 'offered'
  const passed = await call(handlePassOffer, { sb: desk.sb, user: { id: john } }, { tripId: 'trip-1' })
  assert.equal(passed.status, 200)
  assert.equal(passed.json.offerDriverId, kim)
  assert.equal(passed.json.released, false)
  assert.equal(desk.tables.trips[0].status, 'searching')
  assert.equal(desk.tables.trips[0].driver_id, null)
  assert.equal(desk.tables.trips[0].metadata.offer_driver_id, kim)
})
