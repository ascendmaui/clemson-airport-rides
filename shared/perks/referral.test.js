import assert from 'node:assert/strict'
import test from 'node:test'
import { claimDecision, makeReferralCode, normalizeCode, referralAwards, referralProgress, shareLink } from './referral.js'

test('codes are name prefix + 4 unambiguous chars', () => {
  let i = 0
  const code = makeReferralCode("Jo'hn", () => (i++ % 4) / 4)
  assert.match(code, /^JOHN[A-Z2-9]{4}$/)
  assert.equal(normalizeCode(' john-7k2q '), 'JOHN7K2Q')
  assert.equal(shareLink({}, 'JOHN7K2Q'), 'https://clemsonrides.com/drive?ref=JOHN7K2Q')
})

test('claim rules', () => {
  assert.equal(claimDecision({ referee: 'b', referrerId: null }).error, 'unknown_code')
  assert.equal(claimDecision({ referee: 'b', referrerId: 'b' }).error, 'own_code')
  assert.equal(claimDecision({ referee: 'b', referrerId: 'a', existingClaim: { id: 1 } }).error, 'already_claimed')
  assert.equal(claimDecision({ referee: 'b', referrerId: 'a', refereeCompletedTrips: 1 }).error, 'too_late')
  assert.ok(claimDecision({ referee: 'b', referrerId: 'a', refereeCompletedTrips: 0 }).ok)
})

test('bonus pays once the referee reaches X trips; ledger ref is per referee', () => {
  const refs = [
    { id: 'r1', referrer_id: 'a', referee_id: 'b', status: 'pending' },
    { id: 'r2', referrer_id: 'a', referee_id: 'c', status: 'pending' },
    { id: 'r3', referrer_id: 'a', referee_id: 'd', status: 'void' },
  ]
  const awards = referralAwards(refs, { b: 10, c: 9, d: 50 }, { targetTrips: 10, bonusCents: 5000 })
  assert.deepEqual(awards.map((a) => [a.ref, a.amountCents]), [['referee:b', 5000]])
  assert.equal(referralAwards(refs, { b: 10 }, { enabled: false }).length, 0)
  assert.deepEqual(referralProgress(refs.slice(0, 2), { b: 12, c: 3 }, { targetTrips: 10 }).map((p) => p.trips), [10, 3])
})
