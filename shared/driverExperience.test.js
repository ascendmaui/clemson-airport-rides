import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeYearsExperience, yearsExperienceLabel } from './driverExperience.js'

test('years of experience label reads like "7 yrs experience"', () => {
  assert.equal(yearsExperienceLabel(7), '7 yrs experience')
  assert.equal(yearsExperienceLabel('7'), '7 yrs experience')
  assert.equal(yearsExperienceLabel(1), '1 yr experience')
})

test('missing, zero, fractional, and out-of-range years hide the line', () => {
  for (const raw of [null, undefined, '', 0, -2, 2.5, 'abc', 71, true, NaN]) {
    assert.equal(normalizeYearsExperience(raw), null, String(raw))
    assert.equal(yearsExperienceLabel(raw), null, String(raw))
  }
})
