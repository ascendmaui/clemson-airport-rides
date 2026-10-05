import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import Stripe from 'stripe'
import handler, { runningOnVercel } from '../server/endpoints/driverPayouts.js'
import { resolveLanguageModel } from '../server/llm.js'
import {
  applyRewrites,
  createApp,
  discoverApiRoutes,
  loadRewrites,
} from '../server/selfHost.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API_DIR = path.join(ROOT, 'api')

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.headersSent = true
      this.writableEnded = true
      this.body = payload == null ? '' : String(payload)
    },
  }
}

function parseJson(res) {
  return JSON.parse(res.body || '{}')
}

function mockTrips(trips) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                order() {
                  return {
                    limit: async () => ({ data: trips, error: null }),
                  }
                },
              }
            },
          }
        },
      }
    },
  }
}

function httpRequest(port, { method = 'GET', path: reqPath = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: buf,
          text: buf.toString('utf8'),
        })
      })
    })
    req.on('error', reject)
    if (body) req.end(body)
    else req.end()
  })
}

describe('self-host server', { concurrency: 1 }, () => {
test('live AI logs a clear offline line and does not leak key material', () => {
  const savedGateway = process.env.AI_GATEWAY_API_KEY
  const savedOpenAI = process.env.OPENAI_API_KEY
  const leaked = 'sk-test-should-not-appear-in-logs'
  const lines = []
  const original = console.error
  console.error = (...args) => {
    lines.push(args.map((part) => String(part)).join(' '))
  }
  try {
    delete process.env.AI_GATEWAY_API_KEY
    delete process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = leaked
    delete process.env.OPENAI_API_KEY
    const resolved = resolveLanguageModel()
    assert.equal(resolved, null)
    assert.equal(lines.length >= 1, true)
    assert.match(lines[0], /AI_GATEWAY_API_KEY/)
    assert.match(lines[0], /OPENAI_API_KEY/)
    assert.match(lines[0], /VERCEL_OIDC_TOKEN/)
    assert.equal(lines.join('\n').includes(leaked), false)
  } finally {
    console.error = original
    if (savedGateway === undefined) delete process.env.AI_GATEWAY_API_KEY
    else process.env.AI_GATEWAY_API_KEY = savedGateway
    if (savedOpenAI === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = savedOpenAI
  }
})

test('vercel.json rewrites resolve to the same destinations Vercel uses', () => {
  const rules = loadRewrites(path.join(ROOT, 'vercel.json'))
  const webhook = applyRewrites('/api/stripe/webhook', '', rules)
  assert.equal(webhook.pathname, '/api/stripe-webhook')

  const payouts = applyRewrites('/api/driver-payouts', '?dry_run=1', rules)
  assert.equal(payouts.pathname, '/api/driver')
  assert.match(payouts.search, /action=payouts/)
  assert.match(payouts.search, /dry_run=1/)

  const carpool = applyRewrites('/api/carpool/group', '', rules)
  assert.equal(carpool.pathname, '/api/carpool')
  assert.match(carpool.search, /action=group/)

  const help = applyRewrites('/api/help-chat', '', rules)
  assert.equal(help.pathname, '/api/admin-drivers')
  assert.match(help.search, /action=help-chat/)

  const page = applyRewrites('/schedule', '', rules)
  assert.equal(page.pathname, '/index.html')

  const unknown = applyRewrites('/api/does-not-exist', '', rules)
  assert.equal(unknown.pathname, '/api/does-not-exist')
})

test('route discovery mounts every api handler file', async () => {
  const files = readdirSync(API_DIR).filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))
  const routes = await discoverApiRoutes(API_DIR)
  assert.equal(routes.size, files.length)
  for (const file of files) {
    const routePath = `/api/${file.slice(0, -3)}`
    assert.equal(routes.has(routePath), true, routePath)
    assert.equal(typeof routes.get(routePath).handler, 'function')
  }
  assert.equal(routes.get('/api/stripe-webhook').rawBody, true)
  assert.equal(routes.has('/api/stripeWebhookValidation.test'), false)
})

test('self-hosted server serves the SPA, health, rewrites, and raw Stripe body', async () => {
  const distDir = await mkdtemp(path.join(tmpdir(), 'clemson-dist-'))
  const savedSha = process.env.GIT_SHA
  const savedStripe = process.env.STRIPE_SECRET_KEY
  const savedWebhook = process.env.STRIPE_WEBHOOK_SECRET
  process.env.GIT_SHA = 'abc123selfhost'
  const stripeKey = 'sk_test_selfhost_not_a_real_key'
  const webhookSecret = 'whsec_selfhost_not_a_real_secret'
  process.env.STRIPE_SECRET_KEY = stripeKey
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret
  const listener = await createApp({
    distDir,
    apiDir: API_DIR,
    vercelPath: path.join(ROOT, 'vercel.json'),
    log() {},
  })
  const server = http.createServer(listener)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    await mkdir(path.join(distDir, 'assets'), { recursive: true })
    await writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>Clemson</title>')
    await writeFile(path.join(distDir, 'assets', 'app-Abc123hash.js'), 'console.log("asset")')

    const health = await httpRequest(port, { path: '/api/healthz' })
    assert.equal(health.status, 200)
    const healthBody = JSON.parse(health.text)
    assert.deepEqual(Object.keys(healthBody).sort(), ['ok', 'sha', 'uptime'])
    assert.equal(healthBody.ok, true)
    assert.equal(healthBody.sha, 'abc123selfhost')
    assert.equal(typeof healthBody.uptime, 'number')
    assert.equal(JSON.stringify(healthBody).includes('CRON'), false)
    assert.equal(JSON.stringify(healthBody).includes('SECRET'), false)

    const home = await httpRequest(port, { path: '/schedule' })
    assert.equal(home.status, 200)
    assert.match(home.text, /Clemson/)
    assert.match(String(home.headers['cache-control']), /no-cache/)
    assert.match(String(home.headers['content-type']), /text\/html/)

    const asset = await httpRequest(port, { path: '/assets/app-Abc123hash.js' })
    assert.equal(asset.status, 200)
    assert.equal(asset.text, 'console.log("asset")')
    assert.match(String(asset.headers['cache-control']), /immutable/)

    const missingApi = await httpRequest(port, { path: '/api/does-not-exist' })
    assert.equal(missingApi.status, 404)
    assert.equal(JSON.parse(missingApi.text).error, 'Not found')
    assert.match(String(missingApi.headers['content-type']), /json/)

    const routes = await discoverApiRoutes(API_DIR)
    for (const routePath of routes.keys()) {
      const hit = await httpRequest(port, { path: routePath })
      assert.notEqual(hit.status, 404, routePath)
    }

    const legacy = await httpRequest(port, { path: '/api/driver-signup', method: 'GET' })
    assert.notEqual(legacy.status, 404)

    const payloadObject = {
      id: 'evt_selfhost',
      object: 'event',
      type: 'customer.created',
      data: { object: { id: 'cus_selfhost', object: 'customer', name: 'Ride café' } },
    }
    const payload = JSON.stringify(payloadObject)
    const stripe = new Stripe(stripeKey)
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret })
    const signed = await httpRequest(port, {
      method: 'POST',
      path: '/api/stripe/webhook',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
        'stripe-signature': signature,
      },
      body: payload,
    })
    assert.equal(signed.status, 200, signed.text)
    const signedBody = JSON.parse(signed.text)
    assert.equal(signedBody.received, true)
    assert.equal(signedBody.type, 'customer.created')

    const tampered = await httpRequest(port, {
      method: 'POST',
      path: '/api/stripe-webhook',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(`${payload} `)),
        'stripe-signature': signature,
      },
      body: `${payload} `,
    })
    assert.equal(tampered.status, 400)
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
    await rm(distDir, { recursive: true, force: true })
    if (savedSha === undefined) delete process.env.GIT_SHA
    else process.env.GIT_SHA = savedSha
    if (savedStripe === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = savedStripe
    if (savedWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = savedWebhook
  }
})

