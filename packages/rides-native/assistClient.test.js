import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAgentHttpResponse, postAgent, supportTicketRequest } from './assistClient.js'
import { createLostFoundReport } from './lostFoundClient.js'
import { sendTripMessage } from './tripMessagesClient.js'
import { ACCOUNT_DELETION_TICKET } from '../../shared/accountDeletion.js'
import { PRIVACY_SECTIONS, TERMS_SECTIONS } from '../../shared/legalCopy.js'
import { DRIVER_EXPO_PROJECT, FROZEN_EXPO_SLUG, RIDER_EXPO_PROJECT } from '../../shared/productLinks.js'
import { validateTicket } from '../../server/supportAgent.js'
import { readFileSync } from 'node:fs'

test('help JSON replies stay structured for the rider app', () => {
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'application/json',
    metaHeader: null,
    text: JSON.stringify({ reply: 'Open Schedule.', source: 'offline', actions: [] }),
  })
  assert.equal(parsed.reply, 'Open Schedule.')
  assert.equal(parsed.source, 'offline')
})

test('streamed support text keeps the ticket draft out of the visible reply', () => {
  const meta = Buffer.from(JSON.stringify({
    source: 'llm',
    ticketDraft: {
      ready: true,
      category: 'billing',
      subject: 'Deposit charged twice',
      body: 'The airport deposit posted twice on one trip.',
    },
  })).toString('base64')
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'text/plain; charset=utf-8',
    metaHeader: meta,
    text: 'I can file that.\nTICKET_DRAFT: {"ready":true,"category":"billing","subject":"Deposit charged twice","body":"The airport deposit posted twice on one trip."}',
  })
  assert.equal(parsed.reply, 'I can file that.')
  assert.equal(parsed.ticketDraft.category, 'billing')
  assert.equal(parsed.source, 'llm')
})

test('account deletion ticket matches the support validator', () => {
  const checked = validateTicket(ACCOUNT_DELETION_TICKET)
  assert.equal(checked.ok, true)
  assert.equal(checked.ticket.category, 'account')
})

test('legal copy is shared and the install links are the current apps', () => {
  assert.ok(PRIVACY_SECTIONS.some((section) => section.heading === 'Your choices'))
  assert.ok(TERMS_SECTIONS.some((section) => section.heading === 'Payments & earnings'))
  assert.match(RIDER_EXPO_PROJECT, /clemson-rides-rider/)
  assert.match(DRIVER_EXPO_PROJECT, /clemson-rides-driver/)
  assert.equal(FROZEN_EXPO_SLUG, 'clemson-airport-rides')
})

