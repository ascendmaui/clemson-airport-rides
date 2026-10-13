import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { IC_AGREEMENT_HTML, IC_AGREEMENT_VERSION } from '../shared/icAgreement.js'
import { buildAgreementPrefill, renderPrefilledAgreement } from '../shared/agreementPrefill.js'
import { approvalBlockers } from '../shared/driverOnboarding.js'
import {
  AGREEMENT_TEXT_LOCKED,
  EMAIL_NOT_CONFIGURED,
  adminResendSetupBanner,
  assessSignLink,
  agreementSendOutcome,
  emailSenderConfigured,
  particularUpdates,
  rejectAgreementTextEdit,
} from '../shared/agreementSign.js'
import { attachUnsignedPacket, packetFromSources } from '../server/agreementPacket.js'
import {
  hashToken,
  sendAgreementForSignature,
  signFromLink,
} from '../server/agreementMail.js'

const sampleInput = {
  legalName: 'Ada Lovelace',
  fullName: 'Ada',
  address: '1 Campus Drive, Clemson, SC',
  phone: '8645550100',
  email: 'ada@clemson.edu',
  applicantEmail: 'ada.driver@example.com',
  vehicle: { make: 'Honda', model: 'Civic', color: 'Blue', plate: 'ABC123', seats: 4 },
  licenseOnFile: true,
  taxClassification: 'individual',
  businessName: '',
  tinLast4: '6789',
  workEligibilityCategory: 'citizen',
}

