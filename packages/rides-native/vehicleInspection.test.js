import assert from 'node:assert/strict'
import test from 'node:test'
import { REQUIRED_DOCUMENTS } from '../../shared/driverOnboarding.js'
import { DOCUMENT_CATEGORIES, goOnlineDocumentGate } from './documentCategories.js'
import {
  INSPECTION_OVERDUE_COPY,
  INSPECTION_SOURCES,
  inspectionAttention,
  inspectionCountdown,
  inspectionGoOnlineGate,
  inspectionSubmitted,
} from './vehicleInspection.js'

const NOW = new Date('2026-10-13T12:00:00.000Z')
const DUE_ON_TIME = '2026-11-12T12:00:00.000Z'
const DUE_PAST = '2026-10-01T12:00:00.000Z'

function approvedOnboarding() {
  return REQUIRED_DOCUMENTS.map((doc) => ({
    doc_type: doc.id,
    storage_path: `driver/${doc.id}.jpg`,
    review_status: 'approved',
  }))
}

function submission(reviewStatus, source = 'lyft') {
  return [
    { doc_type: 'inspection_front', storage_path: 'driver/inspection_front.jpg', review_status: reviewStatus },
    { doc_type: 'inspection_back', storage_path: 'driver/inspection_back.jpg', review_status: reviewStatus },
    { doc_type: 'inspection_left', storage_path: 'driver/inspection_left.jpg', review_status: reviewStatus },
    { doc_type: 'inspection_right', storage_path: 'driver/inspection_right.jpg', review_status: reviewStatus },
    { doc_type: 'inspection_form', storage_path: 'driver/inspection_form.pdf', review_status: reviewStatus, inspection_source: source },
  ]
}

test('submitting on time means no block', () => {
  const pending = submission('pending')
  assert.equal(inspectionSubmitted(pending), true)
  assert.equal(inspectionGoOnlineGate({ documents: pending, dueAt: DUE_ON_TIME, now: NOW }).allowed, true)
  assert.equal(inspectionGoOnlineGate({ documents: pending, dueAt: DUE_ON_TIME, now: NOW }).message, '')
  assert.equal(inspectionCountdown({ documents: pending, dueAt: DUE_ON_TIME, now: NOW }), null)

  const early = inspectionGoOnlineGate({ documents: [], dueAt: DUE_ON_TIME, now: NOW })
  assert.equal(early.allowed, true)
  assert.equal(
    inspectionCountdown({ documents: [], dueAt: DUE_ON_TIME, now: NOW })?.message,
    'Vehicle inspection due in 30 days',
  )
  const soon = new Date('2026-11-12T00:00:00.000Z')
  assert.equal(
    inspectionCountdown({ documents: [], dueAt: DUE_ON_TIME, now: soon })?.message,
    'Vehicle inspection due in 1 days',
  )

  assert.equal(inspectionGoOnlineGate({ documents: [], dueAt: null, now: NOW }).allowed, true)
  assert.equal(inspectionCountdown({ documents: [], dueAt: null, now: NOW }), null)
  assert.equal(DOCUMENT_CATEGORIES.some((category) => category.id === 'inspection'), false)
  assert.equal(goOnlineDocumentGate(approvedOnboarding()).allowed, true)
  assert.equal(goOnlineDocumentGate([...approvedOnboarding(), ...submission(null)]).allowed, true)
})

test('submitting late unblocks after submission', () => {
  const overdue = inspectionGoOnlineGate({ documents: [], dueAt: DUE_PAST, now: NOW })
  assert.equal(overdue.allowed, false)
  assert.equal(overdue.message, INSPECTION_OVERDUE_COPY)

  const pending = submission(null, 'uber')
  assert.equal(inspectionSubmitted(pending), true)
  const open = inspectionGoOnlineGate({ documents: pending, dueAt: DUE_PAST, now: NOW })
  assert.equal(open.allowed, true)
  assert.equal(open.message, '')

  const other = submission('pending_manual_review', 'other_platform')
  assert.equal(inspectionGoOnlineGate({ documents: other, dueAt: DUE_PAST, now: NOW }).allowed, true)
  const independent = submission('needs_review', 'independent')
  assert.equal(inspectionGoOnlineGate({ documents: independent, dueAt: DUE_PAST, now: NOW }).allowed, true)

  const rejected = submission('pending', 'lyft')
  rejected[0] = { ...rejected[0], review_status: 'rejected' }
  assert.equal(inspectionSubmitted(rejected), false)
  assert.equal(inspectionGoOnlineGate({ documents: rejected, dueAt: DUE_PAST, now: NOW }).allowed, false)
  assert.equal(inspectionGoOnlineGate({ documents: rejected, dueAt: DUE_ON_TIME, now: NOW }).allowed, true)

  const partial = submission('pending').filter((row) => row.doc_type !== 'inspection_right')
  assert.equal(inspectionSubmitted(partial), false)
  assert.equal(inspectionGoOnlineGate({ documents: partial, dueAt: DUE_PAST, now: NOW }).allowed, false)

  const noSource = submission('pending', '')
  assert.equal(inspectionSubmitted(noSource), false)
  assert.equal(inspectionGoOnlineGate({ documents: noSource, dueAt: DUE_PAST, now: NOW }).allowed, false)

  const withoutInterior = submission('approved')
  assert.equal(inspectionSubmitted(withoutInterior), true)
  assert.equal(inspectionAttention(withoutInterior).mark, 'check')
  assert.equal(inspectionAttention(submission('pending')).mark, 'x')
  assert.equal(inspectionAttention(submission('pending')).label, 'Needs your attention')
})

test('overdue with no submission blocks', () => {
  const gate = inspectionGoOnlineGate({ documents: [], dueAt: DUE_PAST, now: NOW })
  assert.equal(gate.allowed, false)
  assert.equal(gate.message, INSPECTION_OVERDUE_COPY)
  assert.equal(inspectionCountdown({ documents: [], dueAt: DUE_PAST, now: NOW }), null)
  const missingPhoto = submission('pending').filter((row) => row.doc_type !== 'inspection_back')
  assert.equal(inspectionGoOnlineGate({ documents: missingPhoto, dueAt: DUE_PAST, now: NOW }).allowed, false)
})

test('inspection sources are Lyft, Uber, another platform, or independent', () => {
  assert.deepEqual(
    INSPECTION_SOURCES.map((source) => source.label),
    ['Lyft', 'Uber', 'Another platform', 'Independent inspection'],
  )
})
