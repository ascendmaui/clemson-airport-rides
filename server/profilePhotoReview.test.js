import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import driverHandler from '../api/driver.js'
import handleProfilePhoto, { listProfilePhotoQueue, reviewProfilePhotoDecision } from './endpoints/profilePhoto.js'
import { isVisionModelId, resolveVisionModel } from './llm.js'
import {
  PROFILE_PHOTO_APPROVED_COPY,
  PROFILE_PHOTO_CLOSER_LOOK_COPY,
} from '../shared/profilePhotoReview.js'

const USER = '11111111-1111-4111-8111-111111111111'
const ADMIN = '22222222-2222-4222-8222-222222222222'

function photoPath(stamp = '1') {
  return `${USER}/profile_photo/${stamp}.jpg`
}

function memorySb() {
  const state = {
    photos: [],
    notifications: [],
    documents: [{
      id: 'lic-1',
      profile_id: USER,
      doc_type: 'license_front',
      storage_path: `${USER}/license_front/license.jpg`,
      match_status: null,
    }],
    profiles: [{ id: USER, full_name: 'Ada Driver', email: 'ada@example.com' }],
    bytes: new Uint8Array(20_000),
  }

  function rowsFor(table) {
    if (table === 'driver_profile_photos') return state.photos
    if (table === 'admin_notifications') return state.notifications
    if (table === 'driver_documents') return state.documents
    if (table === 'profiles') return state.profiles
    return []
  }

  function from(table) {
    const ctx = { filters: [], op: 'select', row: null, patch: null, limit: null, order: null }
    const api = {
      select() { return api },
      eq(col, val) { ctx.filters.push({ col, val }); return api },
      in(col, val) { ctx.filters.push({ col, val, op: 'in' }); return api },
      order(col, opts) {
        ctx.order = { col, asc: opts?.ascending !== false }
        return api
      },
      limit(n) { ctx.limit = n; return api },
      insert(row) { ctx.op = 'insert'; ctx.row = { ...row }; return api },
      update(patch) { ctx.op = 'update'; ctx.patch = patch; return api },
      maybeSingle() { return finish(true) },
      then(resolve, reject) { return finish(false).then(resolve, reject) },
    }

    function finish(single) {
      return Promise.resolve().then(() => {
        const all = rowsFor(table)
        if (ctx.op === 'insert') {
          const saved = { id: ctx.row.id || `${table.slice(0, 4)}-${all.length + 1}`, ...ctx.row }
          all.push(saved)
          return { data: saved, error: null }
        }
        let found = all.filter((row) => ctx.filters.every((filter) => (
          filter.op === 'in' ? filter.val.includes(row[filter.col]) : row[filter.col] === filter.val
        )))
        if (ctx.order) {
          found = [...found].sort((a, b) => {
            const left = String(a[ctx.order.col] || '')
            const right = String(b[ctx.order.col] || '')
            return ctx.order.asc ? left.localeCompare(right) : right.localeCompare(left)
          })
        }
        if (ctx.limit) found = found.slice(0, ctx.limit)
        if (ctx.op === 'update') {
          const target = found[0]
          if (!target) return { data: null, error: null }
          Object.assign(target, ctx.patch)
          return { data: { ...target }, error: null }
        }
        return { data: single ? (found[0] || null) : found, error: null }
      })
    }
    return api
  }

  return {
    state,
    from,
    storage: {
      from() {
        return {
          async download() {
            const copy = state.bytes.slice()
            return { data: { arrayBuffer: async () => copy.buffer }, error: null }
          },
          async createSignedUrl(path) {
            return { data: { signedUrl: `https://files.example/${path}` }, error: null }
          },
        }
      },
    },
  }
}

function mockRes() {
  return {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(payload) { this.body = payload == null ? '' : String(payload) },
    json() { return this.body ? JSON.parse(this.body) : null },
  }
}