test('payout cron accepts bearer alone off Vercel, rejects a missing bearer, and dry-run moves no money', async () => {
  assert.equal(runningOnVercel({}), false)
  assert.equal(runningOnVercel({ VERCEL: '1' }), true)

  const trip = {
    id: 'trip_dry',
    driver_id: 'driver_1',
    fare_cents: 5000,
    status: 'completed',
    metadata: {
      payout: { status: 'pending', amountCents: 4000, attempts: 0, nextRetryAt: null },
    },
  }
  let transfers = 0
  let writes = 0
  const deps = {
    sb: mockTrips([trip]),
    cronSecret: 'cron-test-secret',
    env: {},
    stripe: {
      transfers: {
        create: async () => {
          transfers += 1
          return { id: 'tr_should_not_run' }
        },
      },
    },
    writePayout: async () => {
      writes += 1
    },
    attemptDriverPayout: async () => {
      transfers += 1
      return { ok: true, payout: { status: 'paid', attempts: 1 } }
    },
  }

  const dry = mockRes()
  await handler({
    method: 'GET',
    url: '/api/driver-payouts?dry_run=1',
    query: { dry_run: '1' },
    headers: { authorization: 'Bearer cron-test-secret' },
  }, dry, deps)
  assert.equal(dry.statusCode, 200)
  const dryBody = parseJson(dry)
  assert.equal(dryBody.ok, true)
  assert.equal(dryBody.dryRun, true)
  assert.equal(dryBody.results.length, 1)
  assert.equal(dryBody.results[0].tripId, 'trip_dry')
  assert.equal(dryBody.results[0].amountCents, 4000)
  assert.equal(dryBody.results[0].wouldTransfer, true)
  assert.equal(transfers, 0)
  assert.equal(writes, 0)

  const denied = mockRes()
  await handler({
    method: 'POST',
    url: '/api/driver-payouts?dry_run=1',
    query: { dry_run: '1' },
    headers: {},
  }, denied, deps)
  assert.equal(denied.statusCode, 401)
  assert.equal(transfers, 0)
  assert.equal(writes, 0)

  const spoofed = mockRes()
  await handler({
    method: 'POST',
    url: '/api/driver-payouts',
    headers: { 'x-vercel-cron': '1' },
  }, spoofed, deps)
  assert.equal(spoofed.statusCode, 401)
  assert.equal(transfers, 0)
})
})
