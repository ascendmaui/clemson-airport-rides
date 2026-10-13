import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { inspectionSubmitted } from '../packages/rides-native/vehicleInspection.js'
import {
  INBOX_KINDS,
  STUCK_AFTER_MS,
  WEB_ADMIN_URL,
  buildAdminInbox,
  inboxActionRequest,
  inspectionPacketOnFile,
  isManualDocumentStatus,
  isPhotoReviewStatus,
} from './adminInbox.js'

const NOW = new Date('2026-10-13T18:00:00.000Z')
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString()
const ahead = (ms) => new Date(NOW.getTime() + ms).toISOString()

const POST_ADMIN = new Set(['info-request', 'ticket-reply'])
const GET_ADMIN = new Set(['trips', 'tickets', 'overview'])

test('stuck window matches the existing stale-trip sweep', () => {
  const sweep = fs.readFileSync(new URL('../server/staleTripSweep.js', import.meta.url), 'utf8')
  assert.match(sweep, /export const STALE_TRIP_MS = 15 \* 60 \* 1000/)
  assert.equal(STUCK_AFTER_MS, 15 * 60 * 1000)
})

test('manual document and photo statuses include the pending and manual-review queues', () => {
  assert.equal(isManualDocumentStatus('pending'), true)
  assert.equal(isManualDocumentStatus('pending_manual_review'), true)
  assert.equal(isManualDocumentStatus('manual-review'), true)
  assert.equal(isManualDocumentStatus('needs_review'), true)
  assert.equal(isManualDocumentStatus('approved'), false)
  assert.equal(isPhotoReviewStatus('pending_manual_review'), true)
  assert.equal(isPhotoReviewStatus('pending_admin_review'), true)
  assert.equal(isPhotoReviewStatus('approved'), false)
})

test('inspection packet matches the driver inspection rule', () => {
  const docs = [
    { doc_type: 'inspection_front', storage_path: 'a', review_status: 'pending' },
    { doc_type: 'inspection_back', storage_path: 'b', review_status: 'pending' },
    { doc_type: 'inspection_left', storage_path: 'c', review_status: 'pending' },
    { doc_type: 'inspection_right', storage_path: 'd', review_status: 'pending' },
    { doc_type: 'inspection_form', storage_path: 'e', review_status: 'pending', inspection_source: 'uber' },
  ]
  assert.equal(inspectionPacketOnFile(docs), inspectionSubmitted(docs))
  assert.equal(inspectionPacketOnFile(docs.map((row) => ({ ...row, review_status: 'rejected' }))), false)
})