test('the marketing page does not install the frozen 1.0.0 binary', () => {
  const source = readFileSync(new URL('../../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /ae9bb5b6|a9cfec15/)
  assert.doesNotMatch(source, /projects\/clemson-airport-rides\/builds/)
  assert.match(source, /Book a ride/)
  assert.match(source, /RIDER_EXPO_PROJECT/)
  assert.match(source, /DRIVER_EXPO_PROJECT/)
})

test('lost-and-found and ride chat reject empty text before any network call', async () => {
  await assert.rejects(
    () => createLostFoundReport({}, { description: 'x' }),
    /few words/,
  )
  await assert.rejects(
    () => sendTripMessage({}, { tripId: 'trip', body: '   ' }),
    /empty/,
  )
})

// ---------------------------------------------------------------------------
// assistClient.js comprehensive unit tests (fake fetch, no network)
// ---------------------------------------------------------------------------

async function withFakeFetch(mockFetch, testFn) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch
  try {
    return await testFn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

function fakeResponse({ status = 200, headers = {}, body = '' } = {}) {
  const ok = status >= 200 && status < 300
  const headerObj = new Headers(headers)
  const bodyText = typeof body === 'object' && body !== null ? JSON.stringify(body) : String(body ?? '')
  return {
    ok,
    status,
    headers: headerObj,
    async text() {
      return bodyText
    },
    async json() {
      return JSON.parse(bodyText)
    },
  }
}

// ---------------------------------------------------------------------------
// parseAgentHttpResponse tests
// ---------------------------------------------------------------------------

test('parseAgentHttpResponse: happy path JSON with full payload preserves all fields', () => {
  const meta = Buffer.from(JSON.stringify({
    source: 'meta-source',
    actions: ['fallback_action'],
  })).toString('base64')
  const payload = {
    reply: 'Your ride is confirmed.',
    actions: ['view_trip', 'call_driver'],
    source: 'backend',
    notice: 'Driver on the way',
    roleVariant: 'rider',
    contextSummary: 'Terminal 2 pickup',
    ticketDraft: { ready: true, category: 'ride_dispute', subject: 'Route issue', body: 'Wrong route taken' },
    redactedUserText: 'Where is driver?',
  }
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'application/json; charset=utf-8',
    metaHeader: meta,
    text: JSON.stringify(payload),
  })
  assert.equal(parsed.reply, 'Your ride is confirmed.')
  assert.deepEqual(parsed.actions, ['view_trip', 'call_driver'])
  assert.equal(parsed.source, 'backend')
  assert.equal(parsed.notice, 'Driver on the way')
  assert.equal(parsed.roleVariant, 'rider')
  assert.equal(parsed.contextSummary, 'Terminal 2 pickup')
  assert.deepEqual(parsed.ticketDraft, payload.ticketDraft)
  assert.equal(parsed.redactedUserText, 'Where is driver?')
})

test('parseAgentHttpResponse: happy path JSON with minimal object falls back to defaults', () => {
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'application/json',
    metaHeader: null,
    text: '{}',
  })
  assert.equal(parsed.reply, 'No reply.')
  assert.deepEqual(parsed.actions, [])
  assert.equal(parsed.source, 'offline')
  assert.equal(parsed.notice, null)
  // BUG?: In shapeJson, roleVariant defaults to undefined while other nullable fields (notice, contextSummary, ticketDraft, redactedUserText) default to null.
  assert.equal(parsed.roleVariant, undefined)
  assert.equal(parsed.contextSummary, null)
  assert.equal(parsed.ticketDraft, null)
  assert.equal(parsed.redactedUserText, null)
})

test('parseAgentHttpResponse: JSON response falls back to meta header for missing fields', () => {
  const metaData = {
    actions: ['meta_action'],
    source: 'meta_source',
    notice: 'System maintenance',
    roleVariant: 'driver',
    contextSummary: 'Campus area',
    ticketDraft: { ready: true, category: 'other', subject: 'Lost item', body: 'Lost jacket in backseat' },
    redactedUserText: 'Contact support',
  }
  const meta = Buffer.from(JSON.stringify(metaData)).toString('base64')
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'application/json',
    metaHeader: meta,
    text: JSON.stringify({ reply: 'Understood.' }),
  })
  assert.equal(parsed.reply, 'Understood.')
  assert.deepEqual(parsed.actions, ['meta_action'])
  assert.equal(parsed.source, 'meta_source')
  assert.equal(parsed.notice, 'System maintenance')
  assert.equal(parsed.roleVariant, 'driver')
  assert.equal(parsed.contextSummary, 'Campus area')
  assert.deepEqual(parsed.ticketDraft, metaData.ticketDraft)
  assert.equal(parsed.redactedUserText, 'Contact support')
})

test('parseAgentHttpResponse: auto-detects JSON by leading curly brace even without json contentType', () => {
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'text/html',
    metaHeader: null,
    text: '   {"reply": "Detected via curly brace", "source": "heuristics"}   ',
  })
  assert.equal(parsed.reply, 'Detected via curly brace')
  assert.equal(parsed.source, 'heuristics')
})

test('parseAgentHttpResponse: malformed JSON with json contentType uses empty object fallback', () => {
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'application/json',
    metaHeader: null,
    text: '{malformed:json!!!',
  })
  assert.equal(parsed.reply, 'No reply.')
  assert.equal(parsed.source, 'offline')
  assert.deepEqual(parsed.actions, [])
})

