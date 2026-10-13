import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import driverHandler from '../api/driver.js'
import handleDocumentReview, { listDocumentReviewQueue, reviewDocumentDecision } from './endpoints/documentAiReview.js'
import {
  NVIDIA_DOC_CALL_TIMEOUT_MS,
  NVIDIA_DOC_MODEL_DEFAULT,
  NVIDIA_DOC_MODEL_FALLBACK,
  nvidiaCallShouldFallback,
  nvidiaDocumentModelIds,
  resolveNvidiaDocumentModel,
} from './llm.js'
import { readDocumentOnce } from './documentAiReview.js'

const USER = '11111111-1111-4111-8111-111111111111'
const ADMIN = '22222222-2222-4222-8222-222222222222'
const VALID_VIN = '1HGCM82633A004352'

const CLEAR = {
  name: 'Ada Driver',
  expiryDate: '2030-06-01',
  plate: 'ABC123',
  vin: VALID_VIN,
  state: 'SC',
  documentType: 'registration',
  legible: 'yes',
}

function memorySb() {
  const state = {
    documents: [{
      id: 'doc-1',
      profile_id: USER,
      doc_type: 'registration',
      storage_path: `${USER}/registration/card.jpg`,
      review_status: 'pending_manual_review',
      ai_verdict: null,
      ai_confidence: null,
      ai_reason: null,
      ai_reasons: null,
      ai_extraction: null,
      created_at: '2026-10-01T00:00:00.000Z',
    }],
    notifications: [],
    profiles: [{ id: USER, full_name: 'Ada Driver', email: 'ada@example.com' }],
    vehicles: [{ driver_id: USER, plate: 'ABC123', vin: VALID_VIN }],
    bytes: new Uint8Array(20_000),
  }

  function rowsFor(table) {
    if (table === 'driver_documents') return state.documents
    if (table === 'admin_notifications') return state.notifications
    if (table === 'profiles') return state.profiles
    if (table === 'vehicles') return state.vehicles
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

    function matches(row) {
      return ctx.filters.every((filter) => (
        filter.op === 'in' ? filter.val.includes(row[filter.col]) : row[filter.col] === filter.val
      ))
    }

    function finish(single) {
      return Promise.resolve().then(() => {
        const all = rowsFor(table)
        if (ctx.op === 'insert') {
          const saved = { id: ctx.row.id || `${table.slice(0, 4)}-${all.length + 1}`, ...ctx.row }
          all.push(saved)
          return { data: saved, error: null }
        }
        let found = all.filter(matches)
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

async function postDocument(sb, vision, env = { NVIDIA_API_KEY: 'nvapi-test' }) {
  const res = mockRes()
  await driverHandler({
    method: 'POST',
    url: '/api/driver?action=review-document',
    headers: {},
    body: { docType: 'registration', storagePath: `${USER}/registration/card.jpg` },
  }, res, { sb, user: { id: USER }, vision: async () => vision, env })
  return { status: res.statusCode, json: res.json(), sb }
}

test('a confident registration match is approved and does not notify an admin', async () => {
  const sb = memorySb()
  const result = await postDocument(sb, CLEAR)
  assert.equal(result.status, 200)
  assert.equal(result.json.reviewStatus, 'approved')
  assert.equal(result.json.driverMessage, 'Approved')
  assert.equal(sb.state.notifications.length, 0)
  assert.equal(sb.state.documents[0].review_status, 'approved')
  assert.equal(sb.state.documents[0].ai_verdict, 'approved')
  assert.ok(Number(sb.state.documents[0].ai_confidence) >= 0.85)
  assert.notEqual(sb.state.documents[0].review_status, 'rejected')
})

test('a hard rule sends the document to manual review and never rejects it', async () => {
  const sb = memorySb()
  const result = await postDocument(sb, { ...CLEAR, expiryDate: '2020-01-01' })
  assert.equal(result.status, 200)
  assert.equal(result.json.reviewStatus, 'pending_manual_review')
  assert.match(result.json.aiReason, /expired/i)
  assert.equal(result.json.notified, true)
  assert.equal(sb.state.documents[0].ai_verdict, 'needs_admin')
  assert.notEqual(sb.state.documents[0].review_status, 'rejected')
  const queue = await listDocumentReviewQueue(sb)
  assert.equal(queue.documents.length, 1)
  assert.equal(queue.documents[0].name, 'Ada Driver')
  assert.match(queue.documents[0].aiReason, /expired/i)
})

test('without NVIDIA_API_KEY every document waits for manual review and OpenAI is not used', async () => {
  const sb = memorySb()
  let nvidiaCalls = 0
  const res = mockRes()
  await handleDocumentReview({
    method: 'POST',
    url: '/api/driver?action=review-document',
    headers: {},
    body: { docType: 'registration', storagePath: `${USER}/registration/card.jpg` },
  }, res, {
    sb,
    user: { id: USER },
    env: { OPENAI_API_KEY: 'sk-should-not-be-used', AI_GATEWAY_API_KEY: 'gateway-should-not-be-used' },
    generateText() {
      nvidiaCalls += 1
      throw new Error('NVIDIA should not be called')
    },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().reviewStatus, 'pending_manual_review')
  assert.equal(res.json().aiVerdict, 'unavailable')
  assert.match(res.json().aiReason, /manual review/i)
  assert.equal(nvidiaCalls, 0)
  assert.equal(resolveNvidiaDocumentModel({ OPENAI_API_KEY: 'sk-test' }), null)
  assert.notEqual(sb.state.documents[0].review_status, 'rejected')
})

test('NVIDIA_DOC_MODEL defaults to Llama 3.2 11B and then tries Nemotron', async () => {
  const saved = process.env.NVIDIA_API_KEY
  const savedModel = process.env.NVIDIA_DOC_MODEL
  try {
    delete process.env.NVIDIA_API_KEY
    delete process.env.NVIDIA_DOC_MODEL
    assert.equal(resolveNvidiaDocumentModel(), null)
    const resolved = resolveNvidiaDocumentModel({ NVIDIA_API_KEY: 'nvapi-test' })
    assert.equal(resolved.provider, 'nvidia')
    assert.equal(resolved.modelId, NVIDIA_DOC_MODEL_DEFAULT)
    assert.equal(resolved.modelId, 'meta/llama-3.2-11b-vision-instruct')
    assert.equal(resolved.fallbackModelId, NVIDIA_DOC_MODEL_FALLBACK)
    assert.equal(resolved.fallbackModelId, 'nvidia/nemotron-nano-12b-v2-vl')
    assert.equal(resolved.timeoutMs, NVIDIA_DOC_CALL_TIMEOUT_MS)
    assert.equal(resolved.timeoutMs, 20_000)
    assert.deepEqual(nvidiaDocumentModelIds(''), [
      'meta/llama-3.2-11b-vision-instruct',
      'nvidia/nemotron-nano-12b-v2-vl',
    ])
    assert.deepEqual(nvidiaDocumentModelIds('nvidia/nemotron-nano-12b-v2-vl'), [
      'nvidia/nemotron-nano-12b-v2-vl',
      'meta/llama-3.2-11b-vision-instruct',
    ])
    assert.deepEqual(nvidiaDocumentModelIds('meta/llama-3.2-90b-vision-instruct'), [
      'meta/llama-3.2-90b-vision-instruct',
      'meta/llama-3.2-11b-vision-instruct',
      'nvidia/nemotron-nano-12b-v2-vl',
    ])
  } finally {
    if (saved === undefined) delete process.env.NVIDIA_API_KEY
    else process.env.NVIDIA_API_KEY = saved
    if (savedModel === undefined) delete process.env.NVIDIA_DOC_MODEL
    else process.env.NVIDIA_DOC_MODEL = savedModel
  }

  const calls = []
  const timeouts = []
  const seen = await readDocumentOnce({
    bytes: new Uint8Array(20_000),
    mime: 'image/jpeg',
  }, {
    resolveNvidiaDocumentModel: () => ({
      modelIds: [
        'meta/llama-3.2-11b-vision-instruct',
        'nvidia/nemotron-nano-12b-v2-vl',
      ],
      timeoutMs: 20_000,
      client(modelId) { return { modelId } },
    }),
    async generateText({ model, timeout, maxRetries }) {
      calls.push(model.modelId)
      timeouts.push(timeout)
      assert.equal(maxRetries, 0)
      if (model.modelId === 'meta/llama-3.2-11b-vision-instruct') {
        const err = new DOMException('total timeout of 20000ms exceeded', 'TimeoutError')
        throw err
      }
      return { text: JSON.stringify({ ...CLEAR, legible: 'yes' }) }
    },
  })
  assert.equal(nvidiaCallShouldFallback({ statusCode: 410, message: 'Gone' }), true)
  assert.equal(nvidiaCallShouldFallback({ statusCode: 503, message: 'unavailable' }), true)
  assert.equal(nvidiaCallShouldFallback(new DOMException('total timeout of 20000ms exceeded', 'TimeoutError')), true)
  assert.equal(nvidiaCallShouldFallback({ statusCode: 400, message: 'bad request' }), false)
  assert.deepEqual(timeouts, [20_000, 20_000])
  assert.deepEqual(calls, [
    'meta/llama-3.2-11b-vision-instruct',
    'nvidia/nemotron-nano-12b-v2-vl',
  ])
  assert.equal(seen.modelId, 'nvidia/nemotron-nano-12b-v2-vl')
  assert.equal(seen.name, 'Ada Driver')

  const serverError = []
  await readDocumentOnce({
    bytes: new Uint8Array(20_000),
    mime: 'image/jpeg',
  }, {
    resolveNvidiaDocumentModel: () => ({
      modelIds: ['meta/llama-3.2-11b-vision-instruct', 'nvidia/nemotron-nano-12b-v2-vl'],
      timeoutMs: 20_000,
      client(modelId) { return { modelId } },
    }),
    async generateText({ model }) {
      serverError.push(model.modelId)
      if (model.modelId === 'meta/llama-3.2-11b-vision-instruct') {
        const err = new Error('HTTP 502 Bad Gateway')
        err.statusCode = 502
        throw err
      }
      return { text: JSON.stringify({ ...CLEAR, legible: 'yes' }) }
    },
  })
  assert.deepEqual(serverError, [
    'meta/llama-3.2-11b-vision-instruct',
    'nvidia/nemotron-nano-12b-v2-vl',
  ])

  const clientError = []
  await assert.rejects(() => readDocumentOnce({
    bytes: new Uint8Array(20_000),
    mime: 'image/jpeg',
  }, {
    resolveNvidiaDocumentModel: () => ({
      modelIds: ['meta/llama-3.2-11b-vision-instruct', 'nvidia/nemotron-nano-12b-v2-vl'],
      timeoutMs: 20_000,
      client(modelId) { return { modelId } },
    }),
    async generateText({ model }) {
      clientError.push(model.modelId)
      const err = new Error('HTTP 400 bad request')
      err.statusCode = 400
      throw err
    },
  }), /400/)
  assert.deepEqual(clientError, ['meta/llama-3.2-11b-vision-instruct'])

  const source = readFileSync(new URL('./llm.js', import.meta.url), 'utf8')
  const documentResolver = source.slice(source.indexOf('export function resolveNvidiaDocumentModel'))
  assert.equal(documentResolver.includes('OPENAI_API_KEY'), false)
  assert.equal(documentResolver.includes('createOpenAI('), false)
  assert.match(documentResolver, /createOpenAICompatible/)
})

test('only an admin can reject, and the stored AI reason stays', async () => {
  const sb = memorySb()
  await postDocument(sb, { ...CLEAR, name: 'Someone Else' })
  const documentId = sb.state.documents[0].id
  const missing = await reviewDocumentDecision({
    sb, adminUser: { id: ADMIN }, documentId, decision: 'reject', reason: 'no',
  })
  assert.equal(missing.status, 400)
  assert.notEqual(sb.state.documents[0].review_status, 'rejected')
  const rejected = await reviewDocumentDecision({
    sb, adminUser: { id: ADMIN }, documentId, decision: 'reject', reason: 'Name does not match',
  })
  assert.equal(rejected.status, 200)
  assert.equal(rejected.document.review_status, 'rejected')
  assert.equal(rejected.document.ai_verdict, 'needs_admin')
  assert.match(rejected.document.ai_reason, /does not match the name/i)
  assert.equal(rejected.document.review_note, 'Name does not match')
})
