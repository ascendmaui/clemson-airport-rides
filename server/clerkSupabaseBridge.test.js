import assert from 'node:assert/strict'
import test from 'node:test'
import {
  configuredSecret,
  handleClerkSupabaseSession,
  verifiedEmailFromClerkUser,
} from './clerkSupabaseBridge.js'

const SECRET = 'sk_test_clerk_secret_value_not_real'
const USER_ID = '11111111-1111-1111-1111-111111111111'

function clerkUser() {
  return {
    id: 'user_clerk',
    firstName: 'Ada',
    lastName: 'Lovelace',
    primaryEmailAddressId: 'email_1',
    emailAddresses: [{
      id: 'email_1',
      emailAddress: 'Ada@clemson.edu',
      verification: { status: 'verified' },
    }],
  }
}

function deps(overrides = {}) {
  const updates = []
  return {
    updates,
    clerkSecret: SECRET,
    serviceConfigured: true,
    async verifyClerk() {
      return { sub: 'user_clerk' }
    },
    async loadClerkUser() {
      return clerkUser()
    },
    async generateLink() {
      return {
        data: {
          properties: { hashed_token: 'hash_1', verification_type: 'magiclink' },
          user: {
            id: USER_ID,
            user_metadata: { full_name: 'Existing Rider', promo_code: 'KEEPME' },
          },
        },
        error: null,
      }
    },
    async updateUser(id, patch) {
      updates.push({ id, patch })
    },
    ...overrides,
  }
}

test('bridge env checklist rejects placeholders and never echoes secret values', () => {
  assert.equal(configuredSecret('CLERK_SECRET_KEY', 'sk_test_placeholder'), false)
  assert.equal(configuredSecret('CLERK_SECRET_KEY', ''), false)
  assert.equal(configuredSecret('CLERK_SECRET_KEY', SECRET), true)
})

test('unconfigured bridge lists env names and leaves email auth alone', async () => {
  const result = await handleClerkSupabaseSession({ method: 'POST', headers: {}, body: {} }, {
    clerkSecret: '',
    serviceConfigured: false,
  })
  assert.equal(result.status, 503)
  assert.deepEqual(result.body.missing, ['CLERK_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
  assert.equal(JSON.stringify(result.body).includes('sk_'), false)
})

test('verified Clerk user becomes a Supabase magic-link hash, not a Clerk JWT', async () => {
  const harness = deps()
  const result = await handleClerkSupabaseSession({
    method: 'POST',
    headers: { authorization: 'Bearer clerk_session_jwt' },
    body: { promoCode: 'newcode' },
  }, harness)
  assert.equal(result.status, 200)
  assert.equal(result.body.token_hash, 'hash_1')
  assert.equal(result.body.type, 'magiclink')
  assert.equal(result.body.email, 'ada@clemson.edu')
  assert.equal(result.body.access_token, undefined)
  assert.equal(harness.updates[0].id, USER_ID)
  assert.equal(harness.updates[0].patch.user_metadata.clerk_user_id, 'user_clerk')
  assert.equal(harness.updates[0].patch.user_metadata.promo_code, 'KEEPME')
  assert.equal(harness.updates[0].patch.user_metadata.full_name, 'Existing Rider')
})

test('unverified Clerk email does not mint a Supabase session', async () => {
  const result = await handleClerkSupabaseSession({
    method: 'POST',
    headers: { authorization: 'Bearer clerk_session_jwt' },
    body: {},
  }, deps({
    async loadClerkUser() {
      const user = clerkUser()
      user.emailAddresses[0].verification.status = 'unverified'
      return user
    },
  }))
  assert.equal(result.status, 403)
})

test('rejected Clerk tokens and bad JSON do not call Supabase', async () => {
  let links = 0
  const rejected = await handleClerkSupabaseSession({
    method: 'POST',
    headers: { authorization: 'Bearer nope' },
    body: {},
  }, deps({
    async verifyClerk() {
      throw new Error('bad')
    },
    async generateLink() {
      links += 1
      return { data: null, error: { message: 'should not run' } }
    },
  }))
  assert.equal(rejected.status, 401)
  assert.equal(links, 0)

  const badJson = await handleClerkSupabaseSession({
    method: 'POST',
    headers: { authorization: 'Bearer clerk_session_jwt' },
    body: '{',
  }, deps())
  assert.equal(badJson.status, 400)
})

test('clerk user email helper requires a verified primary address', () => {
  const parsed = verifiedEmailFromClerkUser(clerkUser())
  assert.equal(parsed.email, 'ada@clemson.edu')
  assert.equal(parsed.emailVerified, true)
  assert.equal(parsed.fullName, 'Ada Lovelace')
})