const CLEAR = {
  clear: true,
  blurry: false,
  dark: false,
  faceCount: 1,
  matchesLicense: true,
  confidence: 0.93,
  reason: 'One sharp face matches the license.',
  decision: 'reject',
}

async function postPhoto(sb, vision, stamp = '1') {
  const res = mockRes()
  await driverHandler({
    method: 'POST',
    url: '/api/driver?action=profile-photo',
    headers: {},
    body: { storagePath: photoPath(stamp) },
  }, res, {
    sb,
    user: { id: USER },
    vision: async () => vision,
    env: {},
  })
  return { status: res.statusCode, json: res.json(), sb }
}

test('a clear license match is approved and does not notify an admin', async () => {
  const sb = memorySb()
  const result = await postPhoto(sb, CLEAR)
  assert.equal(result.status, 200)
  assert.equal(result.json.driverMessage, PROFILE_PHOTO_APPROVED_COPY)
  assert.equal(result.json.driverMessage, 'Approved')
  assert.equal(result.json.reviewStatus, 'approved')
  assert.equal(sb.state.notifications.length, 0)
  assert.equal(sb.state.photos[0].review_status, 'approved')
  assert.equal(sb.state.photos[0].ai_verdict, 'approved')
  assert.equal(sb.state.photos[0].ai_confidence, 0.93)
  assert.match(sb.state.photos[0].ai_reason, /matches the license/)
  assert.notEqual(sb.state.photos[0].review_status, 'rejected')
  assert.equal(sb.state.documents[0].match_status, 'matched')
  const loaded = mockRes()
  await handleProfilePhoto({
    method: 'GET',
    url: '/api/driver?action=profile-photo',
    headers: {},
  }, loaded, { sb, user: { id: USER } })
  assert.equal(loaded.json().photo.reviewStatus, 'approved')
  assert.equal(loaded.json().photo.driverMessage, 'Approved')
})

test('a blurry photo goes to admin review and creates a notification', async () => {
  const sb = memorySb()
  const result = await postPhoto(sb, {
    clear: false,
    blurry: true,
    dark: false,
    faceCount: 1,
    matchesLicense: true,
    confidence: 0.41,
    reason: 'The profile photo is blurry.',
  }, 'blur')
  assert.equal(result.status, 200)
  assert.equal(result.json.reviewStatus, 'pending_admin_review')
  assert.equal(result.json.driverMessage, PROFILE_PHOTO_CLOSER_LOOK_COPY)
  assert.equal(result.json.notified, true)
  assert.equal(sb.state.notifications.length, 1)
  const note = sb.state.notifications[0]
  assert.equal(note.kind, 'other')
  assert.equal(note.entity_type, 'driver_profile_photo')
  assert.equal(note.entity_id, result.json.photoId)
  assert.match(note.body, /blurry/i)
  assert.match(note.title, /Profile photo/)
  assert.notEqual(sb.state.photos[0].review_status, 'rejected')
  assert.equal(sb.state.documents[0].match_status, 'needs_review')
  const queue = await listProfilePhotoQueue(sb)
  assert.equal(queue.photos.length, 1)
  assert.match(queue.photos[0].aiReason, /blurry/i)
  assert.equal(queue.photos[0].name, 'Ada Driver')
})

test('a face that does not match the license goes to admin review', async () => {
  const sb = memorySb()
  const result = await postPhoto(sb, {
    clear: true,
    blurry: false,
    dark: false,
    faceCount: 1,
    matchesLicense: false,
    confidence: 0.88,
    reason: 'The face does not match the license.',
  }, 'miss')
  assert.equal(result.status, 200)
  assert.equal(result.json.reviewStatus, 'pending_admin_review')
  assert.equal(result.json.driverMessage, "We're taking a closer look — usually within a day.")
  assert.equal(sb.state.photos[0].ai_verdict, 'needs_admin')
  assert.equal(sb.state.photos[0].review_status, 'pending_admin_review')
  assert.notEqual(sb.state.photos[0].review_status, 'rejected')
  assert.equal(sb.state.notifications.length, 1)
  assert.match(sb.state.notifications[0].body, /does not match/)
  assert.equal(sb.state.documents[0].match_status, 'mismatch')
})