function inbox(extra = {}) {
  return buildAdminInbox({
    profiles: {
      drv: { id: 'drv', full_name: 'Ada Driver', email: 'ada@clemson.edu', stripe_account_id: 'acct_1', stripe_payouts_enabled: false },
      rider: { id: 'rider', full_name: 'Bo Rider' },
    },
    documents: [
      { id: 'doc-old', profile_id: 'drv', doc_type: 'license_front', review_status: 'pending_manual_review', created_at: ago(10 * 86400000) },
      { id: 'doc-new', profile_id: 'drv', doc_type: 'registration', review_status: 'needs_review', match_status: 'mismatch', created_at: ago(60000) },
      { id: 'doc-ok', profile_id: 'drv', doc_type: 'insurance_front', review_status: 'approved', created_at: ago(86400000) },
    ],
    photos: [
      { id: 'photo-1', profileId: 'drv', name: 'Ada Driver', reviewStatus: 'pending_manual_review', aiReason: 'Blurry', createdAt: ago(2 * 3600000) },
      { id: 'photo-ok', profileId: 'drv', reviewStatus: 'approved', createdAt: ago(86400000) },
    ],
    applications: [
      {
        id: 'app-1',
        profile_id: 'drv',
        onboarding_status: 'pending_review',
        submitted_at: ago(3 * 3600000),
        background_check_status: 'pending',
      },
      {
        id: 'app-done',
        profile_id: 'other',
        onboarding_status: 'approved',
        background_authorized_at: ago(86400000),
        background_check_status: 'authorized',
      },
    ],
    deadlines: [
      { profile_id: 'drv', first_approved_at: ago(40 * 86400000), inspection_due_at: ago(2 * 86400000) },
      { profile_id: 'soon', first_approved_at: ago(20 * 86400000), inspection_due_at: ahead(2 * 86400000) },
      { profile_id: 'later', first_approved_at: ago(86400000), inspection_due_at: ahead(20 * 86400000) },
      { profile_id: 'filed', first_approved_at: ago(40 * 86400000), inspection_due_at: ago(86400000) },
    ],
    inspectionDocuments: [
      { profile_id: 'filed', doc_type: 'inspection_front', storage_path: 'f', review_status: 'pending', inspection_source: null },
      { profile_id: 'filed', doc_type: 'inspection_back', storage_path: 'b', review_status: 'pending' },
      { profile_id: 'filed', doc_type: 'inspection_left', storage_path: 'l', review_status: 'pending' },
      { profile_id: 'filed', doc_type: 'inspection_right', storage_path: 'r', review_status: 'pending' },
      { profile_id: 'filed', doc_type: 'inspection_form', storage_path: 'form', review_status: 'pending', inspection_source: 'lyft' },
    ],
    lostItems: [
      { id: 'lost-1', reporter_id: 'rider', reporter_role: 'rider', description: 'black backpack', status: 'open', opened_at: ago(5 * 3600000) },
      { id: 'lost-done', status: 'resolved', opened_at: ago(86400000) },
    ],
    tickets: [
      {
        id: 'tix-1',
        category: 'safety',
        status: 'escalated',
        subject: 'Report trip chat',
        body: 'Reported message ID: m1\nReported message text: hello',
        created_at: ago(4 * 3600000),
      },
      { id: 'tix-done', category: 'safety', status: 'resolved', subject: 'Report trip chat', body: 'Reported message text: old', created_at: ago(86400000) },
      { id: 'tix-other', category: 'safety', status: 'open', subject: 'SOS follow up', body: 'Not a chat report', created_at: ago(86400000) },
    ],
    trips: [
      {
        id: 'hold-1',
        status: 'searching',
        driver_id: 'drv',
        pickup_label: 'Tillman',
        dropoff_label: 'GSP',
        created_at: ago(30 * 60000),
        metadata: { payment_hold: { status: 'payment_required', code: 'card_declined' } },
      },
      {
        id: 'stuck-1',
        status: 'in_progress',
        driver_id: 'drv',
        pickup_label: 'Library',
        dropoff_label: 'CLT',
        accepted_at: ago(20 * 60000),
        created_at: ago(25 * 60000),
        metadata: {},
      },
      {
        id: 'fresh-1',
        status: 'accepted',
        accepted_at: ago(2 * 60000),
        created_at: ago(3 * 60000),
        metadata: {},
      },
      {
        id: 'paid-1',
        status: 'completed',
        driver_id: 'drv',
        created_at: ago(86400000),
        metadata: { payout: { status: 'paid', amountCents: 800 } },
      },
      {
        id: 'payout-1',
        status: 'completed',
        driver_id: 'drv',
        dropoff_label: 'GSP',
        created_at: ago(2 * 86400000),
        metadata: { payout: { status: 'pending', attempts: 2, lastError: 'account_closed' } },
      },
      {
        id: 'e2e',
        status: 'in_progress',
        accepted_at: ago(2 * 3600000),
        metadata: { e2e_test: true },
      },
      {
        id: 'later-sched',
        status: 'scheduled',
        pickup_at: ahead(3600000),
        created_at: ago(86400000),
        metadata: {},
      },
    ],
    payoutEvents: [
      { id: 'pe-1', driver_id: 'drv', status: 'failed', event_type: 'payout.failed', amount_cents: 4200, created_at: ago(6 * 3600000) },
      { id: 'pe-ok', driver_id: 'drv', status: 'paid', amount_cents: 100, created_at: ago(86400000) },
    ],
    approvedDrivers: [
      { profile_id: 'drv', onboarding_status: 'approved', reviewed_at: ago(30 * 86400000) },
      { profile_id: 'taxed', onboarding_status: 'approved', reviewed_at: ago(86400000) },
    ],
    taxRows: [
      { profile_id: 'taxed', legal_name: 'Kim Example', tin_last4: '6789' },
    ],
    w9Rows: [],
    ...extra,
  }, NOW)
}

