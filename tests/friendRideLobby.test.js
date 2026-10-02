process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'mock_key_for_tests'

import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

const {
  handleFriendRideCreate,
  handleFriendRideGet,
  handleFriendRideJoin,
  handleFriendRideRecompute,
} = await import('../server/friendRideRoutes.js')

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; return this },
    status(code) { this.statusCode = code; return this },
    end(data) { this.body = data; return this },
  }
  return res
}

function mockReq(method, body = {}, query = {}) {
  return {
    method,
    headers: { origin: 'http://localhost', 'content-type': 'application/json' },
    body,
    query,
    url: '/',
  }
}

describe('FriendRide Lobby', () => {
  let db = {}
  
  function createFakeSb() {
    const rides = []
    const participants = []
    
    const sb = {
      from(table) {
        return {
          insert(row) {
            let inserted
            if (table === 'friend_rides') {
              inserted = { ...row, id: 'ride-1', created_at: new Date().toISOString() }
              rides.push(inserted)
            } else if (table === 'friend_ride_participants') {
              inserted = { ...row, id: 'part-' + Math.random(), created_at: new Date().toISOString() }
              participants.push(inserted)
            }
            return {
              select() {
                return { single: async () => ({ data: inserted, error: null }) }
              }
            }
          },
          select(cols) {
            return {
              in(col, val) { return { then: resolve => resolve({ data: [{ id: "mock_profile" }], error: null }) } }, eq(col, val) {
                return {
                  order() { return this }, lte() { return this }, gte() { return this }, gt() { return this }, lt() { return this },
                  limit() { return this },
                  in(col, val) { return { then: resolve => resolve({ data: [], error: null }) } }, maybeSingle: async () => {
                    if (table === 'friend_rides' && col === 'token') {
                      const ride = rides.find(r => r.token === val)
                      return { data: ride || null, error: null }
                    }
                    if (table === 'vehicles') { if (col === 'driver_id' && val === 'u1') return { data: { make: 'Toyota', seats: 4 }, error: null }
                      return { data: null, error: null }
                    }
                    if (table === 'profiles') {
                      return { data: null, error: null }
                    }
                    return { data: null, error: null }
                  },
                  then(resolve) {
                    if (table === 'friend_ride_participants' && col === 'friend_ride_id') {
                      const parts = participants.filter(p => p.friend_ride_id === val)
                      resolve({ data: parts, error: null })
                    } else if (table === 'profiles' && col === 'id') {
                      resolve({ data: [{ id: val, email: 'mock@example.com' }], error: null })
                    } else {
                      resolve({ data: [], error: null })
                    }
                  }
                }
              }
            }
          },
          update(patch) {
            return {
              in(col, val) { return { then: resolve => resolve({ data: [{ id: "mock_profile" }], error: null }) } }, eq(col, val) {
                if (table === 'friend_rides' && col === 'id') {
                  const idx = rides.findIndex(r => r.id === val)
                  if (idx >= 0) rides[idx] = { ...rides[idx], ...patch }
                }
                return { then: resolve => resolve({ error: null }) }
              }
            }
          }
        }
      }
    }
    return { sb, rides, participants }
  }

  test('create rejects an unauthenticated organizer without writing a ride', async () => {
    const { sb, rides, participants } = createFakeSb()
    const res = mockRes()

    await handleFriendRideCreate(
      mockReq('POST', {
        displayName: 'Anonymous',
        pickup: { address: 'A', lat: 1, lng: 1 },
        dropoff: { address: 'B', lat: 2, lng: 2 },
      }),
      res,
      { sb, user: null },
    )

    assert.equal(res.statusCode, 401)
    assert.deepEqual(JSON.parse(res.body), { error: 'Sign in required' })
    assert.equal(rides.length, 0)
    assert.equal(participants.length, 0)
  })

  test('happy path: create, join, get', async () => {
    const { sb, rides, participants } = createFakeSb()
    const user = { id: 'u1', email: 'org@clemson.edu', user_metadata: { full_name: 'Org' } }
    
    // 1. Create
    const reqCreate = mockReq('POST', {
      displayName: 'Org',
      pickup: { address: 'A', lat: 1, lng: 1 },
      dropoff: { address: 'B', lat: 2, lng: 2 },
      splitMode: 'even',
      kind: 'friends'
    })
    const resCreate = mockRes()
    await handleFriendRideCreate(reqCreate, resCreate, { sb, user })
    assert.equal(resCreate.statusCode, 200, resCreate.body)
    const created = JSON.parse(resCreate.body)
    assert.equal(created.ride.organizer_id, 'u1')
    assert.equal(created.ride.status, 'collecting')
    assert.equal(created.kind, 'friends')
    assert.equal(created.urlPath, `/friends/${created.token}`)
    assert.equal(created.participant.user_id, 'u1')
    
    const token = created.ride.token
    
    // 2. Get
    const reqGet = mockReq('POST', { token })
    const resGet = mockRes()
    await handleFriendRideGet(reqGet, resGet, { sb, user })
    assert.equal(resGet.statusCode, 200, resGet.body)
    const got = JSON.parse(resGet.body)
    assert.equal(got.token, token)
    
    // 3. Join
    const user2 = { id: 'u2', email: 'friend@clemson.edu', user_metadata: { full_name: 'Friend' } }
    const reqJoin = mockReq('POST', {
      token,
      displayName: 'Friend',
      pickup: { address: 'C', lat: 3, lng: 3 },
      dropoff: { address: 'B', lat: 2, lng: 2 }
    })
    const resJoin = mockRes()
    await handleFriendRideJoin(reqJoin, resJoin, { sb, user: user2 })
    assert.equal(resJoin.statusCode, 200)
    const joined = JSON.parse(resJoin.body)
    assert.equal(joined.ride.participants.length, 2)
    assert.equal(joined.participant.user_id, 'u2')
    assert.equal(joined.participant.status, 'joined')
  })

  test('happy path: recompute (mocks Maps API)', async () => {
    const { sb, rides, participants } = createFakeSb()
    const user = { id: 'u1', email: 'org@clemson.edu', user_metadata: { full_name: 'Org' } }
    
    // Seed ride and participant
    rides.push({
      id: 'ride-2',
      token: 'tok-xyz',
      organizer_id: 'u1',
      status: 'collecting',
      split_mode: 'even',
      kind: 'friends'
    })
    participants.push({
      id: 'p1',
      friend_ride_id: 'ride-2',
      user_id: 'u1',
      pickup: { lat: 1, lng: 1 },
      dropoff: { lat: 2, lng: 2 },
      status: 'joined'
    })

    // Mock global fetch for Maps
    const origFetch = global.fetch
    global.fetch = async (url, init) => {
      if (typeof url === 'string' && url.includes('googleapis.com/directions/v2:computeRoutes')) {
        return {
          ok: true,
          json: async () => ({
            routes: [{
              distanceMeters: 5000,
              duration: '600s',
              polyline: { encodedPolyline: 'mock' },
              routeLabels: ['ROUTE_LABEL_UNSPECIFIED']
            }]
          })
        }
      }
      return origFetch(url, init)
    }

    try {
      process.env.GOOGLE_MAPS_API_KEY = 'mock_key_for_tests'
      const reqRecompute = mockReq('POST', { token: 'tok-xyz', splitMode: 'even' })
      const resRecompute = mockRes()
      await handleFriendRideRecompute(reqRecompute, resRecompute, { sb, user })
      assert.equal(resRecompute.statusCode, 200, resRecompute.body)
      const data = JSON.parse(resRecompute.body)
      assert.equal(data.token, 'tok-xyz')
      assert.ok(data.total_fare_cents > 0)
    } finally {
      global.fetch = origFetch
    }
  })
})
