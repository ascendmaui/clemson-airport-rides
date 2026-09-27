import assert from 'node:assert/strict'
import test from 'node:test'
import * as emailAuth from './emailAuth.js'
import { requestPasswordReset, signInWithEmail, updatePassword } from './emailAuth.js'

const NOT_CONFIGURED = 'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_ANON_KEY for this EAS build.'

function authClient(methods) {
  const calls = []
  const auth = {}
  for (const [name, respond] of Object.entries(methods)) {
    auth[name] = async (...args) => {
      calls.push({ name, args })
      return respond(...args)
    }
  }
  return { calls, supabase: { auth } }
}

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

test('emailAuth exports only the three helpers', () => {
  assert.deepEqual(Object.keys(emailAuth).sort(), [
    'requestPasswordReset',
    'signInWithEmail',
    'updatePassword',
  ])
})

test('every helper rejects a missing supabase client before touching auth', async () => {
  await assert.rejects(() => signInWithEmail(null, 'rider@clemson.edu', 'secret'), { message: NOT_CONFIGURED })
  await assert.rejects(() => signInWithEmail(undefined, 'rider@clemson.edu', 'secret'), { message: NOT_CONFIGURED })
  await assert.rejects(() => requestPasswordReset(false, 'rider@clemson.edu'), { message: NOT_CONFIGURED })
  await assert.rejects(() => updatePassword(0, 'long-enough'), { message: NOT_CONFIGURED })
})

test('a truthy client without auth throws TypeError instead of the not-configured error', async () => {
  // BUG?: the configured check is only `if (!supabase)`, so {} skips it and crashes on `.auth`.
  await assert.rejects(() => signInWithEmail({}, 'rider@clemson.edu', 'secret'), TypeError)
  await assert.rejects(() => requestPasswordReset({}, 'rider@clemson.edu'), TypeError)
  await assert.rejects(() => updatePassword({}, '123456'), TypeError)
})

test('signInWithEmail sends a blank email and an empty password to Supabase', async () => {
  const { calls, supabase } = authClient({
    signInWithPassword: async () => ({ data: { user: null }, error: null }),
  })
  // BUG?: sign-in does not use requestPasswordReset's "Enter the email" check, so a blank address is submitted.
  // BUG?: sign-in does not enforce updatePassword's 6-character floor, so an empty password is submitted too.
  const data = await signInWithEmail(supabase, '   ', '')
  assert.equal(data.user, null)
  assert.deepEqual(calls[0].args, [{ email: '', password: '' }])
})

test('signInWithEmail coerces a non-string email and forwards a non-string password', async () => {
  const { calls, supabase } = authClient({
    signInWithPassword: async () => ({ data: { ok: true }, error: null }),
  })
  // BUG?: a numeric email becomes the address "12345". The password is not passed through String(), unlike updatePassword.
  await signInWithEmail(supabase, 12345, 999)
  assert.deepEqual(calls[0].args, [{ email: '12345', password: 999 }])
})

test('signInWithEmail keeps internal email spaces and does not trim the password', async () => {
  const { calls, supabase } = authClient({
    signInWithPassword: async () => ({ data: { ok: true }, error: null }),
  })
  // BUG?: normalizeAuthEmail only trims the ends, so an internal space is sent to Supabase.
  await signInWithEmail(supabase, '  Rider @Clemson.edu ', ' secret ')
  assert.deepEqual(calls[0].args, [{ email: 'rider @clemson.edu', password: ' secret ' }])
})

test('signInWithEmail rethrows an unknown Error and wraps other error values', async () => {
  const original = new Error('Email address is invalid')
  const same = authClient({
    signInWithPassword: async () => ({ data: null, error: original }),
  })
  await assert.rejects(
    () => signInWithEmail(same.supabase, 'rider@clemson.edu', 'secret'),
    (err) => {
      assert.equal(err, original)
      return true
    },
  )

  const plain = authClient({
    signInWithPassword: async () => ({ data: null, error: { message: 'Network down' } }),
  })
  await assert.rejects(
    () => signInWithEmail(plain.supabase, 'rider@clemson.edu', 'secret'),
    (err) => {
      assert.ok(err instanceof Error)
      assert.equal(err.message, 'Network down')
      return true
    },
  )

  const text = authClient({
    signInWithPassword: async () => ({ data: null, error: 'smtp down' }),
  })
  // BUG?: a string error has no `.message`, so the original text is replaced with "Auth failed".
  await assert.rejects(
    () => signInWithEmail(text.supabase, 'rider@clemson.edu', 'secret'),
    { message: 'Auth failed' },
  )
})

