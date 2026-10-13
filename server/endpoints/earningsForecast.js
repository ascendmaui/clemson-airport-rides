/**
 * GET /api/driver?action=forecast
 * 7-day earnings forecast (estimate) for signed-in drivers.
 * Uses fleet-wide completed trips (amounts, times, coordinates only — nothing
 * identifying leaves the server) plus the admin-editable clemson_events table.
 */
import { admin, cors, json, userFromAuth } from '../friendRideLib.js'
import { buildForecast } from '../../packages/rides-native/earningsForecast.js'

const HISTORY_DAYS = 180
const TRIP_COLS = 'pickup_label, dropoff_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, fare_cents, driver_earnings_cents, tip_cents, accepted_at, completed_at, metadata'

export async function loadForecastInputs(sb, now = Date.now()) {
  const since = new Date(now - HISTORY_DAYS * 86_400_000).toISOString()
  const until = new Date(now + 9 * 86_400_000).toISOString().slice(0, 10)
  const from = new Date(now - 2 * 86_400_000).toISOString().slice(0, 10)
  const [tripsRes, eventsRes] = await Promise.all([
    sb.from('trips').select(TRIP_COLS).eq('status', 'completed').gte('completed_at', since).limit(5000),
    sb.from('clemson_events').select('kind, title, event_date, starts_at, zone, demand_weight, active')
      .eq('active', true).gte('event_date', from).lte('event_date', until),
  ])
  const trips = (tripsRes.data || [])
    .filter((trip) => !trip?.metadata?.e2e_test)
    .map((trip) => ({ ...trip, route_duration_s: trip?.metadata?.route_duration_s, metadata: undefined }))
  const events = eventsRes.error ? [] : (eventsRes.data || [])
  return { trips, events, eventsMissing: Boolean(eventsRes.error) }
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
  const sb = deps.sb || admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user || await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  try {
    const now = deps.now || Date.now()
    const inputs = await (deps.loadInputs || loadForecastInputs)(sb, now)
    const forecast = buildForecast({ trips: inputs.trips, events: inputs.events, now, limit: 12 })
    res.setHeader?.('Cache-Control', 'private, max-age=600')
    return json(res, 200, {
      ...forecast,
      events: inputs.events.map(({ title, event_date, starts_at, zone }) => ({ title, event_date, starts_at, zone })),
      eventsNote: inputs.eventsMissing ? 'Event calendar is not set up yet; forecast uses time patterns only.' : null,
    })
  } catch (err) {
    console.error('[forecast]', err?.message || err)
    return json(res, 500, { error: 'Could not build the forecast.' })
  }
}
