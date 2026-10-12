/**
 * Year-end driver tax records: mileage split, configured IRS-rate estimate,
 * and CSV/PDF paperwork. This is a trip record, not tax advice, and not a 1099.
 * Stripe Connect information returns stay on Stripe.
 */

export const METERS_PER_MILE = 1609.344
export const TAX_TIME_ZONE = 'America/New_York'

export const TAX_NOT_ADVICE = 'This is not tax advice. This year-end summary and mileage log are trip records for you and your tax preparer. They are not an official IRS form, not a 1099, and not a guarantee of any deduction.'

export const MILEAGE_ESTIMATE_NOTE = 'The mileage deduction is an estimate using the configured IRS business standard mileage rate. Confirm the miles and the rate that applies to you before you file.'

export const STRIPE_1099_NOTE = 'Stripe issues and stores Connect 1099 forms. This app does not create or file those forms.'

export const STRIPE_CONNECT_1099_URL = 'https://connect.stripe.com/express_login'
export const FORM_1099_INFO_URL = 'https://www.irs.gov/forms-pubs/about-form-1099-nec'
export const STRIPE_TAX_REPORTING_URL = 'https://docs.stripe.com/connect/tax-reporting'

/**
 * Configured business standard mileage rates. The database table
 * driver_mileage_rates is the live copy; this list is the seed and the
 * fallback when that table is not readable yet.
 * 2026 has two bands: 72.5¢ through June 30 (Notice 2026-10) and 76¢ from
 * July 1 (Announcement 2026-11).
 */
export const MILEAGE_RATE_CONFIG = Object.freeze([
  Object.freeze({ taxYear: 2024, startsOn: '2024-01-01', endsOn: '2024-12-31', centsPerMile: 67, label: 'IRS business standard mileage rate', sourceNote: 'IR-2023-239' }),
  Object.freeze({ taxYear: 2025, startsOn: '2025-01-01', endsOn: '2025-12-31', centsPerMile: 70, label: 'IRS business standard mileage rate', sourceNote: 'IR-2024-312' }),
  Object.freeze({ taxYear: 2026, startsOn: '2026-01-01', endsOn: '2026-06-30', centsPerMile: 72.5, label: 'IRS business standard mileage rate', sourceNote: 'Notice 2026-10' }),
  Object.freeze({ taxYear: 2026, startsOn: '2026-07-01', endsOn: '2026-12-31', centsPerMile: 76, label: 'IRS business standard mileage rate', sourceNote: 'Announcement 2026-11' }),
])

const ON_TRIP_ROUTE_KEYS = ['route_distance_m', 'distance_m']
const ENROUTE_ROUTE_KEYS = ['enroute_distance_m', 'pickup_route_distance_m', 'en_route_distance_m']
const SOURCE_RANK = { routed: 2, straight_line: 1, unavailable: 0 }

function finite(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function positiveMeters(value) {
  const n = finite(value)
  if (n == null || n <= 0) return null
  return n
}

function metadataMeters(metadata, keys) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {}
  for (const key of keys) {
    const meters = positiveMeters(meta[key])
    if (meters != null) return meters
  }
  return null
}