test('parseAgentHttpResponse: uses data.error as reply in shapeJson if reply is absent', () => {
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'application/json',
    metaHeader: null,
    text: JSON.stringify({ error: 'LLM capacity temporarily exceeded' }),
  })
  assert.equal(parsed.reply, 'LLM capacity temporarily exceeded')
})

test('parseAgentHttpResponse: shapeJson does not validate ticketDraft.ready', () => {
  // BUG?: In shapeJson, ticketDraft does not validate draft.ready === true, while pickDraft (for text/plain) enforces draft.ready === true. An unready draft ({ ready: false }) is accepted in JSON but discarded in text/plain.
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'application/json',
    metaHeader: null,
    text: JSON.stringify({
      reply: 'Draft saved as unready',
      ticketDraft: { ready: false, category: 'bug' },
    }),
  })
  assert.deepEqual(parsed.ticketDraft, { ready: false, category: 'bug' })
})

test('parseAgentHttpResponse: streamed text happy path without ticket draft', () => {
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'text/plain',
    metaHeader: null,
    text: 'Here is your updated ride route.',
  })
  assert.equal(parsed.reply, 'Here is your updated ride route.')
  assert.equal(parsed.source, 'llm')
  assert.deepEqual(parsed.actions, [])
  assert.equal(parsed.notice, null)
  assert.equal(parsed.roleVariant, undefined)
  assert.equal(parsed.contextSummary, null)
  assert.equal(parsed.ticketDraft, null)
  assert.equal(parsed.redactedUserText, null)
})

test('parseAgentHttpResponse: streamed text with empty, null, or undefined text returns fallback reply', () => {
  const cases = ['', null, undefined]
  for (const textVal of cases) {
    const parsed = parseAgentHttpResponse({
      ok: true,
      status: 200,
      contentType: 'text/plain',
      metaHeader: null,
      text: textVal,
    })
    assert.equal(parsed.reply, 'I could not produce a reply. Try again.')
    assert.equal(parsed.ticketDraft, null)
  }
})

test('parseAgentHttpResponse: text/plain starting with curly brace is parsed as plain text, not JSON', () => {
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'text/plain',
    metaHeader: null,
    text: '{"some": "json-looking text"}',
  })
  assert.equal(parsed.reply, '{"some": "json-looking text"}')
  assert.equal(parsed.source, 'llm')
})

test('parseAgentHttpResponse: streamed text extracts valid ticket draft from body', () => {
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'text/plain',
    metaHeader: null,
    text: 'I will file a ticket for you.\nTICKET_DRAFT: {"ready": true, "category": "safety", "subject": "Speeding driver", "body": "Driver was exceeding speed limit significantly on I-85"}',
  })
  assert.equal(parsed.reply, 'I will file a ticket for you.')
  assert.equal(parsed.ticketDraft.ready, true)
  assert.equal(parsed.ticketDraft.category, 'safety')
  assert.equal(parsed.ticketDraft.subject, 'Speeding driver')
  assert.match(parsed.ticketDraft.body, /exceeding speed limit/)
})

test('parseAgentHttpResponse: pickDraft prefers ready meta ticketDraft over body ticketDraft', () => {
  const meta = Buffer.from(JSON.stringify({
    ticketDraft: { ready: true, category: 'account', subject: 'Meta ticket', body: 'Detailed meta body' },
  })).toString('base64')
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'text/plain',
    metaHeader: meta,
    text: 'Report noted.\nTICKET_DRAFT: {"ready": true, "category": "billing", "subject": "Body ticket", "body": "Detailed body text"}',
  })
  assert.equal(parsed.ticketDraft.category, 'account')
  assert.equal(parsed.ticketDraft.subject, 'Meta ticket')
})

