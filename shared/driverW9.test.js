import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  W9_PUBLIC_COLUMNS,
  responseContainsTin,
  tinFormatIssue,
  toPublicW9,
  w9FormIssue,
  w9StatusLabel,
} from './driverW9.js'

const valid = {
  legalName: 'Ada Lovelace',
  businessName: '',
  taxClassification: 'individual',
  address: '1 Campus Drive',
  tin: '123-45-6789',
  tinKind: 'ssn',
  certified: true,
  signatureName: 'Ada Lovelace',
  signedOn: '2026-10-13',
}

test('W-9 validation requires a real TIN and certification', () => {
  assert.equal(w9FormIssue(valid), null)
  assert.equal(w9FormIssue({ ...valid, tin: '12-3456789', tinKind: 'ein' }), null)
  assert.match(w9FormIssue({ ...valid, tin: '1234' }), /9-digit/)
  assert.match(w9FormIssue({ ...valid, tin: '000-12-3456' }), /valid SSN/)
  assert.match(w9FormIssue({ ...valid, tin: '666-12-3456' }), /valid SSN/)
  assert.match(w9FormIssue({ ...valid, tin: '900-12-3456' }), /valid SSN/)
  assert.match(w9FormIssue({ ...valid, tin: '123-00-6789' }), /valid SSN/)
  assert.match(w9FormIssue({ ...valid, tin: '00-1234567', tinKind: 'ein' }), /valid EIN/)
  assert.equal(tinFormatIssue('123456789', 'ssn'), null)
  assert.match(w9FormIssue({ ...valid, certified: false }), /Certification is required/)
  assert.match(w9FormIssue({ ...valid, signatureName: 'A' }), /legal name to sign/)
  assert.match(w9FormIssue({ ...valid, signedOn: '10/13/2026' }), /YYYY-MM-DD/)
  assert.match(w9FormIssue({ ...valid, taxClassification: 'nope' }), /classification/)
  assert.match(w9FormIssue({ ...valid, address: 'x' }), /address/)
})

test('the public W-9 shape never includes the TIN', () => {
  const pub = toPublicW9({
    legal_name: 'Ada Lovelace',
    tin: '123456789',
    tin_ciphertext: 'ciphertext-secret',
    ssn: '123-45-6789',
    ein: '12-3456789',
    tin_last4: '6789',
    tin_kind: 'ssn',
    certified: true,
    signed_on: '2026-10-13',
    collection: 'app',
  })
  const body = JSON.stringify(pub)
  assert.equal(responseContainsTin(pub, '123456789'), false)
  assert.equal(body.includes('123456789'), false)
  assert.equal(body.includes('ciphertext-secret'), false)
  assert.equal(body.includes('123-45-6789'), false)
  assert.equal(pub.tinLast4, '6789')
  assert.equal(toPublicW9({ tin_last4: '123456789' }).tinLast4, null)
  const columns = W9_PUBLIC_COLUMNS.split(',').map((column) => column.trim())
  assert.equal(columns.includes('tin'), false)
  assert.equal(columns.includes('tin_ciphertext'), false)
  assert.equal(columns.includes('tin_last4'), true)
  assert.match(w9StatusLabel({ status: pub }), /••••6789/)
  assert.match(w9StatusLabel({ stripeConnect: true, stripeDetailsSubmitted: true, status: null }), /Stripe/)
})

test('driver W-9 screens navigate to the form and do not read the ciphertext', () => {
  const tax = readFileSync(new URL('../apps/driver/app/tax.tsx', import.meta.url), 'utf8')
  const w9 = readFileSync(new URL('../apps/driver/app/w9.tsx', import.meta.url), 'utf8')
  const web = readFileSync(new URL('../src/screens/DriverW9.jsx', import.meta.url), 'utf8')
  const earnings = readFileSync(new URL('../src/screens/DriverEarnings.jsx', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../packages/rides-native/driverW9Client.js', import.meta.url), 'utf8')
  assert.match(tax, /router\.push\('\/w9'\)/)
  assert.match(w9, /Legal name/)
  assert.match(w9, /Business name/)
  assert.match(w9, /Federal tax classification/)
  assert.match(w9, /TIN \(SSN or EIN\)/)
  assert.match(w9, /I certify/)
  assert.match(w9, /E-signature/)
  assert.match(earnings, /navigate\('driver-w9'\)/)
  assert.match(earnings, /Update W-9/)
  assert.match(web, /data-testid="w9-form"/)
  assert.match(web, /Certification is required|w9FormIssue/)
  assert.doesNotMatch(client, /select\([^)]*tin_ciphertext/)
  assert.doesNotMatch(client, /admin_read_driver_w9_tin/)
  assert.doesNotMatch(w9, /admin_read_driver_w9_tin/)
  assert.doesNotMatch(web, /admin_read_driver_w9_tin/)
})