export function milesFromMeters(meters) {
  const n = finite(meters)
  if (n == null || n <= 0) return null
  const miles = Math.round((n / METERS_PER_MILE) * 100) / 100
  return miles > 0 ? miles : null
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const aLat = finite(lat1)
  const aLng = finite(lng1)
  const bLat = finite(lat2)
  const bLng = finite(lng2)
  if ([aLat, aLng, bLat, bLng].some((n) => n == null)) return null
  if (Math.abs(aLat) > 90 || Math.abs(bLat) > 90 || Math.abs(aLng) > 180 || Math.abs(bLng) > 180) return null
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function segment(miles, source) {
  if (source !== 'routed' && source !== 'straight_line') {
    return { miles: null, source: 'unavailable' }
  }
  if (miles == null) return { miles: null, source: 'unavailable' }
  return { miles, source }
}

function roundMiles(miles) {
  return Math.round(miles * 100) / 100
}

/**
 * On-trip miles are the passenger leg. En-route miles are the drive to pickup
 * when a routed pickup distance or the driver's location at accept is available.
 * @param {object} trip
 * @param {{ captureEnroute?: boolean, driverLat?: number, driverLng?: number, bill?: object }} [options]
 */
export function mileageFromTrip(trip, options = {}) {
  const status = String(trip?.status || '')
  const meta = trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  const countOnTrip = status === 'completed'
  let onTrip = segment(null, 'unavailable')
  if (countOnTrip) {
    const routed = metadataMeters(meta, ON_TRIP_ROUTE_KEYS)
      ?? positiveMeters(options.bill?.distanceM ?? options.bill?.distance_m)
      ?? positiveMeters(trip?.distance_m ?? trip?.distanceM)
    if (routed != null) onTrip = segment(milesFromMeters(routed), 'routed')
    else {
      const straight = haversineMeters(trip?.pickup_lat ?? trip?.pickupLat, trip?.pickup_lng ?? trip?.pickupLng, trip?.dropoff_lat ?? trip?.dropoffLat, trip?.dropoff_lng ?? trip?.dropoffLng)
      const miles = milesFromMeters(straight)
      if (miles != null) onTrip = segment(miles, 'straight_line')
    }
  }

  const enRouted = metadataMeters(meta, ENROUTE_ROUTE_KEYS)
  let enroute = segment(null, 'unavailable')
  if (enRouted != null) enroute = segment(milesFromMeters(enRouted), 'routed')
  else if (options.captureEnroute) {
    const driverLat = options.driverLat ?? meta.accepted_driver_lat
    const driverLng = options.driverLng ?? meta.accepted_driver_lng
    const straight = haversineMeters(driverLat, driverLng, trip?.pickup_lat ?? trip?.pickupLat, trip?.pickup_lng ?? trip?.pickupLng)
    const miles = milesFromMeters(straight)
    if (miles != null) enroute = segment(miles, 'straight_line')
  }

  if (trip?.onTripSource) {
    onTrip = preferSegment(onTrip, { miles: trip.onTripMiles ?? null, source: trip.onTripSource })
  }
  if (trip?.enrouteSource) {
    enroute = preferSegment(enroute, { miles: trip.enrouteMiles ?? null, source: trip.enrouteSource })
  }

  const deductibleMiles = roundMiles((onTrip.miles || 0) + (enroute.miles || 0))
  return {
    onTripMiles: onTrip.miles,
    onTripSource: onTrip.source,
    enrouteMiles: enroute.miles,
    enrouteSource: enroute.source,
    deductibleMiles,
  }
}

export function preferSegment(current, incoming) {
  const currentRank = SOURCE_RANK[current?.source] || 0
  const incomingRank = SOURCE_RANK[incoming?.source] || 0
  if (incomingRank > currentRank) return incoming
  if (currentRank > incomingRank) return current
  if (incoming?.miles != null) return incoming
  return current?.miles != null ? current : { miles: null, source: 'unavailable' }
}

export function mergeMileage(computed, stored) {
  const onTrip = preferSegment(
    { miles: stored?.onTripMiles ?? stored?.on_trip_miles ?? null, source: stored?.onTripSource ?? stored?.on_trip_source ?? 'unavailable' },
    { miles: computed?.onTripMiles ?? null, source: computed?.onTripSource ?? 'unavailable' },
  )
  const enroute = preferSegment(
    { miles: stored?.enrouteMiles ?? stored?.enroute_miles ?? null, source: stored?.enrouteSource ?? stored?.enroute_source ?? 'unavailable' },
    { miles: computed?.enrouteMiles ?? null, source: computed?.enrouteSource ?? 'unavailable' },
  )
  return {
    onTripMiles: onTrip.miles,
    onTripSource: onTrip.source,
    enrouteMiles: enroute.miles,
    enrouteSource: enroute.source,
    deductibleMiles: roundMiles((onTrip.miles || 0) + (enroute.miles || 0)),
  }
}

export function taxYearOf(iso, timeZone = TAX_TIME_ZONE) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const year = Number(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(date))
  return Number.isInteger(year) ? year : null
}