test('parseAgentHttpResponse: pickDraft falls back to body draft when meta draft is not ready', () => {
  const meta = Buffer.from(JSON.stringify({
    ticketDraft: { ready: false, category: 'account', subject: 'Unready', body: 'Unready body' },
  })).toString('base64')
  const parsed = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'text/plain',
    metaHeader: meta,
    text: 'Report noted.\nTICKET_DRAFT: {"ready": true, "category": "billing", "subject": "Body ticket", "body": "Detailed body text"}',
  })
  assert.equal(parsed.ticketDraft.category, 'billing')
  assert.equal(parsed.ticketDraft.subject, 'Body ticket')
})

test('parseAgentHttpResponse: streamed text with invalid or incomplete ticket draft discards draft', () => {
  // Category not in TICKET_CATEGORIES
  const invalidCategory = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'text/plain',
    text: 'Visible\nTICKET_DRAFT: {"ready": true, "category": "unknown_cat", "subject": "Valid Subject", "body": "Valid body text"}',
  })
  assert.equal(invalidCategory.ticketDraft, null)

  // Subject too short (< 4 chars)
  const shortSubject = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'text/plain',
    text: 'Visible\nTICKET_DRAFT: {"ready": true, "category": "bug", "subject": "abc", "body": "Valid body text"}',
  })
  assert.equal(shortSubject.ticketDraft, null)

  // Body too short (< 8 chars)
  const shortBody = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'text/plain',
    text: 'Visible\nTICKET_DRAFT: {"ready": true, "category": "bug", "subject": "Valid subject", "body": "short"}',
  })
  assert.equal(shortBody.ticketDraft, null)

  // ready is not true
  const notReady = parseAgentHttpResponse({
    ok: true,
    status: 200,
    contentType: 'text/plain',
    text: 'Visible\nTICKET_DRAFT: {"ready": false, "category": "bug", "subject": "Valid subject", "body": "Valid body text"}',
  })
  assert.equal(notReady.ticketDraft, null)
})

test('parseAgentHttpResponse: meta header decoding handles null, empty, corrupt base64, and non-JSON gracefully', () => {
  // BUG?: decodeMeta uses atob(header) when available; atob treats input as Latin-1 binary string rather than UTF-8, which can garble multi-byte UTF-8 characters.
  const nullMeta = parseAgentHttpResponse({ ok: true, status: 200, contentType: 'text/plain', metaHeader: null, text: 'Hi' })
  assert.equal(nullMeta.actions.length, 0)

  const emptyMeta = parseAgentHttpResponse({ ok: true, status: 200, contentType: 'text/plain', metaHeader: '', text: 'Hi' })
  assert.equal(emptyMeta.actions.length, 0)

  const corruptB64 = parseAgentHttpResponse({ ok: true, status: 200, contentType: 'text/plain', metaHeader: '!!!not-valid-base64', text: 'Hi' })
  assert.equal(corruptB64.actions.length, 0)

  const nonJson = parseAgentHttpResponse({ ok: true, status: 200, contentType: 'text/plain', metaHeader: Buffer.from('{not json').toString('base64'), text: 'Hi' })
  assert.equal(nonJson.actions.length, 0)
})

test('parseAgentHttpResponse: non-ok response with JSON error throws Error with data.error and payload', () => {
  const errPayload = { error: 'Invalid prompt token', code: 'PROMPT_ERROR' }
  assert.throws(
    () => parseAgentHttpResponse({
      ok: false,
      status: 400,
      contentType: 'application/json',
      text: JSON.stringify(errPayload),
    }),
    (err) => {
      assert.equal(err.message, 'Invalid prompt token')
      assert.deepEqual(err.payload, errPayload)
      return true
    },
  )
})

test('parseAgentHttpResponse: non-ok response with JSON message throws Error with data.message and payload', () => {
  const msgPayload = { message: 'Quota exceeded for current hour' }
  assert.throws(
    () => parseAgentHttpResponse({
      ok: false,
      status: 429,
      contentType: 'application/json',
      text: JSON.stringify(msgPayload),
    }),
    (err) => {
      assert.equal(err.message, 'Quota exceeded for current hour')
      assert.deepEqual(err.payload, msgPayload)
      return true
    },
  )
})

