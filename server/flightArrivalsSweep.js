/**
 * trip-sweeps 'flight-arrivals' step (runs each minute, works every 5).
 * 1. Pull arrivals for each FLIGHT_AIRPORTS airport (default GSP) from the
 *    configured provider and upsert public.flight_arrivals.
 * 2. Stamp metadata.flight_status on booked airport pickups whose flight
 *    matches, so the rider sees the real landing time.
 * 3. Push online drivers once per 20-minute wave, STAGE_LEAD minutes before
 *    it lands, when the wave is worth it (booked pickups weigh 3x).
 * With no provider key only step 3 runs, on rider-entered times.
 */
import { flightProvider } from './flights/providers.js'
import { tripFlightStatus, waveAlertCopy, waveAlertDue, waveWorthAlert } from '../shared/flightStatus.js'
import { tripFlight, airportTripContext } from '../shared/airportContext.js'
import { pushDrivers } from './driverBroadcastPush.js'

export const INGEST_EVERY_MS = 5 * 60 * 1000
const AIRPORTS = new Set(['GSP', 'CLT', 'ATL'])

export function configuredAirports(env = process.env) {
  const list = String(env.FLIGHT_AIRPORTS || 'GSP').split(',').map((s) => s.trim().toUpperCase()).filter((s) => AIRPORTS.has(s))
  return list.length ? [...new Set(list)] : ['GSP']
}

function etDate(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

async function onlineApprovedDrivers(sb) {
  const online = await sb.from('driver_status').select('driver_id').eq('online', true).limit(500)
  if (online.error) throw new Error(online.error.message)
  const ids = (online.data || []).map((r) => r.driver_id)
  if (!ids.length) return []
  const apps = await sb.from('driver_applications').select('profile_id').eq('status', 'approved').in('profile_id', ids)
  if (apps.error) throw new Error(apps.error.message)
  return (apps.data || []).map((r) => r.profile_id)
}

async function stampTrips(sb, airport, rows, now) {
  if (!rows.length) return 0
  const byNumber = new Map(rows.map((r) => [r.flight_number, r]))
  const from = new Date(now.getTime() - 2 * 3600000).toISOString()
  const to = new Date(now.getTime() + 14 * 3600000).toISOString()
  const { data, error } = await sb.from('trips')
    .select('id, status, pickup_label, dropoff_label, flight, metadata, scheduled_for, pickup_at')
    .in('status', ['scheduled', 'searching', 'offered', 'accepted', 'arriving', 'arrived'])
    .not('flight', 'is', null)
    .gte('scheduled_for', from).lte('scheduled_for', to)
    .limit(200)
  if (error) throw new Error(error.message)
  let stamped = 0
  for (const trip of data || []) {
    const ctx = airportTripContext(trip)
    if (!ctx || ctx.code !== airport || ctx.direction !== 'from') continue
    const flight = tripFlight(trip)
    const match = flight?.number ? byNumber.get(flight.number) : null
    if (!match) continue
    const status = tripFlightStatus({ ...match }, airport, now)
    const prev = trip.metadata?.flight_status
    if (prev && prev.landing_at === status.landing_at && prev.status === status.status && prev.landed === status.landed) continue
    const res = await sb.rpc('apply_trip_flight_status', { p_trip_id: trip.id, p_status: status })
    if (!res.error && res.data) stamped += 1
  }
  return stamped
}

async function alertWaves(sb, airport, now, push) {
  const { data, error } = await sb.rpc('airport_arrival_waves', { p_airport: airport, p_hours: 2, p_now: now.toISOString() })
  if (error) throw new Error(error.message)
  let alerted = 0
  let drivers = null
  for (const wave of data || []) {
    if (!waveAlertDue(wave, now) || !waveWorthAlert(wave)) continue
    const claim = await sb.from('airport_wave_alerts')
      .upsert({ airport, wave_start: wave.wave_start, flights: wave.flights, booked_pickups: wave.booked_pickups }, { onConflict: 'airport,wave_start', ignoreDuplicates: true })
      .select('airport')
    if (claim.error || !claim.data?.length) continue
    drivers = drivers || await onlineApprovedDrivers(sb)
    const out = await push(sb, drivers, { ...waveAlertCopy({ ...wave, airport }), data: { type: 'airport_wave', airport, waveStart: wave.wave_start } })
    await sb.from('airport_wave_alerts').update({ drivers_notified: out.sent }).eq('airport', airport).eq('wave_start', wave.wave_start)
    alerted += 1
  }
  return alerted
}

export async function sweepFlightArrivals(sb, { now = new Date(), dryRun = false, env = process.env, provider, push = pushDrivers } = {}) {
  const at = new Date(now)
  // Trip counters (released/canceled/charged/skipped) stay 0: this sweep does not move trips.
  const result = { released: 0, canceled: 0, charged: 0, failed: 0, skipped: 0, upserted: 0, stamped: 0, alerted: 0, airports: [], provider: null, ids: { released: [], canceled: [], charged: [], failed: [], skipped: [] } }
  if (dryRun) return result
  const source = provider || flightProvider(env)
  result.provider = source.name
  for (const airport of configuredAirports(env)) {
    let last
    try {
      last = await sb.from('flight_ingest_runs').select('last_run_at').eq('airport', airport).maybeSingle()
    } catch (err) {
      last = { error: err }
    }
    // Before 20261012112103_flight_arrivals.sql (or on a stub db) there is nothing to do.
    if (last?.error || !last) { result.airports.push({ airport, state: 'unavailable' }); continue }
    const lastMs = last.data?.last_run_at ? Date.parse(last.data.last_run_at) : 0
    if (at.getTime() - lastMs < INGEST_EVERY_MS - 15000) { result.airports.push({ airport, state: 'throttled' }); continue }
    let rows = []
    let lastError = null
    try {
      rows = await source.arrivals(airport, new Date(at.getTime() - 60 * 60000), new Date(at.getTime() + 6 * 3600000))
    } catch (err) {
      lastError = String(err?.message || err).slice(0, 300)
      result.airports.push({ airport, state: 'provider_error', error: lastError })
    }
    const fetched = at.toISOString()
    const upserts = rows.map((r) => ({ ...r, airport, flight_date: etDate(r.scheduled_at), provider: source.name, fetched_at: fetched }))
    if (upserts.length) {
      const up = await sb.from('flight_arrivals').upsert(upserts, { onConflict: 'airport,flight_number,flight_date' })
      if (up.error) lastError = up.error.message
      else result.upserted += upserts.length
    }
    await sb.from('flight_ingest_runs').upsert({ airport, provider: source.name, last_run_at: fetched, rows_upserted: upserts.length, last_error: lastError }, { onConflict: 'airport' })
    try {
      result.stamped += await stampTrips(sb, airport, rows, at)
      result.alerted += await alertWaves(sb, airport, at, push)
      result.airports.push({ airport, state: lastError ? 'partial' : 'ok', rows: upserts.length })
    } catch (err) {
      result.airports.push({ airport, state: 'error', error: String(err?.message || err).slice(0, 200) })
      console.error('[flight-arrivals]', airport, err?.message || err)
    }
  }
  // Keep three days of feed.
  if (result.airports.some((a) => a.state === 'ok' || a.state === 'partial')) {
    await sb.from('flight_arrivals').delete().lt('fetched_at', new Date(at.getTime() - 3 * 86400000).toISOString())
  }
  return result
}