test('signInWithEmail maps invalid credentials and signup-style rate limits', async () => {
  const invalid = authClient({
    signInWithPassword: async () => ({
      data: null,
      error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 },
    }),
  })
  await assert.rejects(
    () => signInWithEmail(invalid.supabase, 'rider@clemson.edu', 'nope'),
    (err) => {
      assert.equal(err.code, 'invalid_credentials')
      assert.equal(err.status, 400)
      assert.match(err.message, /do not match/)
      assert.match(err.message, /continue with Google/)
      return true
    },
  )

  const limited = authClient({
    signInWithPassword: async () => ({
      data: null,
      error: { status: 429, message: 'email rate limit exceeded' },
    }),
  })
  // BUG?: a sign-in 429 is described as too many signup emails.
  await assert.rejects(
    () => signInWithEmail(limited.supabase, 'rider@clemson.edu', 'secret'),
    (err) => {
      assert.equal(err.code, 'over_email_send_rate_limit')
      assert.equal(err.status, 429)
      assert.equal(err.retryAfterSec, 60)
      assert.match(err.message, /Too many signup emails/)
      return true
    },
  )
})

test('signInWithEmail lets a thrown client failure through unmapped', async () => {
  const supabase = {
    auth: {
      async signInWithPassword() {
        throw new Error('socket hang up')
      },
    },
  }
  // BUG?: a rejected client call skips mapAuthError, so the raw message reaches the screen.
  await assert.rejects(
    () => signInWithEmail(supabase, 'rider@clemson.edu', 'secret'),
    { message: 'socket hang up' },
  )
})

test('requestPasswordReset rejects blank emails without calling Supabase', async () => {
  let called = false
  const supabase = {
    auth: {
      async resetPasswordForEmail() {
        called = true
        return { data: {}, error: null }
      },
    },
  }
  for (const email of ['', '   ', null, undefined]) {
    await assert.rejects(
      () => requestPasswordReset(supabase, email, 'clemsonrides://reset-password'),
      { message: 'Enter the email on your account.' },
    )
  }
  assert.equal(called, false)
})

test('requestPasswordReset omits options when redirectTo is missing or empty', async () => {
  const { calls, supabase } = authClient({
    resetPasswordForEmail: async () => ({ data: { sent: true }, error: null }),
  })
  const data = await requestPasswordReset(supabase, '  Rider@Clemson.edu ')
  assert.equal(data.sent, true)
  assert.deepEqual(calls[0].args, ['rider@clemson.edu', undefined])

  await requestPasswordReset(supabase, 'rider@clemson.edu', '')
  // BUG?: an empty-string redirectTo is dropped, the same as omitting the argument.
  assert.deepEqual(calls[1].args, ['rider@clemson.edu', undefined])

  await requestPasswordReset(supabase, 'rider@clemson.edu', '   ')
  assert.deepEqual(calls[2].args, ['rider@clemson.edu', undefined])
})

test('requestPasswordReset trims a padded redirect and still forwards a coerced email', async () => {
  const { calls, supabase } = authClient({
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
  })
  await requestPasswordReset(supabase, 'rider@clemson.edu', '  clemsonrides://reset-password  ')
  // BUG?: a non-string email is coerced. 12345 is treated as the address "12345".
  await requestPasswordReset(supabase, 12345, 'clemsonrides://reset-password')
  await requestPasswordReset(supabase, 'rider@clemson.edu', 123)
  assert.deepEqual(calls[0].args, [
    'rider@clemson.edu',
    { redirectTo: 'clemsonrides://reset-password' },
  ])
  assert.deepEqual(calls[1].args, ['12345', { redirectTo: 'clemsonrides://reset-password' }])
  assert.deepEqual(calls[2].args, ['rider@clemson.edu', { redirectTo: 123 }])
})

