import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CANONICAL_AIRPORTS,
  AIRPORT_CODES,
  isAirportCode,
  normalizeAirportCode,
  getAirport,
  formatAirportName,
  AIRPORT_DIRECTIONS,
  normalizeAirportDirection,
  formatAirportDirection,
  COMMON_AIRLINES,
  parseFlightDetails,
  formatFlightSummary,
  extractFlightFromNote,
  AIRPORT_DEPOSIT_PERCENT,
  AIRPORT_DEPOSIT_LABEL,
  AIRPORT_REMAINING_LABEL,
  AIRPORT_SCHEDULE_NOTICE,
  formatAirportDepositSummary,
} from '../packages/rides-native/airportCopy.js'

test('CANONICAL_AIRPORTS dictionary contains GSP, CLT, and ATL with complete metadata', () => {
  assert.deepEqual(AIRPORT_CODES, ['GSP', 'CLT', 'ATL'])

  const gsp = CANONICAL_AIRPORTS.GSP
  assert.equal(gsp.code, 'GSP')
  assert.equal(gsp.shortLabel, 'Greenville-Spartanburg (GSP)')
  assert.equal(gsp.placeLabel, 'GSP Airport')
  assert.equal(gsp.city, 'Greer')
  assert.equal(gsp.state, 'SC')
  assert.equal(gsp.typicalDistanceMiles, 48)

  const clt = CANONICAL_AIRPORTS.CLT
  assert.equal(clt.code, 'CLT')
  assert.equal(clt.shortLabel, 'Charlotte Douglas (CLT)')
  assert.equal(clt.placeLabel, 'CLT Airport')
  assert.equal(clt.city, 'Charlotte')
  assert.equal(clt.state, 'NC')
  assert.equal(clt.typicalDistanceMiles, 130)

  const atl = CANONICAL_AIRPORTS.ATL
  assert.equal(atl.code, 'ATL')
  assert.equal(atl.shortLabel, 'Hartsfield-Jackson Atlanta (ATL)')
  assert.equal(atl.placeLabel, 'ATL Airport')
  assert.equal(atl.city, 'Atlanta')
  assert.equal(atl.state, 'GA')
  assert.equal(atl.floorCents, 19500)
})

test('isAirportCode validates canonical airport codes', () => {
  assert.equal(isAirportCode('GSP'), true)
  assert.equal(isAirportCode('gsp'), true)
  assert.equal(isAirportCode('CLT'), true)
  assert.equal(isAirportCode('ATL'), true)
  assert.equal(isAirportCode('LAX'), false)
  assert.equal(isAirportCode(''), false)
  assert.equal(isAirportCode(null), false)
  assert.equal(isAirportCode(undefined), false)
})

test('normalizeAirportCode resolves airport strings, labels, and objects', () => {
  // Case insensitivity & whitespace
  assert.equal(normalizeAirportCode('gsp'), 'GSP')
  assert.equal(normalizeAirportCode('  CLT  '), 'CLT')
  assert.equal(normalizeAirportCode('atl'), 'ATL')

  // Label aliases
  assert.equal(normalizeAirportCode('Greenville-Spartanburg International (GSP)'), 'GSP')
  assert.equal(normalizeAirportCode('GSP Airport'), 'GSP')
  assert.equal(normalizeAirportCode('Greenville'), 'GSP')

  assert.equal(normalizeAirportCode('Charlotte Douglas International (CLT)'), 'CLT')
  assert.equal(normalizeAirportCode('CLT Airport'), 'CLT')
  assert.equal(normalizeAirportCode('Charlotte'), 'CLT')

  assert.equal(normalizeAirportCode('Hartsfield-Jackson Atlanta (ATL)'), 'ATL')
  assert.equal(normalizeAirportCode('ATL Airport'), 'ATL')
  assert.equal(normalizeAirportCode('Atlanta'), 'ATL')
  assert.equal(normalizeAirportCode('Hartsfield'), 'ATL')

  // Objects
  assert.equal(normalizeAirportCode({ code: 'GSP' }), 'GSP')
  assert.equal(normalizeAirportCode({ airport: 'CLT' }), 'CLT')
  assert.equal(normalizeAirportCode({ label: 'Hartsfield-Jackson Atlanta (ATL)' }), 'ATL')

  // Invalid
  assert.equal(normalizeAirportCode('JFK Airport'), null)
  assert.equal(normalizeAirportCode(''), null)
  assert.equal(normalizeAirportCode(null), null)
  assert.equal(normalizeAirportCode(undefined), null)
})

test('getAirport returns full canonical airport object or null', () => {
  const gsp = getAirport('gsp airport')
  assert.ok(gsp)
  assert.equal(gsp.name, 'Greenville-Spartanburg International Airport')

  assert.equal(getAirport('nonexistent'), null)
  assert.equal(getAirport(null), null)
})

test('formatAirportName formats airport labels in requested styles', () => {
  assert.equal(formatAirportName('GSP', 'short'), 'Greenville-Spartanburg (GSP)')
  assert.equal(formatAirportName('GSP', 'full'), 'Greenville-Spartanburg International Airport')
  assert.equal(formatAirportName('GSP', 'place'), 'GSP Airport')
  assert.equal(formatAirportName('GSP', 'code'), 'GSP')
  assert.equal(formatAirportName('GSP', 'city'), 'Greer, SC')

  assert.equal(formatAirportName('CLT', 'short'), 'Charlotte Douglas (CLT)')
  assert.equal(formatAirportName('ATL', 'short'), 'Hartsfield-Jackson Atlanta (ATL)')

  // Fallback for unknown
  assert.equal(formatAirportName('Unknown Hub', 'short'), 'Unknown Hub')
  assert.equal(formatAirportName(null, 'short'), '')
})

