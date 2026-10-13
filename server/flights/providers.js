/**
 * Provider-agnostic flight arrivals adapter.
 *
 * Picks the first configured key:
 *   AERODATABOX_API_KEY   AeroDataBox via RapidAPI (AERODATABOX_HOST overrides the host)
 *   FLIGHTAWARE_AEROAPI_KEY  FlightAware AeroAPI v4
 *   AVIATIONSTACK_API_KEY AviationStack
 * With no key the provider is 'none': it returns no rows, and the app falls
 * back to scheduled-only data (the rider-entered flight time). Nothing is
 * ever synthesized.
 *
 * Every adapter returns normalized rows:
 *   { flight_number: 'DL 1234', airline_code, origin, status, scheduled_at, estimated_at, actual_at, terminal, gate }
 */
import { canonicalFlightNumber } from '../../shared/flightStatus.js'

const ICAO = { GSP: 'KGSP', CLT: 'KCLT', ATL: 'KATL' }

function iso(value) {
  if (!value) return null
  let s = String(value).trim().replace(' ', 'T')
  if (!/(Z|[+-]\d\d:?\d\d)$/i.test(s)) s += 'Z'
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function row(fields) {
  const flight_number = canonicalFlightNumber(fields.number)
  if (!flight_number || !fields.scheduled_at) return null
  return { flight_number, airline_code: flight_number.split(' ')[0], ...fields, number: undefined }
}

function clean(rows) {
  return rows.filter(Boolean).map(({ number, ...rest }) => rest)
}

function localStamp(date) {
  // AeroDataBox wants airport-local yyyy-MM-ddTHH:mm; all three airports are Eastern.
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

export function parseAeroDataBox(json) {
  const list = Array.isArray(json?.arrivals) ? json.arrivals : []
  return clean(list.map((f) => {
    const m = f?.movement || f?.arrival || {}
    const status = f?.status || null
    const landed = /landed|arrived/i.test(String(status || ''))
    const revised = iso(m.revisedTime?.utc)
    return row({
      number: f?.number,
      origin: f?.departure?.airport?.iata || m.airport?.iata || null,
      status,
      scheduled_at: iso(m.scheduledTime?.utc),
      estimated_at: landed ? null : (revised || iso(m.predictedTime?.utc)),
      actual_at: iso(m.runwayTime?.utc) || (landed ? revised : null),
      terminal: m.terminal || null,
      gate: m.gate || null,
    })
  }))
}

export function parseAeroApi(json) {
  const list = [...(json?.arrivals || []), ...(json?.scheduled_arrivals || [])]
  return clean(list.map((f) => row({
    number: f?.ident_iata || f?.ident,
    origin: f?.origin?.code_iata || null,
    status: f?.status || null,
    scheduled_at: iso(f?.scheduled_on || f?.scheduled_in),
    estimated_at: f?.actual_on ? null : iso(f?.estimated_on || f?.estimated_in),
    actual_at: iso(f?.actual_on),
    terminal: f?.terminal_destination || null,
    gate: f?.gate_destination || null,
  })))
}

export function parseAviationStack(json) {
  const list = Array.isArray(json?.data) ? json.data : []
  return clean(list.map((f) => row({
    number: f?.flight?.iata,
    origin: f?.departure?.iata || null,
    status: f?.flight_status || null,
    scheduled_at: iso(f?.arrival?.scheduled),
    estimated_at: f?.arrival?.actual ? null : iso(f?.arrival?.estimated),
    actual_at: iso(f?.arrival?.actual),
    terminal: f?.arrival?.terminal || null,
    gate: f?.arrival?.gate || null,
  })))
}

async function getJson(fetchImpl, url, headers) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json', ...headers } })
  if (!res.ok) throw new Error(`flight provider HTTP ${res.status}`)
  return res.json()
}

/** The configured provider, or { name: 'none' }. */
export function flightProvider(env = process.env, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch
  const adb = String(env.AERODATABOX_API_KEY || '').trim()
  const aero = String(env.FLIGHTAWARE_AEROAPI_KEY || '').trim()
  const avs = String(env.AVIATIONSTACK_API_KEY || '').trim()
  if (adb) {
    const host = String(env.AERODATABOX_HOST || 'aerodatabox.p.rapidapi.com').trim()
    return {
      name: 'aerodatabox',
      async arrivals(airport, from, to) {
        const url = `https://${host}/flights/airports/iata/${airport}/${localStamp(from)}/${localStamp(to)}?direction=Arrival&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false`
        return parseAeroDataBox(await getJson(fetchImpl, url, { 'X-RapidAPI-Key': adb, 'X-RapidAPI-Host': host }))
      },
    }
  }
  if (aero) {
    return {
      name: 'flightaware',
      async arrivals(airport, from, to) {
        const q = `start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}&max_pages=2`
        const base = `https://aeroapi.flightaware.com/aeroapi/airports/${ICAO[airport]}/flights`
        const [done, upcoming] = await Promise.all([
          getJson(fetchImpl, `${base}/arrivals?${q}`, { 'x-apikey': aero }),
          getJson(fetchImpl, `${base}/scheduled_arrivals?${q}`, { 'x-apikey': aero }),
        ])
        return parseAeroApi({ arrivals: done?.arrivals, scheduled_arrivals: upcoming?.scheduled_arrivals })
      },
    }
  }
  if (avs) {
    return {
      name: 'aviationstack',
      async arrivals(airport) {
        const url = `https://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(avs)}&arr_iata=${airport}&limit=100`
        return parseAviationStack(await getJson(fetchImpl, url, {}))
      },
    }
  }
  return { name: 'none', async arrivals() { return [] } }
}