test('parseAgentHttpResponse: non-ok response with non-JSON body throws Error with status fallback', () => {
  assert.throws(
    () => parseAgentHttpResponse({
      ok: false,
      status: 502,
      contentType: 'text/html',
      text: '<html>502 Bad Gateway</html>',
    }),
    (err) => {
      assert.equal(err.message, 'Request failed (502)')
      assert.deepEqual(err.payload, {})
      return true
    },
  )
})

test('parseAgentHttpResponse: non-ok response with JSON reply does not throw, returns shaped JSON', () => {
  const parsed = parseAgentHttpResponse({
    ok: false,
    status: 503,
    contentType: 'application/json',
    metaHeader: null,
    text: JSON.stringify({ reply: 'Assistant is overloaded, please wait.', source: 'offline' }),
  })
  assert.equal(parsed.reply, 'Assistant is overloaded, please wait.')
  assert.equal(parsed.source, 'offline')
})

test('parseAgentHttpResponse: non-ok response with text/plain contentType does not throw', () => {
  // BUG?: If !ok and contentType includes 'text/plain' (e.g. 500 error with text/plain body), parseAgentHttpResponse does not throw an error; it falls through and returns { reply: errorText, source: 'llm', ... } as a successful response.
  const parsed = parseAgentHttpResponse({
    ok: false,
    status: 500,
    contentType: 'text/plain',
    metaHeader: null,
    text: 'Internal Server Error Occurred',
  })
  assert.equal(parsed.reply, 'Internal Server Error Occurred')
  assert.equal(parsed.source, 'llm')
})

test('parseAgentHttpResponse: empty input object {} throws Request failed (undefined)', () => {
  // BUG?: If !ok and status is undefined (e.g., empty input {}), error message is 'Request failed (undefined)'.
  assert.throws(
    () => parseAgentHttpResponse({}),
    (err) => {
      assert.equal(err.message, 'Request failed (undefined)')
      assert.deepEqual(err.payload, {})
      return true
    },
  )
})

test('parseAgentHttpResponse: calling without argument throws TypeError', () => {
  assert.throws(() => parseAgentHttpResponse(), TypeError)
})

// ---------------------------------------------------------------------------
// postAgent tests
// ---------------------------------------------------------------------------

test('postAgent: happy path POST with JSON response forwards request options and returns parsed data', async () => {
  let capturedUrl = null
  let capturedOptions = null

  await withFakeFetch(async (url, options) => {
    capturedUrl = url
    capturedOptions = options
    return fakeResponse({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { reply: 'Welcome to Clemson Rides!', source: 'llm' },
    })
  }, async () => {
    const res = await postAgent({
      url: 'https://api.clemsonrides.com/agent',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: { prompt: 'Where is terminal 1?' },
    })
    assert.equal(capturedUrl, 'https://api.clemsonrides.com/agent')
    assert.equal(capturedOptions.method, 'POST')
    assert.equal(capturedOptions.headers.Authorization, 'Bearer test-token')
    assert.equal(capturedOptions.body, JSON.stringify({ prompt: 'Where is terminal 1?' }))
    assert.equal(res.reply, 'Welcome to Clemson Rides!')
    assert.equal(res.source, 'llm')
  })
})

test('postAgent: happy path POST with streamed text/plain and X-Agent-Meta', async () => {
  const meta = Buffer.from(JSON.stringify({
    source: 'llm',
    notice: 'Driver en route',
    actions: ['track_ride'],
  })).toString('base64')

  await withFakeFetch(async () => {
    return fakeResponse({
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'X-Agent-Meta': meta,
      },
      body: 'Your driver is 2 minutes away.',
    })
  }, async () => {
    const res = await postAgent({
      url: '/api/agent',
      headers: {},
      body: { message: 'status' },
    })
    assert.equal(res.reply, 'Your driver is 2 minutes away.')
    assert.equal(res.notice, 'Driver en route')
    assert.deepEqual(res.actions, ['track_ride'])
  })
})

