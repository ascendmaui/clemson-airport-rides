import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { studentDiscountGranted } from '../src/lib/studentDomain.js'
import { studentFlagsFor } from './studentEligibility.js'

test('quote and airport checkout do not read a client student flag', () => {
  const quote = readFileSync(new URL('./endpoints/quoteFare.js', import.meta.url), 'utf8')
  const checkout = readFileSync(new URL('./endpoints/airportCheckout.js', import.meta.url), 'utf8')
  const recompute = readFileSync(new URL('./friendRideRecompute.js', import.meta.url), 'utf8')
  const eligibility = readFileSync(new URL('./studentEligibility.js', import.meta.url), 'utf8')
  assert.doesNotMatch(quote, /body\.isStudent/)
  assert.match(quote, /studentDiscountGranted/)
  assert.doesNotMatch(checkout, /student_verified_at/)
  assert.match(checkout, /studentDiscountGranted\(user\)/)
  assert.match(recompute, /studentFlagsFor/)
  assert.doesNotMatch(recompute, /student_verified_at/)
  assert.doesNotMatch(eligibility, /student_verified_at/)
  assert.doesNotMatch(eligibility, /participant\.email/)
})

test('friend-ride shares use the auth email, not the join form or a profile flag', async () => {
  const users = {
    spoof: { email: 'spoof@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z', student_verified_at: '2026-01-01' },
    tiger: { email: 'tiger@g.clemson.edu', email_confirmed_at: '2026-01-01T00:00:00Z' },
    pending: { email: 'pending@clemson.edu', email_confirmed_at: null },
  }
  const sb = {
    auth: {
      admin: {
        async getUserById(id) {
          return { data: { user: users[id] || null }, error: users[id] ? null : { message: 'missing' } }
        },
      },
    },
  }
  const flags = await studentFlagsFor(sb, [
    { user_id: 'spoof', email: 'spoof@clemson.edu', student_verified_at: '2026-01-01' },
    { user_id: 'tiger', email: 'nope@gmail.com' },
    { user_id: 'pending', email: 'pending@clemson.edu' },
    { email: 'guest@clemson.edu' },
  ])
  assert.deepEqual(flags, [false, true, false, false])
  assert.equal(studentDiscountGranted(users.tiger), true)
  assert.equal(studentDiscountGranted(users.spoof), false)
})
