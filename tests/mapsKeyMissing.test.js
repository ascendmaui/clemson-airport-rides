import test from 'node:test'
import assert from 'node:assert'
import { recomputeRideFares } from '../server/friendRideRecompute.js'

test('Maps key missing returns graceful UX error', async () => {
  const fakeSb = {
    from: (table) => {
      const q = {}
      q.select = () => q
      q.eq = () => q
      q.order = () => q
      q.limit = () => q
      q.update = () => q
      q.maybeSingle = async () => {
        if (table === 'friend_rides') {
          return {
            data: {
              id: 'r1',
              status: 'open',
              pickup_lat: 34.6788,
              pickup_lng: -82.843,
              dropoff_lat: 34.8956,
              dropoff_lng: -82.2189,
              intermediates: [],
              split_mode: 'even',
            },
            error: null
          }
        }
        return { data: {}, error: null }
      }
      q.single = q.maybeSingle
      q.then = (resolve) => {
        if (table === 'friend_ride_participants') {
          resolve({
            data: [{
              id: 'p1',
              pickup: { lat: 34.6788, lng: -82.843, label: 'A' },
              dropoff: { lat: 34.8956, lng: -82.2189, label: 'B' }
            }],
            error: null
          })
        } else {
          resolve({ data: [], error: null })
        }
      }
      return q
    }
  }

  const result = await recomputeRideFares(fakeSb, 'test_token', {
    splitMode: 'even',
    computeRoutes: async () => ({ error: 'Missing key', code: 'maps_key_missing' })
  })

  assert.equal(result.ok, false)
  // Ensure the error string is graceful and not exposing internal Vercel instructions to the end user
  assert.equal(result.message, 'Route calculation failed. The server is missing Google Maps API configuration.')
  assert.equal(result.code, 'maps_key_missing')
})