test('postAgent: headers omitted does not provide default Content-Type', async () => {
  // BUG?: postAgent stringifies body with JSON.stringify(body) but does not provide a default 'Content-Type': 'application/json' header if omitted by caller.
  let capturedOptions = null
  await withFakeFetch(async (url, options) => {
    capturedOptions = options
    return fakeResponse({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { reply: 'ok' },
    })
  }, async () => {
    await postAgent({ url: '/api/agent', body: { test: true } })
    assert.equal(capturedOptions.headers, undefined)
  })
})

test('postAgent: empty and null body inputs', async () => {
  let capturedBodies = []
  await withFakeFetch(async (url, options) => {
    capturedBodies.push(options.body)
    return fakeResponse({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { reply: 'ok' },
    })
  }, async () => {
    await postAgent({ url: '/api/agent', body: undefined })
    await postAgent({ url: '/api/agent', body: null })
  })
  // JSON.stringify(undefined) -> undefined
  assert.equal(capturedBodies[0], undefined)
  // JSON.stringify(null) -> 'null'
  assert.equal(capturedBodies[1], 'null')
})

test('postAgent: server HTTP error rejects with formatted error', async () => {
  await withFakeFetch(async () => {
    return fakeResponse({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: { error: 'Prompt exceeds maximum length' },
    })
  }, async () => {
    await assert.rejects(
      () => postAgent({ url: '/api/agent', body: { prompt: 'too long' } }),
      (err) => {
        assert.equal(err.message, 'Prompt exceeds maximum length')
        assert.deepEqual(err.payload, { error: 'Prompt exceeds maximum length' })
        return true
      },
    )
  })
})

test('postAgent: network rejection propagates error', async () => {
  await withFakeFetch(async () => {
    throw new Error('Network connection aborted')
  }, async () => {
    await assert.rejects(
      () => postAgent({ url: '/api/agent', body: {} }),
      { message: 'Network connection aborted' },
    )
  })
})

// ---------------------------------------------------------------------------
// supportTicketRequest tests
// ---------------------------------------------------------------------------

test('supportTicketRequest: happy path GET request without body', async () => {
  let capturedUrl = null
  let capturedOptions = null

  await withFakeFetch(async (url, options) => {
    capturedUrl = url
    capturedOptions = options
    return fakeResponse({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { tickets: [{ id: 'tk_123', status: 'open' }] },
    })
  }, async () => {
    const data = await supportTicketRequest({
      url: 'https://api.clemsonrides.com/tickets?status=open',
      headers: { Authorization: 'Bearer test' },
    })
    assert.equal(capturedUrl, 'https://api.clemsonrides.com/tickets?status=open')
    assert.equal(capturedOptions.method, 'GET')
    assert.equal(capturedOptions.headers.Authorization, 'Bearer test')
    assert.equal(capturedOptions.body, undefined)
    assert.deepEqual(data, { tickets: [{ id: 'tk_123', status: 'open' }] })
  })
})

test('supportTicketRequest: happy path POST request with body', async () => {
  let capturedOptions = null

  await withFakeFetch(async (url, options) => {
    capturedOptions = options
    return fakeResponse({
      status: 201,
      headers: { 'content-type': 'application/json' },
      body: { ok: true, ticketId: 'tk_new' },
    })
  }, async () => {
    const data = await supportTicketRequest({
      url: '/api/tickets',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { category: 'billing', subject: 'Incorrect fare' },
    })
    assert.equal(capturedOptions.method, 'POST')
    assert.equal(capturedOptions.body, JSON.stringify({ category: 'billing', subject: 'Incorrect fare' }))
    assert.deepEqual(data, { ok: true, ticketId: 'tk_new' })
  })
})

test('supportTicketRequest: supports other HTTP methods like DELETE and PATCH', async () => {
  let capturedMethods = []

  await withFakeFetch(async (url, options) => {
    capturedMethods.push(options.method)
    return fakeResponse({ status: 200, body: { success: true } })
  }, async () => {
    await supportTicketRequest({ url: '/api/tickets/1', method: 'DELETE' })
    await supportTicketRequest({ url: '/api/tickets/1', method: 'PATCH', body: { status: 'closed' } })
    assert.deepEqual(capturedMethods, ['DELETE', 'PATCH'])
  })
})

