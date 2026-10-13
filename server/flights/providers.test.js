import test from 'node:test'
import assert from 'node:assert/strict'
import { flightProvider, parseAeroApi, parseAeroDataBox, parseAviationStack } from './providers.js'

test('no key means provider none and zero rows (scheduled-only fallback)', async () => {
  const p = flightProvider({})
  assert.equal(p.name, 'none')
  assert.deepEqual(await p.arrivals('GSP', new Date(), new Date()), [])
})

test('key precedence: AeroDataBox, then AeroAPI, then AviationStack', () => {
  assert.equal(flightProvider({ AERODATABOX_API_KEY: 'a', FLIGHTAWARE_AEROAPI_KEY: 'b' }).name, 'aerodatabox')
  assert.equal(flightProvider({ FLIGHTAWARE_AEROAPI_KEY: 'b', AVIATIONSTACK_API_KEY: 'c' }).name, 'flightaware')
  assert.equal(flightProvider({ AVIATIONSTACK_API_KEY: 'c' }).name, 'aviationstack')
})

test('AeroDataBox arrivals normalize', async () => {
  const json = { arrivals: [
    { number: 'DL 1234', status: 'Expected', departure: { airport: { iata: 'ATL' } }, movement: { scheduledTime: { utc: '2026-10-12 18:00Z' }, revisedTime: { utc: '2026-10-12 18:25Z' }, terminal: null, gate: 'A5' } },
    { number: 'AA 55', status: 'Arrived', movement: { scheduledTime: { utc: '2026-10-12 17:00Z' }, revisedTime: { utc: '2026-10-12 16:52Z' } } },
    { number: '', movement: {} },
  ] }
  const rows = parseAeroDataBox(json)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { flight_number: 'DL 1234', airline_code: 'DL', origin: 'ATL', status: 'Expected', scheduled_at: '2026-10-12T18:00:00.000Z', estimated_at: '2026-10-12T18:25:00.000Z', actual_at: null, terminal: null, gate: 'A5' })
  assert.equal(rows[1].actual_at, '2026-10-12T16:52:00.000Z')
  assert.equal(rows[1].estimated_at, null)
  let seen
  const p = flightProvider({ AERODATABOX_API_KEY: 'k' }, { fetch: async (url, init) => { seen = { url, init }; return { ok: true, json: async () => json } } })
  await p.arrivals('GSP', new Date('2026-10-12T16:00:00Z'), new Date('2026-10-12T22:00:00Z'))
  assert.match(seen.url, /\/flights\/airports\/iata\/GSP\/2026-10-12T12:00\/2026-10-12T18:00\?direction=Arrival/)
  assert.equal(seen.init.headers['X-RapidAPI-Key'], 'k')
})

test('AeroAPI and AviationStack normalize', () => {
  const a = parseAeroApi({ arrivals: [{ ident_iata: 'UA1', status: 'Landed', scheduled_on: '2026-10-12T18:00:00Z', estimated_on: '2026-10-12T18:05:00Z', actual_on: '2026-10-12T18:04:00Z', origin: { code_iata: 'ORD' } }] })
  assert.equal(a[0].flight_number, 'UA 1')
  assert.equal(a[0].actual_at, '2026-10-12T18:04:00.000Z')
  assert.equal(a[0].estimated_at, null)
  const v = parseAviationStack({ data: [{ flight: { iata: 'WN204' }, flight_status: 'active', arrival: { scheduled: '2026-10-12T14:00:00+00:00', estimated: '2026-10-12T14:12:00+00:00', actual: null } }] })
  assert.equal(v[0].flight_number, 'WN 204')
  assert.equal(v[0].estimated_at, '2026-10-12T14:12:00.000Z')
})

test('HTTP errors throw (ingest records last_error, writes nothing)', async () => {
  const p = flightProvider({ AERODATABOX_API_KEY: 'k' }, { fetch: async () => ({ ok: false, status: 429 }) })
  await assert.rejects(() => p.arrivals('GSP', new Date(), new Date()), /HTTP 429/)
})