test('normalizeAirportDirection and formatAirportDirection handle to/from airport', () => {
  assert.equal(normalizeAirportDirection('to_airport'), AIRPORT_DIRECTIONS.TO_AIRPORT)
  assert.equal(normalizeAirportDirection('to'), AIRPORT_DIRECTIONS.TO_AIRPORT)
  assert.equal(normalizeAirportDirection('outbound'), AIRPORT_DIRECTIONS.TO_AIRPORT)
  assert.equal(normalizeAirportDirection('departure'), AIRPORT_DIRECTIONS.TO_AIRPORT)

  assert.equal(normalizeAirportDirection('from_airport'), AIRPORT_DIRECTIONS.FROM_AIRPORT)
  assert.equal(normalizeAirportDirection('from'), AIRPORT_DIRECTIONS.FROM_AIRPORT)
  assert.equal(normalizeAirportDirection('inbound'), AIRPORT_DIRECTIONS.FROM_AIRPORT)
  assert.equal(normalizeAirportDirection('arrival'), AIRPORT_DIRECTIONS.FROM_AIRPORT)

  assert.equal(normalizeAirportDirection('random'), null)
  assert.equal(normalizeAirportDirection(null), null)

  assert.equal(formatAirportDirection('to_airport'), 'To airport')
  assert.equal(formatAirportDirection('to_airport', { airportCode: 'GSP' }), 'To GSP')
  assert.equal(formatAirportDirection('from_airport'), 'From airport')
  assert.equal(formatAirportDirection('from_airport', { airportCode: 'CLT' }), 'From CLT')
  assert.equal(formatAirportDirection(null), '')
})

test('COMMON_AIRLINES and flight detail parsing/formatting', () => {
  assert.ok(COMMON_AIRLINES.length >= 5)

  // String parsing with airline, flight number, and terminal
  const parsed1 = parseFlightDetails('Delta DL 1234, Terminal B, arrival')
  assert.equal(parsed1.airline, 'Delta Air Lines')
  assert.equal(parsed1.airlineCode, 'DL')
  assert.equal(parsed1.flightNumber, 'DL 1234')
  assert.equal(parsed1.terminal, 'Terminal B')
  assert.equal(parsed1.direction, 'from_airport')

  // Short airline and flight number
  const parsed2 = parseFlightDetails('AA 452')
  assert.equal(parsed2.airline, 'American Airlines')
  assert.equal(parsed2.airlineCode, 'AA')
  assert.equal(parsed2.flightNumber, 'AA 452')

  // Object input
  const parsedObj = parseFlightDetails({
    airline: 'United Airlines',
    flightNumber: 'UA 890',
    terminal: 'Concourse C',
    direction: 'to_airport',
  })
  assert.equal(parsedObj.airline, 'United Airlines')
  assert.equal(parsedObj.flightNumber, 'UA 890')
  assert.equal(parsedObj.terminal, 'Concourse C')
  assert.equal(parsedObj.direction, 'to_airport')

  // Format flight summary
  const summary1 = formatFlightSummary(parsed1)
  assert.equal(summary1, 'DL 1234 · Terminal B · From airport')

  const summary2 = formatFlightSummary(parsed2)
  assert.equal(summary2, 'AA 452')

  const summaryObj = formatFlightSummary(parsedObj)
  assert.equal(summaryObj, 'UA 890 · Concourse C · To airport')

  assert.equal(formatFlightSummary(null), '')

  // extractFlightFromNote
  assert.equal(extractFlightFromNote(''), null)
  assert.equal(extractFlightFromNote('Just waiting by the curb with luggage'), null)

  const extracted = extractFlightFromNote('Landing on Southwest WN 182, Terminal 2')
  assert.ok(extracted)
  assert.equal(extracted.airline, 'Southwest Airlines')
  assert.equal(extracted.flightNumber, 'WN 182')
  assert.equal(extracted.terminal, 'Terminal 2')
})

test('formatAirportDepositSummary standardizes airport deposit copy and calculations', () => {
  assert.equal(AIRPORT_DEPOSIT_PERCENT, 25)
  assert.equal(AIRPORT_DEPOSIT_LABEL, '25% airport deposit')
  assert.equal(AIRPORT_REMAINING_LABEL, 'Remaining balance (due upon completion)')
  assert.ok(AIRPORT_SCHEDULE_NOTICE.includes('25% deposit'))

  const summary = formatAirportDepositSummary({
    fareCents: 7500,
    depositCents: 1875,
    isStudent: true,
    studentDiscountCents: 750,
  })

  assert.equal(summary.depositLabel, '25% airport deposit')
  assert.equal(summary.remainingLabel, 'Remaining balance (due upon completion)')
  assert.equal(summary.depositPercent, 25)
  assert.equal(summary.fareCents, 7500)
  assert.equal(summary.depositCents, 1875)
  assert.equal(summary.remainingCents, 5625)
  assert.equal(summary.studentDiscountCents, 750)
  assert.equal(summary.isStudent, true)
})