test('supportTicketRequest: 204 No Content or unparseable JSON returns empty object on success', async () => {
  await withFakeFetch(async () => {
    return {
      ok: true,
      status: 204,
      headers: new Headers(),
      async json() {
        throw new SyntaxError('Unexpected end of JSON input')
      },
    }
  }, async () => {
    const data = await supportTicketRequest({ url: '/api/tickets/204' })
    assert.deepEqual(data, {})
  })
})

test('supportTicketRequest: falsy body values result in undefined body passed to fetch', async () => {
  // BUG?: In supportTicketRequest, passing a falsy body value like 0, false, or '' results in undefined body rather than stringified '0', 'false', '""'.
  const falsyValues = [0, false, '', null, undefined]
  for (const val of falsyValues) {
    let capturedBody = 'not-called'
    await withFakeFetch(async (url, options) => {
      capturedBody = options.body
      return fakeResponse({ status: 200, body: {} })
    }, async () => {
      await supportTicketRequest({ url: '/api/test', body: val })
      assert.equal(capturedBody, undefined)
    })
  }
})

test('supportTicketRequest: empty options object defaults to GET and undefined parameters', async () => {
  let capturedOptions = null
  let capturedUrl = null

  await withFakeFetch(async (url, options) => {
    capturedUrl = url
    capturedOptions = options
    return fakeResponse({ status: 200, body: { ok: true } })
  }, async () => {
    const res = await supportTicketRequest({})
    assert.equal(capturedUrl, undefined)
    assert.equal(capturedOptions.method, 'GET')
    assert.equal(capturedOptions.headers, undefined)
    assert.equal(capturedOptions.body, undefined)
    assert.deepEqual(res, { ok: true })
  })
})

test('supportTicketRequest: error response with data.error throws with payload', async () => {
  await withFakeFetch(async () => {
    return fakeResponse({
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: { error: 'Support ticket not found', code: 404 },
    })
  }, async () => {
    await assert.rejects(
      () => supportTicketRequest({ url: '/api/tickets/missing' }),
      (err) => {
        assert.equal(err.message, 'Support ticket not found')
        assert.deepEqual(err.payload, { error: 'Support ticket not found', code: 404 })
        return true
      },
    )
  })
})

test('supportTicketRequest: error response without data.error throws status code fallback', async () => {
  await withFakeFetch(async () => {
    return {
      ok: false,
      status: 500,
      headers: new Headers(),
      async json() {
        throw new SyntaxError('HTML error response')
      },
    }
  }, async () => {
    await assert.rejects(
      () => supportTicketRequest({ url: '/api/tickets/error' }),
      (err) => {
        assert.equal(err.message, 'Request failed (500)')
        assert.deepEqual(err.payload, {})
        return true
      },
    )
  })
})

test('supportTicketRequest: error response with data.message ignores message and uses status fallback', async () => {
  // BUG?: supportTicketRequest checks only data.error when !res.ok, ignoring data.message (unlike parseAgentHttpResponse which checks data.error || data.message).
  await withFakeFetch(async () => {
    return fakeResponse({
      status: 401,
      headers: { 'content-type': 'application/json' },
      body: { message: 'Token has expired' },
    })
  }, async () => {
    await assert.rejects(
      () => supportTicketRequest({ url: '/api/tickets/unauthorized' }),
      (err) => {
        assert.equal(err.message, 'Request failed (401)')
        assert.deepEqual(err.payload, { message: 'Token has expired' })
        return true
      },
    )
  })
})

test('supportTicketRequest: network failure propagates rejection', async () => {
  await withFakeFetch(async () => {
    throw new Error('Connection refused')
  }, async () => {
    await assert.rejects(
      () => supportTicketRequest({ url: '/api/tickets' }),
      { message: 'Connection refused' },
    )
  })
})

