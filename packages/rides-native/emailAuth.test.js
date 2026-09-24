import assert from 'node:assert/strict'
import test from 'node:test'
import { requestPasswordReset, signInWithEmail, updatePassword } from './emailAuth.js'

test('email sign-in still calls Supabase signInWithPassword', async () => {
  const calls = []
  const supabase = {
    auth: {
      async signInWithPassword(args) {
        calls.push(args)
        return { data: { session: { user: { id: 'user-1' } }, user: { id: 'user-1' } }, error: null }
      },
    },
  }
  const data = await signInWithEmail(supabase, '  Rider@clemson.edu ', 'secret')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].email, 'rider@clemson.edu')
  assert.equal(calls[0].password, 'secret')
  assert.equal(data.user.id, 'user-1')
})

test('forgot-password sends a Supabase reset email to the rider redirect', async () => {
  const calls = []
  const supabase = {
    auth: {
      async resetPasswordForEmail(email, options) {
        calls.push({ email, options })
        return { data: {}, error: null }
      },
    },
  }
  await requestPasswordReset(supabase, 'rider@clemson.edu', 'clemsonrides://reset-password')
  assert.deepEqual(calls, [{
    email: 'rider@clemson.edu',
    options: { redirectTo: 'clemsonrides://reset-password' },
  }])
})

test('forgot-password requires an email and updatePassword keeps the 6 character floor', async () => {
  const supabase = { auth: {} }
  await assert.rejects(() => requestPasswordReset(supabase, '   '), /Enter the email/)
  await assert.rejects(() => updatePassword(supabase, 'short'), /6 characters/)
})
