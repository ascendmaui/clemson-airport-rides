import assert from 'node:assert/strict'
import test from 'node:test'
import { studentFlagsFor } from './studentEligibility.js'

function createFakeSb(users = {}, { throwFor = new Set(), missingAdmin = false } = {}) {
  if (missingAdmin) {
    return {}
  }

  return {
    auth: {
      admin: {
        async getUserById(id) {
          if (throwFor.has(id)) {
            throw new Error(`Simulated database failure for ${id}`)
          }
          const user = users[id]
          if (!user) {
            return { data: null, error: { message: 'User not found' } }
          }
          return { data: { user }, error: null }
        },
      },
    },
  }
}

test('empty participants list returns an empty array', async () => {
  const sb = createFakeSb()
  const flags = await studentFlagsFor(sb, [])
  assert.deepEqual(flags, [])
})

test('mixed .edu domains: only clemson.edu and g.clemson.edu qualify', async () => {
  const users = {
    u_clemson: {
      id: 'u_clemson',
      email: 'tiger@clemson.edu',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    },
    u_gclemson: {
      id: 'u_gclemson',
      email: 'student@g.clemson.edu',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    },
    u_mit: {
      id: 'u_mit',
      email: 'engineer@mit.edu',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    },
    u_harvard: {
      id: 'u_harvard',
      email: 'scholar@harvard.edu',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    },
    u_sc: {
      id: 'u_sc',
      email: 'rival@sc.edu',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    },
    u_unc: {
      id: 'u_unc',
      email: 'tarheel@unc.edu',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    },
    u_evil: {
      id: 'u_evil',
      email: 'spoof@clemson.edu.evil.com',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    },
    u_subdomain: {
      id: 'u_subdomain',
      email: 'sub@mail.clemson.edu',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    },
    u_notclemson: {
      id: 'u_notclemson',
      email: 'fake@notclemson.edu',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    },
  }

  const sb = createFakeSb(users)
  const participants = [
    { user_id: 'u_clemson' },
    { user_id: 'u_gclemson' },
    { user_id: 'u_mit' },
    { user_id: 'u_harvard' },
    { user_id: 'u_sc' },
    { user_id: 'u_unc' },
    { user_id: 'u_evil' },
    { user_id: 'u_subdomain' },
    { user_id: 'u_notclemson' },
  ]

  const flags = await studentFlagsFor(sb, participants)
  assert.deepEqual(flags, [
    true,  // clemson.edu
    true,  // g.clemson.edu
    false, // mit.edu
    false, // harvard.edu
    false, // sc.edu
    false, // unc.edu
    false, // clemson.edu.evil.com
    false, // mail.clemson.edu
    false, // notclemson.edu
  ])
})

test('unverified or pending email confirmation does not qualify', async () => {
  const users = {
    u_pending: {
      id: 'u_pending',
      email: 'pending@clemson.edu',
      email_confirmed_at: null,
    },
    u_unconfirmed: {
      id: 'u_unconfirmed',
      email: 'unconfirmed@g.clemson.edu',
      // email_confirmed_at undefined
    },
    u_identity_false: {
      id: 'u_identity_false',
      email: 'false_id@clemson.edu',
      identities: [{ identity_data: { email_verified: false } }],
    },
    u_identity_empty: {
      id: 'u_identity_empty',
      email: 'empty_id@clemson.edu',
      identities: [],
    },
  }

  const sb = createFakeSb(users)
  const participants = [
    { user_id: 'u_pending' },
    { user_id: 'u_unconfirmed' },
    { user_id: 'u_identity_false' },
    { user_id: 'u_identity_empty' },
  ]

  const flags = await studentFlagsFor(sb, participants)
  assert.deepEqual(flags, [false, false, false, false])
})