test('inbox lists every attention queue, with age, sorted by urgency then age', () => {
  const data = inbox()
  const kinds = new Set(data.items.map((item) => item.kind))
  for (const kind of INBOX_KINDS) assert.equal(kinds.has(kind), true, kind)
  assert.equal(data.counts.document_review, 2)
  assert.equal(data.counts.photo_review, 1)
  assert.equal(data.counts.driver_approval, 1)
  assert.equal(data.counts.background_attestation, 1)
  assert.equal(data.counts.inspection, 2)
  assert.equal(data.counts.lost_item, 1)
  assert.equal(data.counts.flagged_message, 1)
  assert.equal(data.counts.failed_hold, 1)
  assert.equal(data.counts.stuck_trip, 2)
  assert.ok(data.counts.payout_w9 >= 3)
  assert.equal(data.items[0].kind, 'failed_hold')
  assert.match(data.items[0].ageLabel, /m$/)
  const docs = data.items.filter((item) => item.kind === 'document_review')
  assert.ok(docs[0].ageMs > docs[1].ageMs)
  const inspections = data.items.filter((item) => item.kind === 'inspection')
  assert.equal(inspections[0].title.startsWith('Inspection overdue'), true)
  assert.equal(data.items.some((item) => item.sourceId === 'doc-ok'), false)
  assert.equal(data.items.some((item) => item.sourceId === 'filed'), false)
  assert.equal(data.items.some((item) => item.sourceId === 'later'), false)
  assert.equal(data.items.some((item) => item.id === 'stuck_trip:fresh-1'), false)
  assert.equal(data.items.some((item) => item.id === 'stuck_trip:e2e'), false)
  assert.equal(data.items.some((item) => item.id === 'payout_w9:w9:taxed'), false)
  for (let i = 1; i < data.items.length; i += 1) {
    const prev = data.items[i - 1]
    const next = data.items[i]
    assert.ok(prev.urgency > next.urgency || (prev.urgency === next.urgency && prev.ageMs >= next.ageMs))
  }
})

test('every inbox action uses an existing admin endpoint', () => {
  const data = inbox()
  assert.ok(data.items.length > 0)
  for (const item of data.items) {
    assert.ok(item.actions.length > 0, item.id)
    for (const action of item.actions) {
      assert.ok(action.path === '/api/admin' || action.path === '/api/admin-drivers', action.path)
      if (action.method === 'POST' && action.path === '/api/admin') {
        assert.equal(POST_ADMIN.has(action.query.action), true, action.query.action)
      }
      if (action.method === 'GET' && action.path === '/api/admin') {
        assert.equal(GET_ADMIN.has(action.query.action), true)
      }
      if (action.method === 'POST' && action.path === '/api/admin-drivers') {
        const known = action.body.action === 'review-profile-photo' || action.body.decision === 'approve' || action.body.decision === 'reject'
        assert.equal(known, true)
      }
      if (action.webUrl) assert.equal(action.webUrl.startsWith(WEB_ADMIN_URL), true)
      const request = inboxActionRequest(action, { reason: action.needsReason ? 'Not the license holder' : undefined })
      assert.equal(request.error, null, item.id)
      assert.match(request.path, /^\/api\/admin/)
    }
  }
  const reject = data.items.find((item) => item.kind === 'photo_review').actions.find((action) => action.id === 'reject-photo')
  assert.match(inboxActionRequest(reject, { reason: 'no' }).error, /reason/)
  const resolved = inboxActionRequest(reject, { reason: 'Not the license holder' })
  assert.equal(resolved.body.decision, 'reject')
  assert.equal(resolved.body.reason, 'Not the license holder')
  assert.equal(resolved.body.action, 'review-profile-photo')
})

test('a finished background attestation is not a second to-do', () => {
  const data = buildAdminInbox({
    profiles: { drv: { full_name: 'Ada' } },
    applications: [{
      id: 'app',
      profile_id: 'drv',
      onboarding_status: 'pending_review',
      submitted_at: ago(1000),
      background_authorized_at: ago(1000),
      background_check_status: 'authorized',
    }],
  }, NOW)
  assert.equal(data.counts.driver_approval, 1)
  assert.equal(data.counts.background_attestation, 0)
})