export function localDateISO(iso, timeZone = TAX_TIME_ZONE) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const bag = {}
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }
  if (!bag.year || !bag.month || !bag.day) return null
  return `${bag.year}-${bag.month}-${bag.day}`
}

export function normalizeMileageRates(rows) {
  const source = Array.isArray(rows) && rows.length ? rows : MILEAGE_RATE_CONFIG
  const rates = []
  for (const row of source) {
    const centsPerMile = finite(row?.centsPerMile ?? row?.cents_per_mile)
    const startsOn = String(row?.startsOn ?? row?.starts_on ?? '').slice(0, 10)
    const endsOn = String(row?.endsOn ?? row?.ends_on ?? '').slice(0, 10)
    const taxYear = Number(row?.taxYear ?? row?.tax_year)
    if (centsPerMile == null || centsPerMile < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) continue
    rates.push({
      taxYear: Number.isInteger(taxYear) ? taxYear : Number(startsOn.slice(0, 4)),
      startsOn,
      endsOn,
      centsPerMile,
      label: row?.label || 'IRS business standard mileage rate',
      sourceNote: row?.sourceNote ?? row?.source_note ?? null,
    })
  }
  return rates.length ? rates : MILEAGE_RATE_CONFIG.map((row) => ({ ...row }))
}

export function rateForDate(iso, rates, timeZone = TAX_TIME_ZONE) {
  const day = localDateISO(iso, timeZone)
  if (!day) return null
  return normalizeMileageRates(rates).find((rate) => rate.startsOn <= day && day <= rate.endsOn) || null
}

export function formatMileageRate(centsPerMile) {
  const n = finite(centsPerMile)
  if (n == null) return '—'
  const body = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
  return `${body}¢`
}

export function mileageRateLabel(rates, year) {
  const bands = normalizeMileageRates(rates)
    .filter((rate) => rate.taxYear === Number(year))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
  if (!bands.length) return 'IRS standard mileage rate is not configured for this year. The deduction is not estimated.'
  const bits = bands.map((band) => `${formatMileageRate(band.centsPerMile)}/mi (${band.startsOn}–${band.endsOn})`)
  return `Estimate using the configured IRS business standard mileage rate: ${bits.join('; ')}.`
}

function tripWhen(trip) {
  return trip?.completedAt || trip?.completed_at || trip?.canceled_at || trip?.canceledAt || null
}

function tripLabel(trip, key) {
  return trip?.[key] || trip?.[key === 'pickupLabel' ? 'pickup_label' : 'dropoff_label'] || ''
}

function deductionCents(miles, centsPerMile) {
  if (miles == null || miles <= 0 || centsPerMile == null) return 0
  return Math.round(miles * centsPerMile)
}

function payoutOf(trip, payoutRow) {
  const meta = trip?.metadata?.payout && typeof trip.metadata.payout === 'object' ? trip.metadata.payout : {}
  const status = String(payoutRow?.status || trip?.payoutStatus || meta.status || '')
  const amount = payoutRow?.amount_cents ?? payoutRow?.amountCents ?? trip?.payoutCents ?? meta.amountCents
  const cents = Math.max(0, Math.round(finite(amount) || 0))
  if (status === 'paid') return { status: 'paid', cents }
  if (status === 'pending' || status === 'failed') return { status: 'pending', cents }
  return { status: '', cents: 0 }
}

/**
 * @param {object} input
 * @param {number} input.year
 * @param {string} [input.timeZone]
 * @param {object[]} [input.trips]
 * @param {object[]} [input.logs]
 * @param {object[]} [input.rates]
 * @param {object[]} [input.payoutRows]
 * @param {number} [input.grossEarningsCents]
 * @param {number|null} [input.tipsCents]
 * @param {number} [input.platformFeeCents]
 * @param {number} [input.driverNetCents]
 * @param {number|null} [input.earningsTripCount]
 */
