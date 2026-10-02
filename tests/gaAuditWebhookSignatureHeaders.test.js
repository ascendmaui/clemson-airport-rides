import test from 'node:test'
import assert from 'node:assert/strict'
import { extractStripeSignature } from '../api/stripe-webhook.js'
import stripeWebhookHandler from '../api/stripe-webhook.js'
import createCheckoutSessionHandler from '../api/create-checkout-session.js'
import airportCheckoutHandler from '../server/endpoints/airportCheckout.js'
import { json } from '../server/friendRideLib.js'

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    writableEnded: false,
    headersSent: false,
    body: '',
    setHeader(name, value) {
      if (this.headersSent) {
        throw new Error('ERR_HTTP_HEADERS_SENT: Cannot set headers after they are sent')
      }
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      if (this.writableEnded) {
        throw new Error('ERR_STREAM_WRITE_AFTER_END: write after end')
      }
      this.headersSent = true
      this.writableEnded = true
      this.body = payload == null ? '' : String(payload)
    },
  }
}

test('GA94: extractStripeSignature parses signature case-insensitively and trims whitespace', () => {
  assert.equal(extractStripeSignature(null), '')
  assert.equal(extractStripeSignature(undefined), '')
  assert.equal(extractStripeSignature('invalid'), '')
  assert.equal(extractStripeSignature({}), '')

  // standard lowercase
  assert.equal(
    extractStripeSignature({ 'stripe-signature': 't=123,v1=abc' }),
    't=123,v1=abc',
  )
  // uppercase
  assert.equal(
    extractStripeSignature({ 'STRIPE-SIGNATURE': 't=123,v1=abc' }),
    't=123,v1=abc',
  )
  // titlecase / mixed
  assert.equal(
    extractStripeSignature({ 'Stripe-Signature': 't=123,v1=abc' }),
    't=123,v1=abc',
  )
  // array representation
  assert.equal(
    extractStripeSignature({ 'stripe-signature': ['t=123,v1=abc', 'extra'] }),
    't=123,v1=abc',
  )
  // trims whitespace / newlines
  assert.equal(
    extractStripeSignature({ 'stripe-signature': '  \n\tt=123,v1=abc\r\n  ' }),
    't=123,v1=abc',
  )
})

test('GA94: webhook handler sanitizes secret keys with trailing newlines or whitespace', async () => {
  const req = {
    method: 'POST',
    headers: {},
    on(event, handler) {
      if (event === 'data') {
        handler(Buffer.from('{}'))
      } else if (event === 'end') {
        handler()
      }
      return this
    },
  }

  // Key with whitespace/newlines around placeholder is recognized as stub acknowledge
  const resStub = mockRes()
  await stripeWebhookHandler(req, resStub, {
    stripeSecret: '  \nplaceholder_secret\r\n  ',
  })
  assert.equal(resStub.statusCode, 200)
  const bodyStub = JSON.parse(resStub.body)
  assert.equal(bodyStub.stub, true)

  // Empty string or whitespace-only secret acknowledges stub
  const resEmpty = mockRes()
  await stripeWebhookHandler(req, resEmpty, {
    stripeSecret: '   \n\t  ',
  })
  assert.equal(resEmpty.statusCode, 200)
  const bodyEmpty = JSON.parse(resEmpty.body)
  assert.equal(bodyEmpty.stub, true)
})

test('GA94: sendWebhookJson and friendRideLib json defend against stream write after end', () => {
  const res = mockRes()
  res.end('already finished')

  // Calling json after writableEnded must not throw ERR_STREAM_WRITE_AFTER_END
  assert.doesNotThrow(() => {
    json(res, 200, { ok: true })
  })

  // Headers sent guard
  const resHeaders = mockRes()
  resHeaders.headersSent = true
  assert.doesNotThrow(() => {
    json(resHeaders, 200, { ok: true })
  })
})

test('GA94: checkout session and airport checkout endpoints enforce Allow: POST, OPTIONS and Cache-Control', async () => {
  // api/create-checkout-session
  const resSession = mockRes()
  await createCheckoutSessionHandler({ method: 'GET' }, resSession)
  assert.equal(resSession.statusCode, 405)
  assert.equal(resSession.headers['allow'], 'POST, OPTIONS')
  assert.equal(resSession.headers['cache-control'], 'no-store, no-cache, must-revalidate, private')
  assert.equal(resSession.headers['pragma'], 'no-cache')

  // server/endpoints/airportCheckout
  const resAirport = mockRes()
  await airportCheckoutHandler({ method: 'PUT' }, resAirport)
  assert.equal(resAirport.statusCode, 405)
  assert.equal(resAirport.headers['allow'], 'POST, OPTIONS')
  assert.equal(resAirport.headers['cache-control'], 'no-store, no-cache, must-revalidate, private')
  assert.equal(resAirport.headers['pragma'], 'no-cache')

  // api/stripe-webhook
  const resWebhook = mockRes()
  await stripeWebhookHandler({ method: 'GET' }, resWebhook)
  assert.equal(resWebhook.statusCode, 405)
  assert.equal(resWebhook.headers['allow'], 'POST')
  assert.equal(resWebhook.headers['cache-control'], 'no-store, no-cache, must-revalidate, private')
  assert.equal(resWebhook.headers['pragma'], 'no-cache')
})
