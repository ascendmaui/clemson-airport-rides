import assert from 'node:assert/strict'
import test from 'node:test'
import { REQUIRED_DOCUMENTS } from '../../shared/driverOnboarding.js'
import { ATTENTION_COPY } from './documentCategories.js'
import { attentionRequiredItems, decideGoPress, idleGoTone } from './goPress.js'

function approvedRows(overrides = {}) {
  return REQUIRED_DOCUMENTS.map((doc) => ({
    doc_type: doc.id,
    storage_path: `${doc.id}.jpg`,
    review_status: overrides[doc.id] || 'approved',
  }))
}

test('ending a shift is never blocked', () => {
  const decision = decideGoPress({ goingOnline: false, documents: [], canGoOnline: false })
  assert.equal(decision.outcome, 'offline')
  assert.equal(decision.tone, 'purple')
  assert.equal(decision.proceed, true)
  assert.deepEqual(decision.items, [])
})

test('missing and unapproved documents are listed exactly and turn GO orange', () => {
  const rows = approvedRows({ license_front: 'pending', registration: 'rejected' })
    .filter((row) => row.doc_type !== 'insurance_back')
  const decision = decideGoPress({ goingOnline: true, documents: rows, canGoOnline: true })
  assert.equal(decision.outcome, 'attention')
  assert.equal(decision.tone, 'orange')
  assert.equal(decision.proceed, false)
  assert.equal(decision.title, ATTENTION_COPY)
  const byId = Object.fromEntries(decision.items.map((item) => [item.id, item]))
  assert.equal(byId.license_front.reason, 'Needs approval')
  assert.equal(byId.license_front.label, 'Driver license — front')
  assert.equal(byId.license_front.section, "Driver's License")
  assert.equal(byId.insurance_back.reason, 'Missing')
  assert.equal(byId.insurance_back.section, 'Insurance')
  assert.equal(byId.registration.reason, 'Rejected')
  assert.equal(byId.registration.label, 'Car registration')
  assert.equal(decision.items.some((item) => item.id === 'license_back'), false)
})

test('an overdue inspection lists the files that are still required', () => {
  const due = new Date('2026-01-01T00:00:00Z')
  const now = new Date('2026-02-15T00:00:00Z')
  const rows = [
    ...approvedRows(),
    { doc_type: 'inspection_front', storage_path: 'front.jpg', review_status: 'pending' },
  ]
  const decision = decideGoPress({
    goingOnline: true,
    documents: rows,
    dueAt: due,
    now,
    canGoOnline: true,
  })
  assert.equal(decision.outcome, 'attention')
  assert.equal(decision.tone, 'orange')
  const ids = decision.items.map((item) => item.id)
  assert.deepEqual(ids, ['inspection_back', 'inspection_left', 'inspection_right', 'inspection_form'])
  assert.ok(decision.items.every((item) => item.section === 'Inspection' && item.reason === 'Overdue'))
  assert.equal(decision.items.some((item) => item.id === 'inspection_interior'), false)
  assert.equal(decision.items.some((item) => item.id === 'inspection_front'), false)
})

test('a clear driver turns GO green and goes online', () => {
  const decision = decideGoPress({
    goingOnline: true,
    documents: approvedRows(),
    dueAt: null,
    canGoOnline: true,
  })
  assert.equal(decision.outcome, 'online')
  assert.equal(decision.tone, 'green')
  assert.equal(decision.proceed, true)
  assert.deepEqual(decision.items, [])
})

test('approved documents do not go online when the application itself is not clear', () => {
  const decision = decideGoPress({
    goingOnline: true,
    documents: approvedRows(),
    canGoOnline: false,
  })
  assert.equal(decision.outcome, 'hold')
  assert.equal(decision.tone, 'orange')
  assert.equal(decision.proceed, false)
  assert.deepEqual(decision.items, [])
})

test('idle GO is green when the driver is clear and orange when documents are missing', () => {
  assert.equal(idleGoTone({ documents: approvedRows(), canGoOnline: true }), 'green')
  assert.equal(idleGoTone({ documents: [], canGoOnline: true }), 'orange')
  assert.equal(idleGoTone({ documents: null, canGoOnline: true }), 'orange')
  assert.equal(idleGoTone({ documents: approvedRows(), canGoOnline: false }), 'orange')
  const overdue = new Date('2020-01-01T00:00:00Z').toISOString()
  assert.equal(idleGoTone({ documents: approvedRows(), dueAt: overdue, canGoOnline: true }), 'orange')
})

test('attention items stay empty once every required file is approved', () => {
  const ready = attentionRequiredItems({ documents: approvedRows(), dueAt: null })
  assert.equal(ready.documentsAllowed, true)
  assert.equal(ready.inspectionAllowed, true)
  assert.deepEqual(ready.items, [])
  assert.equal(ready.title, ATTENTION_COPY)
})
