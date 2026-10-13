import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COMMUNITY_PRIVACY_NOTE, EMPTY_COMMUNITY, communityRow, matchLines, parseCourses } from './communityProfile.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('everything is off by default', () => {
  for (const [k, v] of Object.entries(EMPTY_COMMUNITY)) if (k.startsWith('share_')) assert.equal(v, false, k)
  const row = communityRow('u1', { hometown: 'Greenville' })
  assert.equal(row.share_hometown, false)
})

test('a share flag needs a value; courses are bare codes only', () => {
  const row = communityRow('u1', { hometown: '  Greenville  ', share_hometown: true, major: '', share_major: true, courses: 'cpsc1010, ENGL 1030 MWF 9:05, math 1060, cpsc 1010', share_courses: true, grad_year: '2028', share_grad_year: true })
  assert.equal(row.hometown, 'Greenville')
  assert.equal(row.share_major, false)
  assert.deepEqual(row.courses, ['CPSC 1010', 'MATH 1060'])
  assert.equal(row.grad_year, 2028)
  assert.deepEqual(parseCourses('CPSC 1010-001, 10:10am'), [])
})

test('match lines keep only known categories', () => {
  assert.deepEqual(matchLines([{ category: 'hometown', label: 'Both from Greenville' }, { category: 'phone', label: 'x' }]), [{ category: 'hometown', label: 'Both from Greenville' }])
})

test('privacy note covers default-off, matches-only, no times, no effect on matching/price/ETA', () => {
  assert.match(COMMUNITY_PRIVACY_NOTE, /off by default/)
  assert.match(COMMUNITY_PRIVACY_NOTE, /never times or schedules/)
  assert.match(COMMUNITY_PRIVACY_NOTE, /never changes matching, price, or ETA/)
  assert.doesNotMatch(COMMUNITY_PRIVACY_NOTE, /Tigers?\b|Paw|Death Valley|Solid Orange/i)
})

test('matching, pricing and ETA code never read community data', () => {
  for (const f of ['../server/comfortMatch.js', '../server/autoAssign.js', '../server/authoritativeFare.js', '../server/endpoints/quoteFare.js', '../shared/driverOrder.js', '../packages/rides-native/liveTrip.js']) {
    let src = ''
    try { src = read(f) } catch { continue }
    assert.doesNotMatch(src, /community/i, f)
  }
})
