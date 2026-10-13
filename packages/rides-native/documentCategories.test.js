import assert from 'node:assert/strict'
import test from 'node:test'
import { REQUIRED_DOCUMENTS } from '../../shared/driverOnboarding.js'
import {
  ATTENTION_COPY,
  DOCUMENT_CATEGORIES,
  categoryAttention,
  categoryForDocument,
  categorySlots,
} from './documentCategories.js'

const EXPECTED = {
  license_front: { id: 'license', label: "Driver's License" },
  license_back: { id: 'license', label: "Driver's License" },
  insurance_front: { id: 'insurance', label: 'Insurance' },
  insurance_back: { id: 'insurance', label: 'Insurance' },
  registration: { id: 'registration', label: 'Registration' },
  car_front: { id: 'vehicle', label: 'Vehicle Photos' },
  car_back: { id: 'vehicle', label: 'Vehicle Photos' },
  car_left: { id: 'vehicle', label: 'Vehicle Photos' },
  car_right: { id: 'vehicle', label: 'Vehicle Photos' },
}

function approvedRows(types) {
  return types.map((doc_type) => ({ doc_type, storage_path: `driver/${doc_type}.jpg`, review_status: 'approved' }))
}

test('each category maps to the correct tab', () => {
  assert.deepEqual(
    DOCUMENT_CATEGORIES.map((category) => category.label),
    ["Driver's License", 'Insurance', 'Registration', 'Vehicle Photos'],
  )
  assert.deepEqual(
    DOCUMENT_CATEGORIES.map((category) => category.id),
    ['license', 'insurance', 'registration', 'vehicle'],
  )

  for (const doc of REQUIRED_DOCUMENTS) {
    const expected = EXPECTED[doc.id]
    assert.ok(expected, `missing tab for ${doc.id}`)
    const category = categoryForDocument({ doc_type: doc.id })
    assert.equal(category?.id, expected.id)
    assert.equal(category?.label, expected.label)
    assert.ok(categorySlots(expected.id, []).some((slot) => slot.id === doc.id))
    assert.equal(categoryForDocument({ type: doc.id })?.id, expected.id)
  }

  const licenseSlots = categorySlots('license', [
    { doc_type: 'license_front', storage_path: 'driver/license_front/1.jpg', review_status: 'pending' },
  ])
  assert.equal(licenseSlots.find((slot) => slot.id === 'license_front')?.action, 'replace')
  assert.equal(licenseSlots.find((slot) => slot.id === 'license_back')?.action, 'upload')

  assert.equal(categoryForDocument({ doc_type: 'w9' }), null)
  assert.equal(categoryForDocument({ doc_type: 'background_authorization' }), null)
  assert.equal(categoryForDocument(null), null)
  assert.equal(categoryForDocument({}), null)
})

test('the check shows only when every required document in the category is approved', () => {
  for (const category of DOCUMENT_CATEGORIES) {
    const ready = categoryAttention(category.id, approvedRows(category.docTypes))
    assert.equal(ready.approved, true)
    assert.equal(ready.mark, 'check')
    assert.equal(ready.label, 'Approved')
    assert.notEqual(ready.label, ATTENTION_COPY)

    const missing = categoryAttention(category.id, [])
    assert.equal(missing.approved, false)
    assert.equal(missing.mark, 'x')
    assert.equal(missing.label, ATTENTION_COPY)

    const partial = approvedRows(category.docTypes)
    partial[0] = { ...partial[0], review_status: 'pending' }
    const pending = categoryAttention(category.id, partial)
    assert.equal(pending.mark, 'x')
    assert.equal(pending.label, ATTENTION_COPY)

    const rejected = approvedRows(category.docTypes)
    rejected[rejected.length - 1] = { ...rejected[rejected.length - 1], review_status: 'rejected' }
    assert.equal(categoryAttention(category.id, rejected).mark, 'x')

    const blank = approvedRows(category.docTypes)
    blank[0] = { ...blank[0], review_status: null }
    assert.equal(categoryAttention(category.id, blank).mark, 'x')

    const dropped = approvedRows(category.docTypes).slice(1)
    assert.equal(categoryAttention(category.id, dropped).mark, 'x')
  }

  const licenseOnly = approvedRows(['license_front', 'license_back'])
  assert.equal(categoryAttention('insurance', licenseOnly).mark, 'x')
  assert.equal(categoryAttention('vehicle', licenseOnly).mark, 'x')
  assert.equal(categoryAttention('registration', [
    { doc_type: 'registration', review_status: 'matched', storage_path: 'reg.pdf' },
  ]).mark, 'x')
  assert.equal(categoryAttention('registration', [
    { doc_type: 'registration', review_status: 'needs_review', storage_path: 'reg.pdf' },
  ]).label, ATTENTION_COPY)
  assert.equal(categoryAttention('unknown', approvedRows(['registration'])).mark, 'x')
})
