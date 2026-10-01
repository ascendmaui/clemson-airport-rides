/**
 * Canonical airport and flight detail terminology helpers.
 * Shared across Vite web and Expo mobile apps (rider and driver).
 */

/** Canonical dictionary of served airports with standard codes, names, and regional metadata. */
export const CANONICAL_AIRPORTS = Object.freeze({
  GSP: Object.freeze({
    code: 'GSP',
    name: 'Greenville-Spartanburg International Airport',
    shortLabel: 'Greenville-Spartanburg (GSP)',
    placeLabel: 'GSP Airport',
    city: 'Greer',
    state: 'SC',
    metro: 'Upstate SC',
    typicalDistanceMiles: 48,
    typicalDurationMinutes: 55,
    fallbackFareCents: 7500,
    aliases: Object.freeze([
      'gsp',
      'gsp airport',
      'greenville',
      'greenville-spartanburg',
      'greenville-spartanburg international',
      'greenville-spartanburg international (gsp)',
      'greenville-spartanburg international airport',
    ]),
  }),
  CLT: Object.freeze({
    code: 'CLT',
    name: 'Charlotte Douglas International Airport',
    shortLabel: 'Charlotte Douglas (CLT)',
    placeLabel: 'CLT Airport',
    city: 'Charlotte',
    state: 'NC',
    metro: 'Charlotte Metro',
    typicalDistanceMiles: 130,
    typicalDurationMinutes: 130,
    fallbackFareCents: 17500,
    aliases: Object.freeze([
      'clt',
      'clt airport',
      'charlotte',
      'charlotte douglas',
      'charlotte douglas international',
      'charlotte douglas international (clt)',
      'charlotte douglas international airport',
    ]),
  }),
  ATL: Object.freeze({
    code: 'ATL',
    name: 'Hartsfield-Jackson Atlanta International Airport',
    shortLabel: 'Hartsfield-Jackson Atlanta (ATL)',
    placeLabel: 'ATL Airport',
    city: 'Atlanta',
    state: 'GA',
    metro: 'Atlanta Metro',
    typicalDistanceMiles: 125,
    typicalDurationMinutes: 135,
    floorCents: 19500,
    aliases: Object.freeze([
      'atl',
      'atl airport',
      'atlanta',
      'hartsfield',
      'hartsfield-jackson',
      'hartsfield-jackson atlanta',
      'hartsfield-jackson atlanta (atl)',
      'hartsfield-jackson atlanta international airport',
    ]),
  }),
})

export const AIRPORT_CODES = Object.freeze(Object.keys(CANONICAL_AIRPORTS))

/**
 * Checks whether a code is a valid canonical airport code.
 * @param {unknown} code
 * @returns {code is 'GSP' | 'CLT' | 'ATL'}
 */
export function isAirportCode(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(CANONICAL_AIRPORTS, code.toUpperCase())
}

/**
 * Normalizes any airport input (code, label, place object) into a canonical code.
 * Supports GSP, CLT, and ATL with alias resolution.
 * @param {unknown} input
 * @returns {'GSP' | 'CLT' | 'ATL' | null}
 */
export function normalizeAirportCode(input) {
  if (!input) return null
  const raw = typeof input === 'string' ? input : (input.code || input.airport || input.label || input.name || '')
  const text = String(raw).trim().toLowerCase()
  if (!text) return null

  // Fast exact code check
  const upper = text.toUpperCase()
  if (CANONICAL_AIRPORTS[upper]) return upper

  // Check aliases
  for (const [code, info] of Object.entries(CANONICAL_AIRPORTS)) {
    if (info.aliases.some((alias) => alias === text || text.includes(alias))) {
      return code
    }
  }

  // Regex patterns
  if (/\bgsp\b|greenville/i.test(text)) return 'GSP'
  if (/\bclt\b|charlotte/i.test(text)) return 'CLT'
  if (/\batl\b|atlanta|hartsfield/i.test(text)) return 'ATL'

  return null
}

/**
 * Returns canonical airport metadata object or null.
 * @param {unknown} codeOrInput
 * @returns {typeof CANONICAL_AIRPORTS[keyof typeof CANONICAL_AIRPORTS] | null}
 */
export function getAirport(codeOrInput) {
  const code = normalizeAirportCode(codeOrInput)
  return code ? CANONICAL_AIRPORTS[code] : null
}

/**
 * Formats an airport name according to display style.
 * @param {unknown} codeOrInput
 * @param {'short' | 'full' | 'place' | 'code' | 'city'} [style='short']
 * @returns {string}
 */
