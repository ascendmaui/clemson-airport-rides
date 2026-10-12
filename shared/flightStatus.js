/**
 * Flight status shared by server ingest, driver card and rider trip screen.
 * Every time shown comes from a real provider row or the rider's own entry.
 */
import { airportTripContext, normalizeFlight } from './airportContext.js'

export const DEPLANE_MINUTES = Object.freeze({ GSP: 12, CLT: 20, ATL: 25 })
export const STAGE_LEAD_MINUTES = 20

/** "DL 1234" from provider text like "DL1234" / "dl 1234", or null. */
export function canonicalFlightNumber(raw) {
  const parsed = normalizeFlight(String(raw || ''))
  return parsed.flight?.number || null
}

/** Landing time to trust: actual, then estimated, then scheduled. */
export function landingAt(row) {
  return row?.actual_at || row?.estimated_at || row?.scheduled_at || null
}

/** metadata.flight_status payload for a trip from a provider row. */
export function tripFlightStatus(row, airport, checkedAt = new Date()) {
  if (!row) return null
  const landing = landingAt(row)
  const deplane = DEPLANE_MINUTES[airport] ?? 15
  const landed = Boolean(row.actual_at) || /landed|arrived/i.test(String(row.status || ''))
  return {
    number: row.flight_number,
    status: row.status || null,
    scheduled_at: row.scheduled_at || null,
    estimated_at: row.estimated_at || null,
    actual_at: row.actual_at || null,
    landing_at: landing,
    landed,
    curb_ready_at: landing ? new Date(Date.parse(landing) + deplane * 60000).toISOString() : null,
    terminal: row.terminal || null,
    provider: row.provider,
    checked_at: new Date(checkedAt).toISOString(),
  }
}

const TZ = 'America/New_York'
function clock(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(t))
}

/**
 * Rider trip screen view for an airport pickup tied to a flight, or null.
 * arrivals: true when the pickup curb is Arrivals (driver waits there).
 */
export function riderFlightView(trip, status) {
  const ctx = airportTripContext(trip)
  if (!ctx || ctx.direction !== 'from') return null
  const meta = trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  const fs = meta.flight_status && typeof meta.flight_status === 'object' ? meta.flight_status : null
  let line = ctx.flightLine
  if (fs?.landing_at) {
    const at = clock(fs.landing_at)
    const was = fs.scheduled_at && fs.scheduled_at !== fs.landing_at ? clock(fs.scheduled_at) : null
    const verb = fs.landed ? 'Landed' : 'Landing'
    line = `${ctx.flightNumber || fs.number || 'Flight'} · ${verb} ${at}${was && was !== at ? ` (was ${was})` : ''}`
  }
  const waiting = status === 'arrived'
  return {
    arrivals: true,
    code: ctx.code,
    line,
    waitingTitle: waiting ? 'Your driver is waiting at Arrivals' : null,
    curbReadyAt: fs?.curb_ready_at || null,
  }
}

/** Driver card copy for one wave from airport_arrival_waves. */
export function waveCardLine(wave) {
  if (!wave) return null
  const start = clock(wave.wave_start)
  const end = clock(wave.wave_end)
  const stage = clock(wave.stage_at)
  const flights = Number(wave.flights) || 0
  const booked = Number(wave.booked_pickups) || 0
  const parts = []
  if (flights) parts.push(`${flights} flight${flights === 1 ? '' : 's'}`)
  if (booked) parts.push(`${booked} booked pickup${booked === 1 ? '' : 's'}`)
  return {
    when: `${start}–${end}`,
    what: parts.join(' · ') || 'Arrivals',
    stage: `Stage at the ${wave.airport || 'GSP'} cell lot by ${stage}`,
    quality: wave.data_quality === 'live' ? 'Live times' : wave.data_quality === 'scheduled' ? 'Scheduled times' : 'Rider-entered times',
  }
}

/** Is a wave worth a push? Booked pickups weigh 3x a flight. */
export function waveWorthAlert(wave, { minScore = 4 } = {}) {
  const booked = Number(wave?.booked_pickups) || 0
  const score = Number(wave?.score) || ((Number(wave?.flights) || 0) + 3 * booked)
  return booked >= 1 || score >= minScore
}

/** Due when stage_at falls in [now, now + windowMinutes). */
export function waveAlertDue(wave, now = new Date(), windowMinutes = 6) {
  const stage = Date.parse(wave?.stage_at)
  const t = new Date(now).getTime()
  return Number.isFinite(stage) && stage >= t - 60000 && stage < t + windowMinutes * 60000
}

export function waveAlertCopy(wave) {
  const line = waveCardLine(wave)
  return {
    title: `Flights landing at ${wave.airport || 'GSP'}`,
    body: `${line.what} land ${line.when}. ${line.stage}.`,
  }
}
