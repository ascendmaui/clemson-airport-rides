import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { DRIVER_CLICKWRAP_VERSION } from '../shared/driverClickwrap.js'
import { handleDriverClickwrap, publicAcceptance, saveClickwrapAcceptance } from './driverClickwrap.js'

function memoryDb() {
  const rows = []
  return {
    rows,
    from(table) {
      if (table !== 'driver_clickwrap_acceptances') throw new Error(`unexpected table ${table}`)
      return {
        upsert(row) {
          const existing = rows.find((item) => item.user_id === row.user_id && item.agreement_version === row.agreement_version)
          if (existing) Object.assign(existing, row)
          else rows.push({ ...row })
          const saved = rows.find((item) => item.user_id === row.user_id && item.agreement_version === row.agreement_version)
          return {
            select() {
              return { async maybeSingle() { return { data: saved, error: null } } }
            },
          }
        },
        select() {
          const filters = []
          const query = {
            eq(column, value) {
              filters.push([column, value])
              return query
            },
            async maybeSingle() {
              const found = rows.find((row) => filters.every(([column, value]) => row[column] === value)) || null
              return { data: found, error: null }
            },
          }
          return query
        },
      }
    },
  }
}

function response() {
  return {
    statusCode: 0,
    writableEnded: false,
    headersSent: false,
    body: null,
    setHeader() {},
    end(payload) {
      this.body = JSON.parse(payload)
      this.writableEnded = true
    },
  }
}

test('acceptance is stored with user id, version, timestamp, app version, and ip', async () => {
  const sb = memoryDb()
  const res = response()
  const when = new Date('2026-10-13T15:04:00.000Z')
  await handleDriverClickwrap({
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.20, 10.0.0.1' },
    body: { agreementVersion: DRIVER_CLICKWRAP_VERSION, appVersion: '1.1.0' },
  }, res, { sb, user: { id: 'driver-9' }, now: () => when })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.accepted, true)
  assert.equal(res.body.acceptance.userId, 'driver-9')
  assert.equal(res.body.acceptance.agreementVersion, DRIVER_CLICKWRAP_VERSION)
  assert.equal(res.body.acceptance.acceptedAt, '2026-10-13T15:04:00.000Z')
  assert.equal(res.body.acceptance.appVersion, '1.1.0')
  assert.equal(res.body.acceptance.ip, '198.51.100.20')
  assert.equal(sb.rows.length, 1)

  const again = response()
  await handleDriverClickwrap({ method: 'GET' }, again, { sb, user: { id: 'driver-9' } })
  assert.equal(again.body.accepted, true)
  assert.equal(again.body.requiredVersion, DRIVER_CLICKWRAP_VERSION)
  assert.equal(mayProceed(again.body.acceptance), true)
})

test('a driver with no row, a stale version, or no session cannot proceed', async () => {
  const sb = memoryDb()
  await saveClickwrapAcceptance(sb, {
    user_id: 'driver-9',
    agreement_version: 'driver-clickwrap-2026-01-01',
    accepted_at: '2026-01-01T00:00:00.000Z',
    app_version: null,
    ip_address: null,
  })
  const stale = response()
  await handleDriverClickwrap({ method: 'GET' }, stale, { sb, user: { id: 'driver-9' } })
  assert.equal(stale.body.accepted, false)
  assert.equal(stale.body.acceptance, null)

  const missingUser = response()
  await handleDriverClickwrap({ method: 'POST', body: {} }, missingUser, { sb, user: null })
  assert.equal(missingUser.statusCode, 401)

  const old = response()
  await handleDriverClickwrap({
    method: 'POST',
    headers: {},
    body: { agreementVersion: 'driver-clickwrap-2026-01-01', appVersion: '1.1.0' },
  }, old, { sb, user: { id: 'driver-9' }, now: () => new Date('2026-10-13T15:04:00.000Z') })
  assert.equal(old.statusCode, 400)
  assert.equal(sb.rows.some((row) => row.agreement_version === DRIVER_CLICKWRAP_VERSION), false)
})

test('a new agreement version is a new row and does not erase the older one', async () => {
  const sb = memoryDb()
  await saveClickwrapAcceptance(sb, {
    user_id: 'driver-9',
    agreement_version: 'driver-clickwrap-2026-01-01',
    accepted_at: '2026-01-01T00:00:00.000Z',
    app_version: '1.0.0',
    ip_address: null,
  })
  await saveClickwrapAcceptance(sb, {
    user_id: 'driver-9',
    agreement_version: DRIVER_CLICKWRAP_VERSION,
    accepted_at: '2026-10-13T15:04:00.000Z',
    app_version: '1.1.0',
    ip_address: '203.0.113.8',
  })
  assert.equal(sb.rows.length, 2)
  const current = publicAcceptance(sb.rows.find((row) => row.agreement_version === DRIVER_CLICKWRAP_VERSION))
  assert.equal(current.userId, 'driver-9')
  assert.equal(current.appVersion, '1.1.0')
  assert.equal(current.ip, '203.0.113.8')
})

test('the migration adds the acceptance table and does not drop existing tables', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261013140000_driver_clickwrap_acceptances.sql', import.meta.url), 'utf8')
  assert.match(sql, /create table if not exists public\.driver_clickwrap_acceptances/)
  assert.match(sql, /user_id uuid not null/)
  assert.match(sql, /agreement_version text not null/)
  assert.match(sql, /accepted_at timestamptz not null/)
  assert.match(sql, /app_version text/)
  assert.match(sql, /ip_address text/)
  assert.match(sql, /unique \(user_id, agreement_version\)/)
  const executable = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(executable, /drop table/i)
  assert.doesNotMatch(executable, /delete from/i)
  const versions = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, 14))
  assert.equal(versions.filter((version) => version === '20261013140000').length, 1)
})

function mayProceed(acceptance) {
  return Boolean(acceptance?.userId && acceptance.agreementVersion === DRIVER_CLICKWRAP_VERSION && acceptance.acceptedAt)
}