export function formatAirportName(codeOrInput, style = 'short') {
  const airport = getAirport(codeOrInput)
  if (!airport) {
    return typeof codeOrInput === 'string' ? codeOrInput.trim() : ''
  }
  switch (style) {
    case 'full':
      return airport.name
    case 'place':
      return airport.placeLabel
    case 'code':
      return airport.code
    case 'city':
      return `${airport.city}, ${airport.state}`
    case 'short':
    default:
      return airport.shortLabel
  }
}

/** Standard airport trip directions */
export const AIRPORT_DIRECTIONS = Object.freeze({
  TO_AIRPORT: 'to_airport',
  FROM_AIRPORT: 'from_airport',
})

/**
 * Normalizes directional string to canonical airport direction.
 * @param {unknown} input
 * @returns {'to_airport' | 'from_airport' | null}
 */
export function normalizeAirportDirection(input) {
  if (!input) return null
  const text = String(input).trim().toLowerCase()
  if (/to[_\s-]?airport|^to$|outbound|departure/i.test(text)) return AIRPORT_DIRECTIONS.TO_AIRPORT
  if (/from[_\s-]?airport|^from$|inbound|arrival/i.test(text)) return AIRPORT_DIRECTIONS.FROM_AIRPORT
  return null
}

/**
 * User-facing formatted direction label.
 * @param {unknown} input
 * @param {{ airportCode?: string }} [options]
 * @returns {string}
 */
export function formatAirportDirection(input, { airportCode } = {}) {
  const dir = normalizeAirportDirection(input)
  const code = airportCode ? normalizeAirportCode(airportCode) : null
  if (dir === AIRPORT_DIRECTIONS.TO_AIRPORT) {
    return code ? `To ${code}` : 'To airport'
  }
  if (dir === AIRPORT_DIRECTIONS.FROM_AIRPORT) {
    return code ? `From ${code}` : 'From airport'
  }
  return ''
}

/** Common commercial airlines serving Upstate SC / CLT / ATL */
export const COMMON_AIRLINES = Object.freeze([
  { code: 'AA', name: 'American Airlines', aliases: ['american', 'aa', 'american airlines'] },
  { code: 'DL', name: 'Delta Air Lines', aliases: ['delta', 'dl', 'delta air lines', 'delta airlines'] },
  { code: 'UA', name: 'United Airlines', aliases: ['united', 'ua', 'united airlines'] },
  { code: 'WN', name: 'Southwest Airlines', aliases: ['southwest', 'wn', 'southwest airlines'] },
  { code: 'B6', name: 'JetBlue', aliases: ['jetblue', 'b6', 'jetblue airways'] },
  { code: 'AS', name: 'Alaska Airlines', aliases: ['alaska', 'as', 'alaska airlines'] },
  { code: 'NK', name: 'Spirit Airlines', aliases: ['spirit', 'nk', 'spirit airlines'] },
  { code: 'F9', name: 'Frontier Airlines', aliases: ['frontier', 'f9', 'frontier airlines'] },
  { code: 'G4', name: 'Allegiant Air', aliases: ['allegiant', 'g4', 'allegiant air'] },
])

/**
 * Parses flight details from free-form string or structured object.
 * @param {unknown} raw
 * @returns {{ airline: string | null, airlineCode: string | null, flightNumber: string | null, terminal: string | null, direction: 'to_airport' | 'from_airport' | null, rawText: string | null } | null}
 */
