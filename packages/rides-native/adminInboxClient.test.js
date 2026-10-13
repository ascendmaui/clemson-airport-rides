import assert from 'node:assert/strict'
import test from 'node:test'
import { loadAdminInbox, runAdminInboxAction } from './adminInboxClient.js'

const supabase = {
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'token' } } }),
  },
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

test('a non-admin response hides the inbox', async () => {
  const hidden = await loadAdminInbox(supabase, async () => jsonResponse(403, { error: 'Admin only' }))
  assert.equal(hidden.admin, false)
  assert.equal(hidden.total, 0)
  const signedOut = await loadAdminInbox(supabase, async () => jsonResponse(401, { error: 'Sign in required' }))
  assert.equal(signedOut.admin, false)
})

test('an admin response keeps the badge count and posts the existing photo action', async () => {
  const loaded = await loadAdminInbox(supabase, async (url) => {
    assert.match(String(url), /\/api\/admin\?action=inbox/)
    return jsonResponse(200, { total: 2, counts: { photo_review: 2 }, items: [] })
  })
  assert.equal(loaded.admin, true)
  assert.equal(loaded.total, 2)

  let posted = null
  const result = await runAdminInboxAction(supabase, {
    id: 'approve-photo',
    method: 'POST',
    path: '/api/admin-drivers',
    body: { action: 'review-profile-photo', photoId: 'photo-1', decision: 'approve' },
  }, {
    fetch: async (url, init) => {
      posted = { url: String(url), body: JSON.parse(init.body) }
      return jsonResponse(200, { ok: true, message: 'Profile photo approved.' })
    },
  })
  assert.match(posted.url, /\/api\/admin-drivers$/)
  assert.equal(posted.body.action, 'review-profile-photo')
  assert.equal(posted.body.decision, 'approve')
  assert.equal(result.message, 'Profile photo approved.')
})
