import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import handler, { createDriverTaxLink } from './endpoints/driverW9.js'
import { W9_PUBLIC_COLUMNS } from '../shared/driverW9.js'

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    end(payload) { this.body = payload == null ? '' : String(payload) },
  }
}

async function call(req, deps) {
  const res = mockRes()
  await handler(req, res, deps)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, raw: res.body }
}

function table(rows) {
  const api = {
    select() { return api },
    eq() { return api },
    maybeSingle: async () => ({ data: rows, error: null }),
  }
  return api
}

test('Stripe Connect tax updates use a hosted account link and the response has no TIN', async () => {
  let linkType = null
  const stripe = {
    accounts: { retrieve: async () => ({ details_submitted: true }) },
    accountLinks: {
      create: async (params) => {
        linkType = params.type
        return { url: 'https://connect.stripe.com/setup/s/tax' }
      },
    },
  }
  const sb = {
    from(name) {
      if (name === 'profiles') return table({ stripe_account_id: 'acct_driver', stripe_connect_id: null })
      if (name === 'driver_w9') {
        return table({
          legal_name: 'Ada Lovelace',
          tin: '123456789',
          tin_ciphertext: 'ciphertext-secret',
          tin_last4: '6789',
          certified: true,
          collection: 'app',
        })
      }
      return table(null)
    },
  }
  const res = await call(
    { method: 'GET', url: '/api/driver?action=w9', headers: { origin: 'https://clemsonrides.com' } },
    { sb, user: { id: 'driver-1' }, stripe },
  )
  assert.equal(res.status, 200)
  assert.equal(res.json.stripeConnect, true)
  assert.equal(linkType, 'account_update')
  assert.equal(res.json.updateUrl, 'https://connect.stripe.com/setup/s/tax')
  assert.equal(res.json.status.tinLast4, '6789')
  assert.equal(res.raw.includes('123456789'), false)
  assert.equal(res.raw.includes('ciphertext-secret'), false)
  assert.equal(Object.hasOwn(res.json.status, 'tin'), false)
})

test('a driver without Stripe can load status, and a posted TIN is not echoed', async () => {
  const onboarding = await createDriverTaxLink({
    accounts: { retrieve: async () => ({ details_submitted: false }) },
    accountLinks: { create: async (params) => ({ url: `https://stripe.test/${params.type}` }) },
  }, 'acct_new', 'https://clemsonrides.com')
  assert.equal(onboarding.type, 'account_onboarding')
  assert.match(onboarding.url, /account_onboarding/)

  const sb = {
    from(name) {
      if (name === 'profiles') return table(null)
      if (name === 'driver_w9') return table(null)
      if (name === 'driver_tax_info') return table({ legal_name: 'Ada', tin_last4: '6789', tax_classification: 'individual' })
      return table(null)
    },
  }
  const clean = await call(
    { method: 'GET', url: '/api/driver?action=w9', headers: {} },
    { sb, user: { id: 'driver-1' }, stripe: null },
  )
  assert.equal(clean.status, 200)
  assert.equal(clean.json.stripeConnect, false)
  assert.equal(clean.json.updateUrl, null)
  assert.equal(clean.json.status.tinLast4, '6789')

  const leaked = await call(
    { method: 'POST', headers: {}, body: { tin: '123456789', legalName: 'Ada' } },
    { sb, user: { id: 'driver-1' }, stripe: null },
  )
  assert.equal(leaked.status, 400)
  assert.equal(leaked.raw.includes('123456789'), false)
  assert.match(leaked.json.error, /does not accept or return/)
})

test('W-9 migration encrypts the TIN, turns RLS on, and lets the driver write their own row', () => {
  const file = '20261013183000_driver_w9_encrypted.sql'
  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter((name) => name.endsWith('.sql'))
  const versions = names.map((name) => name.slice(0, 14))
  assert.equal(versions.filter((version) => version === '20261013183000').length, 1)
  const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
  assert.match(sql, /create table if not exists public\.driver_w9/)
  assert.match(sql, /enable row level security/)
  assert.match(sql, /for insert/)
  assert.match(sql, /profile_id = auth\.uid\(\)/)
  assert.match(sql, /created_at timestamptz not null default now\(\)/)
  assert.match(sql, /updated_at timestamptz not null default now\(\)/)
  assert.match(sql, /pgp_sym_encrypt/)
  assert.match(sql, /grant all on table public\.driver_w9 to service_role/)
  assert.match(sql, /public\.is_admin\(\)/)
  assert.doesNotMatch(sql, /drop table/i)
  const selectGrant = sql.slice(sql.indexOf('grant select ('), sql.indexOf(') on table public.driver_w9 to authenticated'))
  assert.match(selectGrant, /tin_last4/)
  assert.doesNotMatch(selectGrant, /tin_ciphertext/)
  const returned = sql.slice(sql.lastIndexOf('return jsonb_build_object'), sql.indexOf('end;\n$$;', sql.lastIndexOf('return jsonb_build_object')))
  assert.match(returned, /tin_last4/)
  assert.doesNotMatch(returned, /'tin'\s*,/)
  assert.doesNotMatch(returned, /digits/)
  assert.doesNotMatch(returned, /tin_ciphertext/)
  const columns = W9_PUBLIC_COLUMNS.split(',').map((column) => column.trim())
  assert.equal(columns.includes('tin_ciphertext'), false)
})