test('prefill maps application fields and keeps the canonical agreement as a prefix', () => {
  const prefill = buildAgreementPrefill(sampleInput)
  assert.equal(prefill.legal_name, 'Ada Lovelace')
  assert.equal(prefill.mailing_address, '1 Campus Drive, Clemson, SC')
  assert.equal(prefill.phone, '8645550100')
  assert.equal(prefill.email, 'ada.driver@example.com')
  assert.equal(prefill.vehicle_make, 'Honda')
  assert.equal(prefill.vehicle_model, 'Civic')
  assert.equal(prefill.vehicle_color, 'Blue')
  assert.equal(prefill.vehicle_plate, 'ABC123')
  assert.equal(prefill.vehicle_seats, '4')
  assert.equal(prefill.license, 'Driver license photos (front and back) on file')
  assert.equal(prefill.tax_classification, 'Individual / sole proprietor')
  assert.equal(prefill.tin_last4, '6789')
  assert.equal(prefill.work_eligibility, 'U.S. citizen')
  assert.equal(prefill.business_name, 'Not provided')

  const hostile = buildAgreementPrefill({
    legalName: 'Ada <script>alert(1)</script>',
    tinLast4: '123456789',
  })
  assert.equal(hostile.tin_last4, 'Not provided')
  const html = renderPrefilledAgreement(hostile)
  assert.ok(html.startsWith(IC_AGREEMENT_HTML))
  assert.match(html, /data-agreement-particulars/)
  assert.equal(html.includes('<script>'), false)
  assert.match(html, /Ada &lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.equal(html.includes('123456789'), false)
})

test('submitting an application stores an unsigned packet and does not email it', async () => {
  const route = readFileSync(new URL('../server/driverRoutes.js', import.meta.url), 'utf8')
  assert.match(route, /attachUnsignedPacket/)
  assert.match(route, /notifyAdminOfApplication/)
  assert.equal(route.includes('sendAgreementForSignature'), false)
  assert.equal(route.includes('api.resend.com'), false)
  const attachAt = route.indexOf('await attachUnsignedPacket')
  const notifyAt = route.indexOf('await notifyAdminOfApplication')
  assert.ok(attachAt > 0 && attachAt < notifyAt)

  let fetched = false
  const sb = scriptedSb({
    'profiles:select': { data: { full_name: 'Ada Lovelace', email: 'ada@clemson.edu', phone: '8645550100' }, error: null },
    'driver_applications:select': { data: { applicant_email: 'ada.driver@example.com', work_eligibility_category: 'citizen' }, error: null },
    'vehicles:select': { data: { id: 'veh', make: 'Honda', model: 'Civic', color: 'Blue', plate: 'ABC123', seats: 4 }, error: null },
    'driver_documents:select': { data: [{ doc_type: 'license_front' }, { doc_type: 'license_back' }], error: null },
    'driver_tax_info:select': { data: { legal_name: 'Ada Lovelace', tin_last4: '6789', tax_classification: 'individual', address_line: '1 Campus Drive', business_name: null }, error: null },
    'driver_agreement_packets:upsert': { data: null, error: null },
  })
  const attached = await attachUnsignedPacket(sb, 'driver-1', new Date('2026-10-05T00:00:00Z'))
  assert.equal(fetched, false)
  assert.equal(attached.emailed, false)
  assert.equal(attached.error, undefined)
  assert.ok(attached.packet.html.startsWith(IC_AGREEMENT_HTML))
  assert.equal(attached.packet.version, IC_AGREEMENT_VERSION)
  assert.equal(attached.packet.prefill.legal_name, 'Ada Lovelace')
  assert.equal(attached.packet.prefill.tin_last4, '6789')
  const upsert = sb.calls.find((call) => call.action === 'upsert')
  assert.equal(upsert.payload.html_snapshot, attached.packet.html)
  assert.equal(upsert.payload.agreement_version, IC_AGREEMENT_VERSION)
})

test('only an admin can email the agreement, and a missing sender fails without throwing', async () => {
  const store = memoryStore()
  const packet = packetFromSources('driver-1', { prefillInput: sampleInput })
  store.packet = packet
  let fetched = false
  const denied = await sendAgreementForSignature({
    isAdmin: false,
    profileId: 'driver-1',
    adminId: 'admin-1',
    to: 'ada@clemson.edu',
    packet,
    env: {},
    store,
    fetchImpl: () => {
      fetched = true
      throw new Error('network')
    },
  })
  assert.equal(denied.status, 403)
  assert.equal(denied.body.emailed, false)
  assert.equal(denied.body.ok, undefined)
  assert.equal(store.sends.length, 0)
  assert.equal(fetched, false)

  const missing = await sendAgreementForSignature({
    isAdmin: true,
    profileId: 'driver-1',
    adminId: 'admin-1',
    to: 'ada@clemson.edu',
    packet,
    env: { RESEND_API_KEY: '', RESEND_FROM: '' },
    now: new Date('2026-10-05T00:00:00Z'),
    store,
    createToken: () => ({ token: 'one-time-token', tokenHash: hashToken('one-time-token') }),
    fetchImpl: () => {
      fetched = true
      throw new Error('network')
    },
  })
  assert.equal(emailSenderConfigured({}), false)
  assert.equal(adminResendSetupBanner({}), true)
  assert.equal(adminResendSetupBanner({
    RESEND_API_KEY: 're_live',
    RESEND_FROM: 'Clemson RIDES <rides@clemsonrides.com>',
    ADMIN_NOTIFY_EMAIL: '',
  }), false)
  assert.equal(adminResendSetupBanner({
    RESEND_API_KEY: 're_placeholder_key',
    RESEND_FROM: 'rides@clemsonrides.com',
  }), true)
  assert.equal(missing.status, 503)
  assert.equal(missing.body.emailed, false)
  assert.equal(missing.body.ok, undefined)
  assert.notEqual(missing.body.ok, true)
  assert.equal(missing.body.message, EMAIL_NOT_CONFIGURED)
  assert.equal(missing.body.error, EMAIL_NOT_CONFIGURED)
  assert.equal(missing.body.copyable, true)
  assert.match(missing.body.signing_url, /#\/sign-agreement\?token=one-time-token/)
  assert.equal(fetched, false)
  const outcome = agreementSendOutcome(missing.body)
  assert.equal(outcome.copyable, true)
  assert.equal(outcome.emailed, false)
  assert.match(outcome.message, /Copy this signing link/)
  assert.match(outcome.signingUrl, /sign-agreement/)
  assert.equal(store.sends.length, 1)
  assert.equal(store.sends[0].result, 'not_configured')
  assert.equal(store.sends[0].to, 'ada@clemson.edu')
  assert.equal(store.sends[0].adminId, 'admin-1')
  assert.equal(JSON.stringify(store.sends).includes('one-time-token'), false)
})

test('signing links expire, belong to one driver, and approval blocks a version or hash mismatch', async () => {
  const now = Date.parse('2026-10-05T12:00:00Z')
  const link = {
    profile_id: 'driver-1',
    expires_at: '2026-10-06T12:00:00Z',
    used_at: null,
    revoked_at: null,
  }
  assert.equal(assessSignLink({ link, viewerId: 'driver-1', now }).ok, true)
  assert.equal(assessSignLink({ link, viewerId: 'other', now }).reason, 'owner')
  assert.equal(assessSignLink({
    link: { ...link, expires_at: '2026-10-05T11:00:00Z' },
    viewerId: 'driver-1',
    now,
  }).reason, 'expired')
  assert.equal(assessSignLink({ link: { ...link, used_at: '2026-10-05T01:00:00Z' }, viewerId: 'driver-1', now }).reason, 'used')

  const store = memoryStore()
  const packet = packetFromSources('driver-1', { prefillInput: sampleInput })
  store.packet = packet
  await sendAgreementForSignature({
    isAdmin: true,
    profileId: 'driver-1',
    adminId: 'admin-1',
    to: 'ada@clemson.edu',
    packet,
    env: {},
    now: new Date(now),
    store,
    createToken: () => ({ token: 'sign-token', tokenHash: hashToken('sign-token') }),
    fetchImpl: () => {
      throw new Error('should not send')
    },
  })

  const other = await signFromLink({
    viewerId: 'other-driver',
    token: 'sign-token',
    signatureName: 'Ada Lovelace',
    accepted: true,
    now: new Date(now),
    store,
  })
  assert.equal(other.status, 403)
  assert.match(other.body.error, /another driver/)
  assert.equal(store.signatures.length, 0)

  store.links[0].expiresAt = '2026-10-04T00:00:00Z'
  const expired = await signFromLink({
    viewerId: 'driver-1',
    token: 'sign-token',
    signatureName: 'Ada Lovelace',
    accepted: true,
    now: new Date(now),
    store,
  })
  assert.equal(expired.status, 403)
  assert.match(expired.body.error, /expired/)

  store.links[0].expiresAt = '2026-10-12T00:00:00Z'
  const signed = await signFromLink({
    viewerId: 'driver-1',
    token: 'sign-token',
    signatureName: 'Ada Lovelace',
    accepted: true,
    ip: '203.0.113.8',
    userAgent: 'TestAgent',
    now: new Date(now),
    store,
  })
  assert.equal(signed.status, 200)
  assert.equal(signed.body.agreement_sha256, packet.sha256)
  assert.equal(signed.body.html_snapshot, packet.html)
  assert.equal(store.signatures[0].ip, '203.0.113.8')
  assert.equal(store.signatures[0].userAgent, 'TestAgent')
  assert.equal(store.signatures[0].version, IC_AGREEMENT_VERSION)
  assert.equal(store.links[0].used_at, new Date(now).toISOString())

  const again = await signFromLink({
    viewerId: 'driver-1',
    token: 'sign-token',
    signatureName: 'Ada Lovelace',
    accepted: true,
    now: new Date(now),
    store,
  })
  assert.equal(again.status, 403)

  const base = {
    uploaded: [],
    backgroundAuthorized: true,
    workEligibilityAttested: true,
    workEligibilityCategory: 'citizen',
    taxSaved: true,
    agreementSigned: true,
    agreementVersion: 'ic-agreement-2020-01-01',
    agreementSha256: 'old',
    packetHash: packet.sha256,
  }
  assert.ok(approvalBlockers(base).includes('ic_agreement'))
  assert.ok(approvalBlockers({
    ...base,
    agreementVersion: IC_AGREEMENT_VERSION,
    agreementSha256: 'different',
  }).includes('ic_agreement'))
  assert.equal(approvalBlockers({
    ...base,
    agreementVersion: IC_AGREEMENT_VERSION,
    agreementSha256: packet.sha256,
    uploaded: ['license_front', 'license_back', 'insurance_front', 'insurance_back', 'registration', 'car_front', 'car_back', 'car_left', 'car_right'],
  }).includes('ic_agreement'), false)
})

test('agreement text cannot be edited; corrections re-render from application fields', () => {
  const rejected = rejectAgreementTextEdit({ html: '<p>rewritten</p>', particulars: { legal_name: 'Ada' } })
  assert.equal(rejected.status, 400)
  assert.equal(rejected.body.error, AGREEMENT_TEXT_LOCKED)
  assert.equal(rejectAgreementTextEdit({ agreementHtml: 'x' }).body.error, AGREEMENT_TEXT_LOCKED)
  assert.equal(rejectAgreementTextEdit({ particulars: { legal_name: 'Ada' } }), null)
  const updates = particularUpdates({
    particulars: { legal_name: ' Ada ', vehicle_seats: '4', html: 'nope' },
    html: '<p>no</p>',
  })
  assert.equal(updates.legal_name, 'Ada')
  assert.equal(updates.vehicle_seats, '4')
  assert.equal(updates.html, undefined)
  const rendered = renderPrefilledAgreement(buildAgreementPrefill({ legalName: updates.legal_name }))
  assert.ok(rendered.startsWith(IC_AGREEMENT_HTML))
  assert.equal(rendered.includes('<p>no</p>'), false)
})

test('the current agreement version is a new row and does not rewrite the repaired seed', () => {
  const retired = readFileSync(new URL('../supabase/driver_onboarding_compliance.sql', import.meta.url), 'utf8')
  assert.equal(retired.includes('$html$'), false)
  assert.equal(retired.includes('body_html = excluded.body_html'), false)
  const sql = readFileSync(new URL('../supabase/migrations/20261005090000_ic_agreement_version_row.sql', import.meta.url), 'utf8')
  assert.equal(sql.includes('$html$'), false)
  assert.equal(sql.includes('ic-agreement-2026-09-24'), false)
  assert.match(sql, /on conflict \(version\) do nothing/)
  const encoded = sql.match(/decode\(\s*'([A-Za-z0-9+/=]+)'/)
  assert.ok(encoded)
  const body = Buffer.from(encoded[1], 'base64').toString('utf8')
  assert.equal(body, IC_AGREEMENT_HTML)
  assert.equal(body.split('<h1>').length - 1, 1)
  assert.equal(sql.split(encoded[1]).length - 1, 1)
})

test('the new migration splits submit from approval and leaves the older migration unchanged', () => {
  const older = readFileSync(new URL('../supabase/migrations/20261004140000_applicant_electronic_requirements.sql', import.meta.url), 'utf8')
  assert.match(older, /signature_name/)
  const sql = readFileSync(new URL('../supabase/migrations/20261005080000_prefilled_agreement_sign.sql', import.meta.url), 'utf8')
  const submitFn = sql.slice(sql.indexOf('function public.driver_submission_ready'), sql.indexOf('function public.driver_approval_ready'))
  assert.equal(submitFn.includes('signature_name'), false)
  assert.match(sql, /function public.driver_approval_ready/)
  assert.match(sql, /driver_approval_ready\(target_profile\)/)
  assert.match(sql, /Email sender not configured|not_configured/)
  assert.match(sql, /driver_agreement_sends/)
  assert.match(sql, /token_hash/)
  assert.equal(sql.includes('john@gmail.com'), false)
})

function scriptedSb(handlers) {
  const calls = []
  return {
    calls,
    from(table) {
      const op = { table, action: 'select', filters: [], payload: null }
      function finish() {
        calls.push({ table: op.table, action: op.action, payload: op.payload, filters: [...op.filters] })
        const handler = handlers[`${table}:${op.action}`] || { data: null, error: null }
        return Promise.resolve(handler)
      }
      const builder = {
        select() { return builder },
        insert(payload) { op.action = 'insert'; op.payload = payload; return builder },
        update(payload) { op.action = 'update'; op.payload = payload; return builder },
        upsert(payload, opts) { op.action = 'upsert'; op.payload = payload; op.opts = opts; return builder },
        eq(col, val) { op.filters.push([col, val]); return builder },
        order() { return builder },
        limit() { return builder },
        is() { return builder },
        maybeSingle() { return finish() },
        then(resolve, reject) { return finish().then(resolve, reject) },
      }
      return builder
    },
  }
}

function memoryStore() {
  const sends = []
  const links = []
  const signatures = []
  return {
    sends,
    links,
    signatures,
    packet: null,
    async revokeUnusedLinks() {},
    async insertLink(row) {
      const saved = { ...row, id: `link-${links.length + 1}`, used_at: null, revoked_at: null }
      links.push(saved)
      return { id: saved.id }
    },
    async insertSend(row) { sends.push(row) },
    async loadLinkByHash(tokenHash) {
      const row = links.find((link) => link.tokenHash === tokenHash)
      if (!row) return null
      return {
        id: row.id,
        profile_id: row.profileId,
        packet_sha256: row.packetSha256,
        expires_at: row.expiresAt,
        used_at: row.used_at,
        revoked_at: row.revoked_at,
      }
    },
    async loadPacket() { return this.packet },
    async markLinkUsed(id, usedAt) {
      const row = links.find((link) => link.id === id)
      row.used_at = usedAt
    },
    async saveSignature(row) { signatures.push(row) },
  }
}
