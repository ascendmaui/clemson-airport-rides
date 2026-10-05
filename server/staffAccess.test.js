import assert from 'node:assert/strict'
import test from 'node:test'
import { loadStaffAccess } from './staffAccess.js'

test('loadStaffAccess returns false for null user or client', async () => {
  const res = await loadStaffAccess(null, null)
  assert.equal(res.admin, false)
  assert.equal(res.support, false)
  assert.equal(res.profile, null)
})

test('loadStaffAccess identifies owner emails as admin and support', async () => {
  const adminUser = { email: 'johnmatveyev@gmail.com' }
  const res = await loadStaffAccess(null, adminUser)
  assert.equal(res.admin, true)
  assert.equal(res.support, true)
})

test('loadStaffAccess denies john@gmail.com even when support env lists it', async () => {
  const prev = process.env.SUPPORT_ADMIN_EMAILS
  process.env.SUPPORT_ADMIN_EMAILS = 'john@gmail.com,johnmatveev@gmail.com'
  try {
    const res = await loadStaffAccess(null, { email: 'John@gmail.com' })
    assert.equal(res.admin, false)
    assert.equal(res.support, false)
    const typo = await loadStaffAccess(null, { email: 'johnmatveev@gmail.com' })
    assert.equal(typo.admin, false)
    assert.equal(typo.support, false)
  } finally {
    if (prev === undefined) delete process.env.SUPPORT_ADMIN_EMAILS
    else process.env.SUPPORT_ADMIN_EMAILS = prev
  }
})

test('loadStaffAccess denies standard student users', async () => {
  const studentUser = { id: 'usr_1', email: 'clemson_student@clemson.edu' }
  const res = await loadStaffAccess(null, studentUser)
  assert.equal(res.admin, false)
  assert.equal(res.support, false)
})

test('loadStaffAccess resolves admin from profiles table', async () => {
  const mockSb = {
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'usr_admin', email: 'ops@test.com', role: 'admin', is_admin: true },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'admin_users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const user = { id: 'usr_admin', email: 'ops@test.com' }
  const res = await loadStaffAccess(mockSb, user)
  assert.equal(res.admin, true)
  assert.equal(res.support, true)
  assert.equal(res.profile?.role, 'admin')
})

test('loadStaffAccess resolves access_role from admin_users directory table', async () => {
  const mockSb = {
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'usr_supp', email: 'support_agent@clemson.edu', role: 'user', is_admin: false },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'admin_users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { access_role: 'support' },
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const user = { id: 'usr_supp', email: 'support_agent@clemson.edu' }
  const res = await loadStaffAccess(mockSb, user)
  assert.equal(res.admin, false, 'Support directory role is not admin')
  assert.equal(res.support, true, 'Support directory role grants support')
})

test('loadStaffAccess handles schema cache / missing column errors in profiles gracefully', async () => {
  let attemptedBasic = false
  const mockSb = {
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: (cols) => {
            if (cols.includes('is_admin')) {
              return {
                eq: () => ({
                  maybeSingle: async () => ({
                    data: null,
                    error: { message: 'column is_admin does not exist in schema cache' },
                  }),
                }),
              }
            }
            attemptedBasic = true
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'usr_fallback', email: 'staff@test.com', role: 'admin' },
                  error: null,
                }),
              }),
            }
          },
        }
      }
      if (table === 'admin_users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const user = { id: 'usr_fallback', email: 'staff@test.com' }
  const res = await loadStaffAccess(mockSb, user)
  assert.equal(attemptedBasic, true, 'Fell back to basic profile query')
  assert.equal(res.admin, true)
  assert.equal(res.support, true)
})
