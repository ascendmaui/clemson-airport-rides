import test from 'node:test'
import assert from 'node:assert/strict'
import { configuredAirports, sweepFlightArrivals } from './flightArrivalsSweep.js'

function fakeSb({ lastRun = null, waves = [] } = {}) {
  const log = []
  const table = (name) => {
    const q = { name, op: 'select' }
    const res = () => {
      if (name === 'flight_ingest_runs' && q.op === 'select') return { data: lastRun ? { last_run_at: lastRun } : null, error: null }
      if (name === 'airport_wave_alerts' && q.op === 'upsert') return { data: [{ airport: 'GSP' }], error: null }
      if (name === 'driver_status') return { data: [{ driver_id: 'd1' }], error: null }
      if (name === 'driver_applications') return { data: [{ profile_id: 'd1' }], error: null }
      if (name === 'trips') return { data: [], error: null }
      return { data: null, error: null }
    }
    const chain = new Proxy({}, {
      get(_, k) {
        if (k === 'then') return (ok, bad) => Promise.resolve(res()).then(ok, bad)
        if (k === 'maybeSingle') return () => Promise.resolve(res())
        return (...args) => {
          if (['upsert', 'update', 'delete', 'insert'].includes(k)) { q.op = k; log.push({ table: name, op: k, args }) }
          return chain
        }
      },
    })
    return chain
  }
  return { log, from: table, rpc: async (fn, args) => { log.push({ rpc: fn, args }); return fn === 'airport_arrival_waves' ? { data: waves, error: null } : { data: true, error: null } } }
}

test('airports default to GSP and accept CLT/ATL', () => {
  assert.deepEqual(configuredAirports({}), ['GSP'])
  assert.deepEqual(configuredAirports({ FLIGHT_AIRPORTS: 'gsp, clt,XYZ' }), ['GSP', 'CLT'])
})

test('throttled to every 5 minutes', async () => {
  const sb = fakeSb({ lastRun: '2026-10-12T17:58:00Z' })
  const out = await sweepFlightArrivals(sb, { now: new Date('2026-10-12T18:00:00Z'), env: {}, provider: { name: 'none', arrivals: async () => { throw new Error('should not call') } } })
  assert.equal(out.airports[0].state, 'throttled')
})

test('no provider: no feed rows, still alerts on booked rider-entered waves', async () => {
  const wave = { wave_start: '2026-10-12T18:20:00Z', wave_end: '2026-10-12T18:40:00Z', stage_at: '2026-10-12T18:02:00Z', flights: 0, booked_pickups: 1, score: 3, data_quality: 'rider_entered' }
  const sb = fakeSb({ waves: [wave] })
  const pushes = []
  const out = await sweepFlightArrivals(sb, { now: new Date('2026-10-12T18:00:00Z'), env: {}, push: async (_sb, ids, msg) => { pushes.push({ ids, msg }); return { sent: 1 } } })
  assert.equal(out.provider, 'none')
  assert.equal(out.upserted, 0)
  assert.ok(!sb.log.some((l) => l.table === 'flight_arrivals' && l.op === 'upsert'))
  assert.equal(out.alerted, 1)
  assert.deepEqual(pushes[0].ids, ['d1'])
  assert.match(pushes[0].msg.body, /Stage at the GSP cell lot/)
})
