import { createMatchingSupabase } from './matchingE2E.js'

export function seedHold(status = 'requires_capture', patch = {}) {
  const trip = {
    id: 'trip-1', rider_id: 'rider-1', driver_id: 'driver-1', status: 'accepted',
    tier: 'standard', fare_cents: 1850, accepted_at: new Date(Date.now() - 600000).toISOString(),
    pickup_label: 'Campus', dropoff_label: 'Airport',
    pickup_lat: 34.68, pickup_lng: -82.83, dropoff_lat: 34.89, dropoff_lng: -82.21,
    metadata: { preserved: true, ...(status ? { fare_authorization: {
      status, paymentIntentId: 'pi_hold', authorizationCents: 2220,
    } } : {}) }, ...patch,
  }
  const sb = createMatchingSupabase({ trips: [trip], profiles: [{
    id: 'rider-1', stripe_customer_id: 'cus_1', stripe_default_pm_id: 'pm_1',
  }], trip_events: [], payments: [] })
  return { sb, trip: sb._tables.trips[0] }
}

export function fakeStripe({ status = 'requires_capture', failCancel = false } = {}) {
  const calls = []
  let intentStatus = status
  return { calls, paymentIntents: {
    retrieve: async (id) => ({ id, status: id === 'pi_hold' ? intentStatus : 'succeeded' }),
    cancel: async (id, params, options) => {
      calls.push({ op: 'cancel', id, params, options })
      if (failCancel) throw new Error('Stripe temporarily unavailable')
      intentStatus = 'canceled'
      return { id, status: 'canceled' }
    },
    create: async (params, options) => {
      calls.push({ op: 'create', params, options })
      return { id: 'pi_fee', status: 'succeeded', amount: params.amount }
    },
  } }
}

export async function call(handler, body, deps = {}, extra = {}) {
  const res = { statusCode: 200, setHeader() {}, end(value) { this.body = JSON.parse(value) } }
  await handler({ method: 'POST', headers: {}, body, ...extra }, res, deps)
  return res
}
