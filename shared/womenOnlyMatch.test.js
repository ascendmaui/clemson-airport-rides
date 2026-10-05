import assert from 'node:assert/strict'
import test from 'node:test'
import {
  asComfortSide,
  comfortPreferenceCopy,
  noComfortMatchMessage,
  normalizeGenderIdentity,
  sanitizeWomenOnlyPreference,
  womenOnlyMismatchMessage,
  womenOnlyPairAllowed,
  womenOnlyPreferenceAllowed,
} from './womenOnlyMatch.js'

const woman = { gender_identity: 'woman', women_only_matching: true }
const womanOpen = { gender_identity: 'woman', women_only_matching: false }
const man = { gender_identity: 'man', women_only_matching: false }

test('gender values outside the list stay unspecified', () => {
  assert.equal(normalizeGenderIdentity('Woman'), 'woman')
  assert.equal(normalizeGenderIdentity('prefer not'), 'unspecified')
  assert.equal(normalizeGenderIdentity(''), 'unspecified')
})

test('the preference cannot be saved unless the person identifies as a woman', () => {
  assert.equal(womenOnlyPreferenceAllowed('woman'), true)
  assert.equal(womenOnlyPreferenceAllowed('nonbinary'), false)
  assert.deepEqual(sanitizeWomenOnlyPreference({ genderIdentity: 'man', womenOnly: true }), {
    genderIdentity: 'man',
    womenOnlyMatching: false,
    rejected: true,
  })
  assert.equal(sanitizeWomenOnlyPreference({ genderIdentity: 'woman', womenOnly: true }).womenOnlyMatching, true)
})

test('women-only matching is bidirectional and ignores a preference that is off', () => {
  assert.equal(womenOnlyPairAllowed(woman, womanOpen), true)
  assert.equal(womenOnlyPairAllowed(woman, man), false)
  assert.equal(womenOnlyPairAllowed(womanOpen, { gender_identity: 'woman', women_only_matching: true }), true)
  assert.equal(womenOnlyPairAllowed(man, { gender_identity: 'woman', women_only_matching: true }), false)
  assert.equal(womenOnlyPairAllowed(man, womanOpen), true)
  assert.equal(womenOnlyPairAllowed(null, null), true)
  assert.equal(asComfortSide({ gender_identity: 'man', women_only_matching: true }).womenOnlyMatching, false)
})

test('mismatch copy names the comfort preference without a marketing claim', () => {
  assert.match(womenOnlyMismatchMessage(woman, man), /women-driver comfort preference/)
  assert.match(womenOnlyMismatchMessage(man, woman), /women passengers/)
  assert.equal(womenOnlyMismatchMessage(womanOpen, man), null)
  assert.match(noComfortMatchMessage({ riderWants: true }), /Profile/)
  assert.match(noComfortMatchMessage({ riderWants: false }), /women passengers/)
  assert.match(comfortPreferenceCopy('rider').body, /comfort and safety/)
  assert.match(comfortPreferenceCopy('driver').title, /Women passengers/)
  assert.doesNotMatch(comfortPreferenceCopy('both').body, /exclusive|only women welcome/i)
})