export function parseFlightDetails(raw) {
  if (!raw) return null
  if (typeof raw === 'object') {
    const airline = raw.airline ? String(raw.airline).trim() : null
    const flightNumber = raw.flightNumber || raw.flight_number || raw.flight || null
    const terminal = raw.terminal ? String(raw.terminal).trim() : null
    const direction = normalizeAirportDirection(raw.direction || raw.arrivalDeparture)
    return {
      airline,
      airlineCode: raw.airlineCode || null,
      flightNumber: flightNumber ? String(flightNumber).trim() : null,
      terminal,
      direction,
      rawText: raw.rawText || null,
    }
  }

  const text = String(raw).trim()
  if (!text) return null

  let detectedAirline = null
  let detectedAirlineCode = null
  for (const al of COMMON_AIRLINES) {
    for (const alias of al.aliases) {
      const re = new RegExp(`\\b${alias}\\b`, 'i')
      if (re.test(text)) {
        detectedAirline = al.name
        detectedAirlineCode = al.code
        break
      }
    }
    if (detectedAirline) break
  }

  // Look for flight number e.g. "DL 1234", "AA123", "Flight #452", or standalone digits like "1234"
  let flightNumber = null
  const fnMatch = text.match(/(?:flight\s*#?|#|\b[A-Z]{2}\s*|\b)([0-9]{2,4})\b/i)
  if (fnMatch) {
    flightNumber = fnMatch[1]
  }

  // Look for terminal e.g. "Terminal A", "Term 2", "Concourse B"
  let terminal = null
  const termMatch = text.match(/\b(terminal\s*[a-z0-9]+|concourse\s*[a-z0-9]+|term\s*[a-z0-9]+)\b/i)
  if (termMatch) {
    terminal = termMatch[1].replace(/term\b/i, 'Terminal').replace(/\s+/g, ' ')
  }

  const direction = normalizeAirportDirection(text)

  return {
    airline: detectedAirline,
    airlineCode: detectedAirlineCode,
    flightNumber: flightNumber ? (detectedAirlineCode ? `${detectedAirlineCode} ${flightNumber}` : flightNumber) : null,
    terminal,
    direction,
    rawText: text,
  }
}

/**
 * Formats a concise, user-friendly flight summary line.
 * @param {unknown} flight
 * @returns {string}
 */
export function formatFlightSummary(flight) {
  if (!flight) return ''
  const parsed = typeof flight === 'string' ? parseFlightDetails(flight) : flight
  if (!parsed) return ''

  const parts = []
  if (parsed.flightNumber) {
    const fn = String(parsed.flightNumber).trim()
    if (/^[A-Z]{2}\s*\d+/i.test(fn)) {
      parts.push(fn.replace(/^([A-Z]{2})\s*(\d+)/i, '$1 $2').toUpperCase())
    } else if (parsed.airline) {
      parts.push(`${parsed.airline} ${fn}`)
    } else {
      parts.push(`Flight #${fn.replace(/^#\s*/, '')}`)
    }
  } else if (parsed.airline) {
    parts.push(parsed.airline)
  }

  if (parsed.terminal) {
    parts.push(parsed.terminal)
  }

  if (parsed.direction) {
    parts.push(formatAirportDirection(parsed.direction))
  }

  return parts.join(' · ') || parsed.rawText || ''
}

/**
 * Extracts parsed flight details from a rider note if flight keywords or patterns are detected.
 * @param {unknown} note
 * @returns {ReturnType<typeof parseFlightDetails>}
 */
export function extractFlightFromNote(note) {
  if (!note || typeof note !== 'string') return null
  const details = parseFlightDetails(note)
  if (details && (details.flightNumber || details.terminal || details.airline)) {
    return details
  }
  return null
}

/** Standard airport pricing & deposit terminology */
export const AIRPORT_DEPOSIT_PERCENT = 25
export const AIRPORT_DEPOSIT_LABEL = '25% airport deposit'
export const AIRPORT_REMAINING_LABEL = 'Remaining balance (due upon completion)'
export const AIRPORT_SCHEDULE_NOTICE =
  'Hold an airport ride with a 25% deposit. A date keeps the ride scheduled for drivers to accept. Leave the date empty to request a driver now.'

/**
 * Returns consistent deposit breakdown copy and metadata.
 * @param {{ fareCents?: number, depositCents?: number, remainingCents?: number | null, isStudent?: boolean, studentDiscountCents?: number }} [params]
 */
export function formatAirportDepositSummary({
  fareCents = 0,
  depositCents = 0,
  remainingCents = null,
  isStudent = false,
  studentDiscountCents = 0,
} = {}) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  const deposit = Math.max(0, Math.round(Number(depositCents) || 0))
  const remaining = remainingCents == null ? Math.max(0, fare - deposit) : Math.max(0, Math.round(Number(remainingCents) || 0))
  const discount = Math.max(0, Math.round(Number(studentDiscountCents) || 0))

  return {
    depositLabel: AIRPORT_DEPOSIT_LABEL,
    remainingLabel: AIRPORT_REMAINING_LABEL,
    depositPercent: AIRPORT_DEPOSIT_PERCENT,
    isStudent: Boolean(isStudent || discount > 0),
    notice: AIRPORT_SCHEDULE_NOTICE,
    fareCents: fare,
    depositCents: deposit,
    remainingCents: remaining,
    studentDiscountCents: discount,
  }
}
