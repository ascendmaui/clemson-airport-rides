import test from 'node:test'
import assert from 'node:assert/strict'
import { rentalEmail, notify } from '../server/rentalNotify.js'

test('rental emails cover every notification and never mention payment on platform', () => {
  for (const k of ['partner_applied', 'partner_approved', 'partner_rejected', 'listing_reviewed', 'driver_interested', 'request_accepted', 'request_declined']) {
    const m = rentalEmail(k, { businessName: 'Tiger Rentals', vehicle: '2021 Toyota Camry', decision: 'approved' })
    assert.ok(m.subject && m.text, k)
  }
  assert.match(rentalEmail('request_accepted', { businessName: 'X', vehicle: 'Y' }).text, /off-platform/)
  assert.match(rentalEmail('driver_interested', { vehicle: 'Y' }).text, /after you accept/)
})

test('notify uses the injected sender (no real email in tests) and skips empty recipients', async () => {
  const sent = []
  await notify('partner_approved', ['a@example.test', '', null], { businessName: 'B' }, async (m) => { sent.push(m); return { emailed: false } })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'a@example.test')
})

test('partners API module loads and rejects unknown actions without touching Supabase', async () => {
  const { default: handler } = await import('../api/partners.js')
  let status = 0
  const res = { statusCode: 0, setHeader() {}, status(c) { status = c; return this }, json() { return this }, end() {}, writeHead(c) { status = c } }
  await handler({ method: 'GET', url: '/api/partners?action=nope', headers: {} }, res)
  assert.ok(status === 404 || res.statusCode === 404)
})