test('requestPasswordReset maps invalid-credentials and rate-limit errors with shared copy', async () => {
  const invalid = authClient({
    resetPasswordForEmail: async () => ({
      data: null,
      error: { message: 'Invalid login credentials', status: 400 },
    }),
  })
  // BUG?: a reset failure that looks like invalid credentials uses sign-in copy that mentions Google.
  await assert.rejects(
    () => requestPasswordReset(invalid.supabase, 'rider@clemson.edu', 'clemsonrides://reset-password'),
    (err) => {
      assert.equal(err.code, 'invalid_credentials')
      assert.equal(err.status, 400)
      assert.match(err.message, /continue with Google/)
      return true
    },
  )

  const limited = authClient({
    resetPasswordForEmail: async () => ({
      data: null,
      error: { status: 429, message: 'over_email_send_rate_limit' },
    }),
  })
  // BUG?: a reset rate limit is described as too many signup emails.
  await assert.rejects(
    () => requestPasswordReset(limited.supabase, 'rider@clemson.edu'),
    (err) => {
      assert.equal(err.retryAfterSec, 60)
      assert.match(err.message, /Too many signup emails/)
      return true
    },
  )
})

test('updatePassword accepts exactly 6 characters and returns the auth payload', async () => {
  const { calls, supabase } = authClient({
    updateUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
  })
  const data = await updatePassword(supabase, '123456')
  assert.equal(data.user.id, 'user-1')
  assert.deepEqual(calls[0].args, [{ password: '123456' }])
})

test('updatePassword rejects short values before calling Supabase', async () => {
  let called = false
  const supabase = {
    auth: {
      async updateUser() {
        called = true
        return { data: {}, error: null }
      },
    },
  }
  for (const password of ['', 'short', '12345', null, undefined, 0, false]) {
    await assert.rejects(
      () => updatePassword(supabase, password),
      { message: 'Use at least 6 characters.' },
    )
  }
  assert.equal(called, false)
})

test('updatePassword stores whitespace-only and coerced non-string passwords', async () => {
  const { calls, supabase } = authClient({
    updateUser: async () => ({ data: { ok: true }, error: null }),
  })
  // BUG?: the length check does not trim, so six spaces are accepted as a password.
  await updatePassword(supabase, '      ')
  // BUG?: non-strings are coerced with String(). An object becomes the password "[object Object]".
  await updatePassword(supabase, { unexpected: true })
  await updatePassword(supabase, 123456)
  await updatePassword(supabase, 'secret ')
  assert.deepEqual(calls.map((call) => call.args[0].password), [
    '      ',
    '[object Object]',
    '123456',
    'secret ',
  ])
})

test('updatePassword maps account-exists copy and keeps an unknown Error', async () => {
  const original = new Error('Password should be at least 6 characters')
  const passthrough = authClient({
    updateUser: async () => ({ data: null, error: original }),
  })
  await assert.rejects(
    () => updatePassword(passthrough.supabase, '123456'),
    (err) => {
      assert.equal(err, original)
      return true
    },
  )

  const exists = authClient({
    updateUser: async () => ({
      data: null,
      error: { message: 'User already registered', code: 'user_already_exists', status: 422 },
    }),
  })
  // BUG?: updatePassword can surface account-exists copy that tells the rider to sign in.
  await assert.rejects(
    () => updatePassword(exists.supabase, '123456'),
    (err) => {
      assert.equal(err.code, 'account_exists')
      assert.equal(err.status, 422)
      assert.match(err.message, /already have an account/)
      return true
    },
  )

  const limited = authClient({
    updateUser: async () => ({ data: null, error: { status: 429, message: 'rate limit' } }),
  })
  // BUG?: a password-update 429 is described as too many signup emails.
  await assert.rejects(
    () => updatePassword(limited.supabase, '123456'),
    (err) => {
      assert.equal(err.status, 429)
      assert.match(err.message, /Too many signup emails/)
      return true
    },
  )
})