export function buildYearEndPacket({
  year,
  timeZone = TAX_TIME_ZONE,
  trips = [],
  logs = [],
  rates,
  payoutRows = [],
  grossEarningsCents = 0,
  tipsCents = null,
  platformFeeCents = 0,
  driverNetCents = 0,
  earningsTripCount = null,
} = {}) {
  const y = Number(year)
  const rateRows = normalizeMileageRates(rates)
  const logsByTrip = new Map()
  for (const log of logs || []) {
    const id = log?.trip_id || log?.tripId
    if (id) logsByTrip.set(id, log)
  }
  const payoutByTrip = new Map()
  for (const row of payoutRows || []) {
    const id = row?.trip_id || row?.tripId
    if (id) payoutByTrip.set(id, row)
  }

  const mileageTrips = []
  let payoutsCents = 0
  let pendingPayoutCents = 0
  let rateGap = false
  for (const trip of trips || []) {
    const when = tripWhen(trip)
    if (taxYearOf(when, timeZone) !== y) continue
    const status = String(trip?.status || 'completed')
    const payout = payoutOf(trip, payoutByTrip.get(trip?.id))
    if (payout.status === 'paid') payoutsCents += payout.cents
    else if (payout.status === 'pending') pendingPayoutCents += payout.cents
    if (status !== 'completed' && status !== 'cancelled_wait') continue
    const computed = mileageFromTrip(trip, { bill: trip.bill })
    const merged = mergeMileage(computed, logsByTrip.get(trip?.id))
    const rate = rateForDate(when, rateRows, timeZone)
    if (merged.deductibleMiles > 0 && !rate) rateGap = true
    const estimatedDeductionCents = rate ? deductionCents(merged.deductibleMiles, rate.centsPerMile) : 0
    mileageTrips.push({
      id: trip.id,
      status,
      completedAt: when,
      pickupLabel: tripLabel(trip, 'pickupLabel') || 'Trip',
      dropoffLabel: tripLabel(trip, 'dropoffLabel') || 'Trip',
      ...merged,
      rateCentsPerMile: rate ? rate.centsPerMile : null,
      estimatedDeductionCents,
    })
  }
  mileageTrips.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())

  const onTripMiles = roundMiles(mileageTrips.reduce((sum, trip) => sum + (trip.onTripMiles || 0), 0))
  const enrouteMiles = roundMiles(mileageTrips.reduce((sum, trip) => sum + (trip.enrouteMiles || 0), 0))
  const deductibleMiles = roundMiles(mileageTrips.reduce((sum, trip) => sum + (trip.deductibleMiles || 0), 0))
  const estimatedDeductionCents = mileageTrips.reduce((sum, trip) => sum + (trip.estimatedDeductionCents || 0), 0)
  const enrouteUntrackedTrips = mileageTrips.filter((trip) => trip.status === 'completed' && trip.enrouteSource === 'unavailable').length

  return {
    year: y,
    timeZone,
    grossEarningsCents: Math.max(0, Math.round(Number(grossEarningsCents) || 0)),
    tipsCents: tipsCents == null ? null : Math.max(0, Math.round(Number(tipsCents) || 0)),
    platformFeeCents: Math.max(0, Math.round(Number(platformFeeCents) || 0)),
    driverNetCents: Math.max(0, Math.round(Number(driverNetCents) || 0)),
    earningsTripCount: earningsTripCount == null ? mileageTrips.length : Math.max(0, Math.round(Number(earningsTripCount) || 0)),
    payoutsCents,
    pendingPayoutCents,
    onTripMiles,
    enrouteMiles,
    deductibleMiles,
    enrouteUntrackedTrips,
    estimatedDeductionCents: deductibleMiles > 0 && estimatedDeductionCents === 0 && rateGap ? null : estimatedDeductionCents,
    estimate: true,
    rateGap,
    rateLabel: mileageRateLabel(rateRows, y),
    rates: rateRows.filter((rate) => rate.taxYear === y),
    disclaimer: TAX_NOT_ADVICE,
    mileageEstimateNote: MILEAGE_ESTIMATE_NOTE,
    stripe1099Note: STRIPE_1099_NOTE,
    stripe1099Url: STRIPE_CONNECT_1099_URL,
    form1099InfoUrl: FORM_1099_INFO_URL,
    stripeTaxReportingUrl: STRIPE_TAX_REPORTING_URL,
    trips: mileageTrips,
  }
}