test('an AI error goes to admin review and is not a rejection', async () => {
  const sb = memorySb()
  const res = mockRes()
  await handleProfilePhoto({
    method: 'POST',
    url: '/api/driver?action=profile-photo',
    headers: {},
    body: { storagePath: photoPath('err') },
  }, res, {
    sb,
    user: { id: USER },
    vision: async () => { throw new Error('gateway timeout sk-secret-key') },
    env: {},
  })
  const json = res.json()
  assert.equal(res.statusCode, 200)
  assert.equal(json.reviewStatus, 'pending_admin_review')
  assert.equal(json.driverMessage, PROFILE_PHOTO_CLOSER_LOOK_COPY)
  assert.equal(sb.state.photos[0].ai_verdict, 'error')
  assert.match(sb.state.photos[0].ai_reason, /AI review failed/)
  assert.equal(sb.state.photos[0].ai_reason.includes('sk-secret-key'), false)
  assert.notEqual(sb.state.photos[0].review_status, 'rejected')
  assert.equal(sb.state.notifications.length, 1)
})

test('without a vision model the admin fallback flag sends every photo to review', async () => {
  const sb = memorySb()
  const res = mockRes()
  await handleProfilePhoto({
    method: 'POST',
    url: '/api/driver?action=profile-photo',
    headers: {},
    body: { storagePath: photoPath('off') },
  }, res, {
    sb,
    user: { id: USER },
    vision: async () => ({ unavailable: true }),
    env: { DRIVER_PROFILE_PHOTO_ADMIN_FALLBACK: 'off' },
  })
  assert.equal(res.json().reviewStatus, 'pending_manual_review')
  assert.equal(sb.state.notifications.length, 0)

  const queued = mockRes()
  await handleProfilePhoto({
    method: 'POST',
    url: '/api/driver?action=profile-photo',
    headers: {},
    body: { storagePath: photoPath('on') },
  }, queued, {
    sb,
    user: { id: USER },
    vision: async () => ({ unavailable: true }),
    env: { DRIVER_PROFILE_PHOTO_ADMIN_FALLBACK: 'on' },
  })
  assert.equal(queued.json().reviewStatus, 'pending_admin_review')
  assert.equal(queued.json().driverMessage, PROFILE_PHOTO_CLOSER_LOOK_COPY)
  assert.equal(sb.state.notifications.length, 1)
  assert.match(sb.state.photos.at(-1).ai_reason, /not configured/)
})

test('only an admin can reject, and approval keeps the stored AI reason', async () => {
  const sb = memorySb()
  await postPhoto(sb, {
    clear: false,
    blurry: true,
    dark: false,
    faceCount: 1,
    matchesLicense: false,
    confidence: 0.2,
    reason: 'The profile photo is blurry.',
  }, 'admin')
  const photoId = sb.state.photos[0].id
  const missing = await reviewProfilePhotoDecision({
    sb, adminUser: { id: ADMIN }, photoId, decision: 'reject', reason: 'no',
  })
  assert.equal(missing.status, 400)
  assert.equal(sb.state.photos[0].review_status, 'pending_admin_review')
  const rejected = await reviewProfilePhotoDecision({
    sb, adminUser: { id: ADMIN }, photoId, decision: 'reject', reason: 'Not the license holder',
  })
  assert.equal(rejected.status, 200)
  assert.equal(rejected.photo.review_status, 'rejected')
  assert.equal(rejected.photo.ai_verdict, 'needs_admin')
  assert.match(rejected.photo.ai_reason, /blurry/)
  assert.equal(rejected.photo.review_note, 'Not the license holder')
})

