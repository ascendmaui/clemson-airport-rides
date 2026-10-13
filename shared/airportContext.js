/**
 * Airport and flight context for GSP, CLT and ATL trips (driver flow slice 2).
 *
 * Riders may add a flight number and time when they book. The driver sees the
 * airport, terminal or airline, and the flight on the offer and the trip
 * screen. Nothing here is required: no flight means the airport line only.
 * Terminal guidance stays conservative: GSP and CLT have one terminal, and at
 * ATL Delta checks in at Domestic South while other domestic airlines use
 * Domestic North.
 */

export const AIRPORT_CODES = Object.freeze(['GSP', 'CLT', 'ATL'])

export const AIRPORT_NAMES = Object.freeze({
  GSP: 'Greenville-Spartanburg',
  CLT: 'Charlotte Douglas',
  ATL: 'Atlanta Hartsfield-Jackson',
})

export const AIRLINES = Object.freeze({
  AA: 'American',
  AS: 'Alaska',
  B6: 'JetBlue',
  DL: 'Delta',
  F9: 'Frontier',
  G4: 'Allegiant',
  MX: 'Breeze',
  NK: 'Spirit',
  UA: 'United',
  WN: 'Southwest',
  AC: 'Air Canada',
  SY: 'Sun Country',
})

const NAME_TO_CODE = Object.freeze(Object.fromEntries(
  Object.entries(AIRLINES).map(([code, name]) => [name.toLowerCase(), code]),
))

export const FLIGHT_NUMBER_HINT = 'Use the airline code and number, like DL 1234.'
export const FLIGHT_TIME_HINT = 'Use the flight time as HH:MM, like 18:05.'

/** Airport code from a label or code string, or null. */
export function airportCodeFromLabel(label) {
  const text = String(label || '').toUpperCase()
  if (!text.trim()) return null
  if (/\bATL\b|HARTSFIELD/.test(text)) return 'ATL'
  if (/\bCLT\b|CHARLOTTE/.test(text)) return 'CLT'
  if (/\bGSP\b|GREENVILLE[-\s]?SPARTANBURG/.test(text)) return 'GSP'
  return null
}

/**
 * Normalize a rider-entered flight: { number, time } (or a bare string).
 * Returns { flight: null } when empty, { error } when it cannot be read.
 */
export function normalizeFlight(input) {
  const raw = typeof input === 'string' ? { number: input } : (input && typeof input === 'object' ? input : {})
  const numberRaw = String(raw.number ?? raw.flightNumber ?? raw.flight_number ?? '').trim()
  const timeRaw = String(raw.time ?? raw.flightTime ?? raw.flight_time ?? '').trim()
  if (!numberRaw && !timeRaw) return { flight: null }
  let number = null
  let airlineCode = null
  if (numberRaw) {
    const compact = numberRaw.toUpperCase().replace(/[\s-]+/g, '')
    const byName = numberRaw.match(/^([A-Za-z][A-Za-z ]+?)\s*(\d{1,4})$/)
    const nameCode = byName ? NAME_TO_CODE[byName[1].trim().toLowerCase()] : null
    const match = compact.match(/^([A-Z][A-Z0-9]|[0-9][A-Z])(\d{1,4}[A-Z]?)$/)
    if (nameCode) {
      airlineCode = nameCode
      number = `${nameCode} ${byName[2]}`
    } else if (match) {
      airlineCode = match[1]
      number = `${match[1]} ${match[2]}`
    } else {
      return { error: FLIGHT_NUMBER_HINT, code: 'invalid_flight_number' }
    }
  }
  let time = null
  if (timeRaw) {
    const m = timeRaw.match(/^(\d{1,2}):(\d{2})$/)
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { error: FLIGHT_TIME_HINT, code: 'invalid_flight_time' }
    time = `${m[1].padStart(2, '0')}:${m[2]}`
  }
  return {
    flight: {
      number,
      airlineCode,
      airline: airlineCode ? AIRLINES[airlineCode] || null : null,
      time,
    },
  }
}

/** Flight on a trip row: metadata.flight wins, then the trips.flight text column. */
export function tripFlight(trip) {
  const meta = trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  if (meta.flight && typeof meta.flight === 'object') {
    const parsed = normalizeFlight(meta.flight)
    if (parsed.flight) return { ...parsed.flight, terminal: typeof meta.flight.terminal === 'string' ? meta.flight.terminal : null }
  }
  if (typeof trip?.flight === 'string' && trip.flight.trim()) {
    const parsed = normalizeFlight(trip.flight)
    if (parsed.flight) return { ...parsed.flight, terminal: null }
  }
  return null
}

/** Terminal guidance for curbside, or null when the airport has one terminal. */
export function airportTerminal(code, airlineCode) {
  if (code !== 'ATL' || !airlineCode) return null
  return airlineCode === 'DL' ? 'Domestic South' : 'Domestic North'
}

function clock(time) {
  const m = String(time || '').match(/^(\d{2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${m[2]} ${suffix}`
}

/**
 * Driver-facing airport context, or null for non-airport trips.
 * direction: 'to' (drop-off at the airport, departures) or 'from' (pickup, arrivals).
 */
export function airportTripContext(trip) {
  const meta = trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  const metaCode = String(meta.airport || '').toUpperCase()
  const dropCode = airportCodeFromLabel(trip?.dropoff_label ?? trip?.dropoffLabel)
  const pickCode = airportCodeFromLabel(trip?.pickup_label ?? trip?.pickupLabel)
  const code = AIRPORT_CODES.includes(metaCode) ? metaCode : (dropCode || pickCode)
  if (!code) return null
  const direction = pickCode === code && dropCode !== code ? 'from' : 'to'
  const flight = tripFlight(trip)
  const terminal = flight?.terminal || airportTerminal(code, flight?.airlineCode)
  const flightTime = clock(flight?.time)
  const curb = direction === 'to' ? 'Departures' : 'Arrivals'
  const chip = [code, terminal].filter(Boolean).join(' · ')
  const flightLine = flight?.number
    ? [flight.airline ? `${flight.airline} ${flight.number}` : flight.number, flightTime ? `${direction === 'to' ? 'departs' : 'lands'} ${flightTime}` : null]
      .filter(Boolean).join(' · ')
    : (flightTime ? `Flight ${direction === 'to' ? 'departs' : 'lands'} ${flightTime}` : null)
  return {
    code,
    name: AIRPORT_NAMES[code],
    direction,
    curb,
    terminal,
    airline: flight?.airline || null,
    flightNumber: flight?.number || null,
    flightTime,
    chip,
    flightLine,
    line: [chip, curb, flightLine].filter(Boolean).join(' · '),
  }
}

/**
 * Booking input: body.flight ({ number, time } or a string), or flightNumber /
 * flightTime. Returns { flight, column } for metadata.flight and trips.flight.
 */
export function flightFromBody(body) {
  const b = body && typeof body === 'object' ? body : {}
  const input = b.flight ?? ((b.flightNumber || b.flightTime) ? { number: b.flightNumber, time: b.flightTime } : null)
  const parsed = normalizeFlight(input)
  if (parsed.error) return parsed
  return { flight: parsed.flight, column: parsed.flight?.number || null }
}