function csvEscape(value) {
  const text = String(value ?? '')
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function csvMoney(cents) {
  if (cents == null) return 'not tracked'
  return (Number(cents) / 100).toFixed(2)
}

function csvMiles(miles) {
  if (miles == null) return ''
  return Number(miles).toFixed(2)
}

export function yearEndCsvFilename(year) {
  return `clemson-rides-tax-${year}.csv`
}

export function yearEndPdfFilename(year) {
  return `clemson-rides-tax-${year}.pdf`
}

/** Earnings summary plus a per-trip mileage log. */
export function buildYearEndCsv(packet) {
  const tips = packet.tipsCents == null ? 'not tracked' : csvMoney(packet.tipsCents)
  const deduction = packet.estimatedDeductionCents == null ? 'rate not configured' : csvMoney(packet.estimatedDeductionCents)
  const rows = [
    ['Clemson RIDES', 'Driver year-end earnings and mileage log'],
    ['Disclaimer', packet.disclaimer],
    ['Mileage estimate', packet.mileageEstimateNote],
    ['1099', packet.stripe1099Note],
    ['1099 forms (Stripe)', packet.stripe1099Url],
    ['1099 info', packet.form1099InfoUrl],
    ['Stripe tax reporting', packet.stripeTaxReportingUrl],
    ['Year', packet.year],
    ['Timezone', packet.timeZone],
    ['Rate', packet.rateLabel],
    ['Gross earnings (USD)', csvMoney(packet.grossEarningsCents)],
    ['Tips (USD)', tips],
    ['Platform fees (USD)', csvMoney(packet.platformFeeCents)],
    ['Payouts for this year\'s trips (USD)', csvMoney(packet.payoutsCents)],
    ['Pending payouts (USD)', csvMoney(packet.pendingPayoutCents)],
    ['Driver net (USD)', csvMoney(packet.driverNetCents)],
    ['On-trip miles', csvMiles(packet.onTripMiles)],
    ['En-route-to-pickup miles', csvMiles(packet.enrouteMiles)],
    ['Deductible miles', csvMiles(packet.deductibleMiles)],
    ['Estimated mileage deduction (USD)', deduction],
    ['Estimate', 'yes'],
    [],
    ['Completed at', 'Pickup', 'Dropoff', 'On-trip miles', 'On-trip source', 'En-route miles', 'En-route source', 'Deductible miles', 'Rate cents per mile', 'Estimated deduction (USD)'],
    ...(packet.trips || []).map((trip) => [
      trip.completedAt || '',
      trip.pickupLabel || '',
      trip.dropoffLabel || '',
      csvMiles(trip.onTripMiles),
      trip.onTripSource || '',
      csvMiles(trip.enrouteMiles),
      trip.enrouteSource || '',
      csvMiles(trip.deductibleMiles),
      trip.rateCentsPerMile == null ? '' : String(trip.rateCentsPerMile),
      csvMoney(trip.estimatedDeductionCents || 0),
    ]),
  ]
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')
}

function pdfSafe(value) {
  return String(value ?? '').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim()
}

function pdfEscape(value) {
  return pdfSafe(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function wrapPdf(text, width) {
  const words = pdfSafe(text).split(' ').filter(Boolean)
  const lines = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > width && current) {
      lines.push(current)
      current = word
    } else current = next
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function latin1Bytes(text) {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function bytesToBase64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const triple = (a << 16) | (b << 8) | c
    out += alphabet[(triple >> 18) & 63]
    out += alphabet[(triple >> 12) & 63]
    out += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '='
    out += i + 2 < bytes.length ? alphabet[triple & 63] : '='
  }
  return out
}

export function buildYearEndPdf(packet) {
  const money = (cents) => (cents == null ? 'Not tracked' : `$${(Number(cents) / 100).toFixed(2)}`)
  const blocks = [
    { text: 'Clemson RIDES', size: 20, font: 'F2', color: '0.322 0.176 0.502' },
    { text: `${packet.year} year-end earnings and mileage log`, size: 14, font: 'F2', color: '0.961 0.400 0.000' },
    { text: packet.disclaimer, size: 9, font: 'F1', color: '0.15 0.15 0.18' },
    { text: packet.mileageEstimateNote, size: 9, font: 'F1', color: '0.15 0.15 0.18' },
    { text: packet.stripe1099Note, size: 9, font: 'F1', color: '0.15 0.15 0.18' },
    { text: `1099 forms: ${packet.stripe1099Url}`, size: 9, font: 'F1', color: '0.322 0.176 0.502' },
    { text: `1099 info: ${packet.form1099InfoUrl}`, size: 9, font: 'F1', color: '0.322 0.176 0.502' },
    { text: packet.rateLabel, size: 9, font: 'F1', color: '0.15 0.15 0.18' },
    { text: `Gross earnings ${money(packet.grossEarningsCents)}`, size: 12, font: 'F2', color: '0 0 0' },
    { text: `Tips ${money(packet.tipsCents)}`, size: 12, font: 'F1', color: '0 0 0' },
    { text: `Platform fees ${money(packet.platformFeeCents)}`, size: 12, font: 'F1', color: '0 0 0' },
    { text: `Payouts ${money(packet.payoutsCents)}`, size: 12, font: 'F1', color: '0 0 0' },
    { text: `Deductible miles ${Number(packet.deductibleMiles || 0).toFixed(2)}  (on-trip ${Number(packet.onTripMiles || 0).toFixed(2)}, en route ${Number(packet.enrouteMiles || 0).toFixed(2)})`, size: 12, font: 'F2', color: '0.322 0.176 0.502' },
    { text: `Estimated mileage deduction ${packet.estimatedDeductionCents == null ? 'not estimated' : money(packet.estimatedDeductionCents)} (estimate)`, size: 12, font: 'F2', color: '0.961 0.400 0.000' },
    { text: 'Mileage log', size: 13, font: 'F2', color: '0.322 0.176 0.502' },
  ]
  for (const trip of packet.trips || []) {
    const when = trip.completedAt ? String(trip.completedAt).slice(0, 16).replace('T', ' ') : ''
    blocks.push({
      text: `${when}  ${trip.pickupLabel} to ${trip.dropoffLabel}  on-trip ${csvMiles(trip.onTripMiles) || '—'} ${trip.onTripSource}  en route ${csvMiles(trip.enrouteMiles) || '—'} ${trip.enrouteSource}  deductible ${csvMiles(trip.deductibleMiles)}`,
      size: 8,
      font: 'F1',
      color: '0.1 0.1 0.12',
    })
  }
  blocks.push({ text: 'Not tax advice. Estimate only.', size: 9, font: 'F2', color: '0.961 0.400 0.000' })

  const pages = []
  let commands = []
  let y = 750
  const pushPage = () => {
    pages.push(commands.join('\n'))
    commands = []
    y = 750
  }
  for (const block of blocks) {
    const lines = wrapPdf(block.text, block.size >= 12 ? 70 : 95)
    for (const line of lines) {
      if (y < 48) pushPage()
      commands.push('BT')
      commands.push(`/${block.font} ${block.size} Tf`)
      commands.push(`${block.color} rg`)
      commands.push(`1 0 0 1 48 ${y} Tm`)
      commands.push(`(${pdfEscape(line)}) Tj`)
      commands.push('ET')
      y -= block.size + 6
    }
    y -= 4
  }
  if (commands.length) pages.push(commands.join('\n'))
  if (!pages.length) pages.push('BT /F1 12 Tf 48 750 Td (Empty) Tj ET')

  const objects = []
  const add = (body) => {
    objects.push(body)
    return objects.length
  }
  const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
  const contentIds = pages.map((stream) => add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`))
  const pageIds = contentIds.map((contentId) => add(
    `<< /Type /Page /Parent PAGES_ID 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> >>`,
  ))
  const pagesId = add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  for (let i = 0; i < objects.length; i += 1) {
    objects[i] = objects[i].split('PAGES_ID').join(String(pagesId))
  }

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`
  return latin1Bytes(pdf)
}

export function buildYearEndPdfBase64(packet) {
  return bytesToBase64(buildYearEndPdf(packet))
}