test('profile photo review prefers the AI Gateway and uses OpenAI only when the gateway is unset', () => {
  const savedGateway = process.env.AI_GATEWAY_API_KEY
  const savedOpenAI = process.env.OPENAI_API_KEY
  const savedModel = process.env.HELP_CHAT_MODEL
  try {
    delete process.env.AI_GATEWAY_API_KEY
    delete process.env.OPENAI_API_KEY
    process.env.HELP_CHAT_MODEL = 'gpt-4o-mini'
    assert.equal(resolveVisionModel(), null)
    process.env.OPENAI_API_KEY = 'sk-existing-key'
    const openai = resolveVisionModel()
    assert.equal(openai.provider, 'openai')
    assert.equal(openai.modelId, 'gpt-4o-mini')
    process.env.HELP_CHAT_MODEL = 'gpt-3.5-turbo'
    assert.equal(resolveVisionModel(), null)
    process.env.AI_GATEWAY_API_KEY = 'gateway-test-key'
    process.env.HELP_CHAT_MODEL = 'gpt-4o-mini'
    const resolved = resolveVisionModel()
    assert.equal(resolved.provider, 'gateway')
    assert.equal(resolved.modelId, 'openai/gpt-4o-mini')
    assert.equal(isVisionModelId('openai/gpt-4o-mini'), true)
    assert.equal(isVisionModelId('gpt-3.5-turbo'), false)
  } finally {
    if (savedGateway === undefined) delete process.env.AI_GATEWAY_API_KEY
    else process.env.AI_GATEWAY_API_KEY = savedGateway
    if (savedOpenAI === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = savedOpenAI
    if (savedModel === undefined) delete process.env.HELP_CHAT_MODEL
    else process.env.HELP_CHAT_MODEL = savedModel
  }
})

test('photos already pending manual review stay in the admin queue', async () => {
  const sb = memorySb()
  sb.state.photos.push({
    id: 'legacy-1',
    profile_id: USER,
    storage_path: photoPath('legacy'),
    review_status: 'pending_manual_review',
    ai_verdict: null,
    ai_reason: null,
    created_at: '2026-10-01T00:00:00.000Z',
  })
  const queue = await listProfilePhotoQueue(sb)
  assert.equal(queue.photos.length, 1)
  assert.equal(queue.photos[0].id, 'legacy-1')
  assert.equal(queue.photos[0].reviewStatus, 'pending_manual_review')
  assert.equal(queue.photos[0].aiReason, null)
  assert.equal(queue.photos[0].name, 'Ada Driver')
})

test('driver and admin screens use the review copy and the applications queue', () => {
  const app = readFileSync(new URL('../apps/driver/app/profile-photo.tsx', import.meta.url), 'utf8')
  const web = readFileSync(new URL('../src/components/DriverProfilePhoto.jsx', import.meta.url), 'utf8')
  const home = readFileSync(new URL('../src/screens/DriverHome.jsx', import.meta.url), 'utf8')
  const queue = readFileSync(new URL('../src/components/ProfilePhotoReviewQueue.jsx', import.meta.url), 'utf8')
  const admin = readFileSync(new URL('../src/screens/AdminDrivers.jsx', import.meta.url), 'utf8')
  assert.equal(PROFILE_PHOTO_APPROVED_COPY, 'Approved')
  assert.equal(PROFILE_PHOTO_CLOSER_LOOK_COPY, "We're taking a closer look — usually within a day.")
  assert.match(app, /\/api\/driver\?action=profile-photo/)
  assert.match(app, /photo\.reviewStatus/)
  assert.match(app, /driverProfilePhotoMessage\(photo\.reviewStatus\)/)
  assert.match(app, /driverProfilePhotoMessage\(review\.reviewStatus\)/)
  assert.doesNotMatch(app, /pending manual review/i)
  assert.match(web, /photo\.reviewStatus/)
  assert.match(web, /driverProfilePhotoMessage\(photo\.reviewStatus\)/)
  assert.match(home, /DriverProfilePhoto/)
  assert.match(queue, /#\/admin\?tab=applications/)
  assert.match(queue, /Reason:/)
  assert.match(admin, /ProfilePhotoReviewQueue/)
})