test('identities and legacy confirmed_at timestamps qualify confirmed clemson emails', async () => {
  const users = {
    u_legacy: {
      id: 'u_legacy',
      email: 'legacy@clemson.edu',
      confirmed_at: '2026-08-15T12:00:00Z',
    },
    u_oauth_bool: {
      id: 'u_oauth_bool',
      email: 'oauth_bool@g.clemson.edu',
      identities: [{ identity_data: { email_verified: true } }],
    },
    u_oauth_str: {
      id: 'u_oauth_str',
      email: 'oauth_str@clemson.edu',
      identities: [{ identity_data: { email_verified: 'true' } }],
    },
  }

  const sb = createFakeSb(users)
  const participants = [
    { user_id: 'u_legacy' },
    { user_id: 'u_oauth_bool' },
    { user_id: 'u_oauth_str' },
  ]

  const flags = await studentFlagsFor(sb, participants)
  assert.deepEqual(flags, [true, true, true])
})

test('case insensitivity and whitespace in auth user email', async () => {
  const users = {
    u_upper: {
      id: 'u_upper',
      email: 'TIGER@CLEMSON.EDU',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    },
    u_padded: {
      id: 'u_padded',
      email: '  student@g.clemson.edu  ',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    },
  }

  const sb = createFakeSb(users)
  const flags = await studentFlagsFor(sb, [{ user_id: 'u_upper' }, { user_id: 'u_padded' }])
  assert.deepEqual(flags, [true, true])
})

test('join form, client flags, and profile fields cannot spoof student discount', async () => {
  const users = {
    u_spoof: {
      id: 'u_spoof',
      email: 'attacker@gmail.com',
      email_confirmed_at: '2026-09-01T00:00:00Z',
      student_verified_at: '2026-09-01T00:00:00Z',
    },
  }

  const sb = createFakeSb(users)
  const participants = [
    // Participant record asserts clemson.edu and student status, but auth is gmail
    {
      user_id: 'u_spoof',
      email: 'president@clemson.edu',
      student_verified_at: '2026-09-01T00:00:00Z',
      is_student: true,
    },
    // Participant without user_id
    {
      email: 'realstudent@clemson.edu',
      is_student: true,
    },
  ]

  const flags = await studentFlagsFor(sb, participants)
  assert.deepEqual(flags, [false, false])
})

test('error handling: missing users, exceptions, missing admin client, and malformed items', async () => {
  const users = {
    u_ok: {
      id: 'u_ok',
      email: 'valid@clemson.edu',
      email_confirmed_at: '2026-09-01T00:00:00Z',
    },
  }
  const sb = createFakeSb(users, { throwFor: new Set(['u_throw']) })

  const participants = [
    { user_id: 'u_ok' },
    { user_id: 'u_missing' }, // getUserById returns error
    { user_id: 'u_throw' },   // getUserById throws
    null,                     // null participant
    undefined,                // undefined participant
    {},                       // participant without user_id
  ]

  const flags = await studentFlagsFor(sb, participants)
  assert.deepEqual(flags, [true, false, false, false, false, false])

  // Missing sb.auth.admin client entirely
  const noAdminSb = createFakeSb({}, { missingAdmin: true })
  const flagsNoAdmin = await studentFlagsFor(noAdminSb, [{ user_id: 'u_ok' }])
  assert.deepEqual(flagsNoAdmin, [false])

  // sb is null
  const flagsNullSb = await studentFlagsFor(null, [{ user_id: 'u_ok' }])
  assert.deepEqual(flagsNullSb, [false])
})

test('ordering matches input participants list and quirks are documented', async () => {
  const users = {
    u1: { id: 'u1', email: 's1@clemson.edu', email_confirmed_at: '2026-09-01T00:00:00Z' },
    u2: { id: 'u2', email: 's2@gmail.com', email_confirmed_at: '2026-09-01T00:00:00Z' },
    u3: { id: 'u3', email: 's3@g.clemson.edu', email_confirmed_at: '2026-09-01T00:00:00Z' },
  }
  const sb = createFakeSb(users)
  const flags = await studentFlagsFor(sb, [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }])
  assert.deepEqual(flags, [true, false, true])

  // BUG?: studentFlagsFor throws TypeError if participants is null or undefined
  // because it iterates directly with `for (const participant of participants)`.
  await assert.rejects(
    () => studentFlagsFor(sb, null),
    TypeError,
  )
  await assert.rejects(
    () => studentFlagsFor(sb, undefined),
    TypeError,
  )
})
