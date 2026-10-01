import assert from 'node:assert/strict'
import test from 'node:test'
import { shownCents } from './shown.ts'

test('shownCents: formats currency when hidden is false', () => {
  assert.equal(shownCents(0, false), '$0.00')
  assert.equal(shownCents(100, false), '$1.00')
  assert.equal(shownCents(2500, false), '$25.00')
  assert.equal(shownCents(12345, false), '$123.45')
  assert.equal(shownCents(99, false), '$0.99')
})

test('shownCents: masks earnings with bullet string when hidden is true', () => {
  assert.equal(shownCents(0, true), '••••')
  assert.equal(shownCents(100, true), '••••')
  assert.equal(shownCents(2500, true), '••••')
  assert.equal(shownCents(99999, true), '••••')
})

test('shownCents: handles edge-case numbers when visible', () => {
  assert.equal(shownCents(-500, false), '-$5.00')
  assert.equal(shownCents(1, false), '$0.01')
})
