import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalQuickReply,
  fetchTripChat,
  listTripMessages,
  markTripMessagesRead,
  messageLimitForMode,
  messageLimitForTrip,
  normalizeMessageBody,
  rideChatBanner,
  rideChatMode,
  RIDE_CHAT_QUICK_REPLIES,
  sendTripMessage,
  sendTripQuickReply,
  subscribeTripChatStatus,
  subscribeTripMessages,
} from './tripMessagesClient.js'
import * as tripChatRules from '../../src/lib/tripChatRules.js'

/**
 * Creates an in-memory fake Supabase client that records calls and supports
 * chaining for tripMessagesClient queries.
 */
function createFakeSupabase(options = {}) {
  const operations = []
  const channels = []
  const removedChannels = []

  const queryBuilder = {
    _table: null,
    select(cols) {
      operations.push({ type: 'select', table: this._table, cols })
      return this
    },
    eq(col, val) {
      operations.push({ type: 'eq', table: this._table, col, val })
      return this
    },
    in(col, vals) {
      operations.push({ type: 'in', table: this._table, col, vals })
      return this
    },
    is(col, val) {
      operations.push({ type: 'is', table: this._table, col, val })
      return this
    },
    order(col, opts) {
      operations.push({ type: 'order', table: this._table, col, opts })
      return this
    },
    limit(limit) {
      operations.push({ type: 'limit', table: this._table, limit })
      return this
    },
    insert(payload) {
      operations.push({ type: 'insert', table: this._table, payload })
      return this
    },
    update(payload) {
      operations.push({ type: 'update', table: this._table, payload })
      return this
    },
    async maybeSingle() {
      operations.push({ type: 'maybeSingle', table: this._table })
      if (options.queryError) {
        return { data: null, error: options.queryError }
      }
      return {
        data: options.maybeSingleData !== undefined ? options.maybeSingleData : (options.data ?? null),
        error: null,
      }
    },
    async single() {
      operations.push({ type: 'single', table: this._table })
      if (options.queryError) {
        return { data: null, error: options.queryError }
      }
      return {
        data: options.singleData !== undefined ? options.singleData : (options.data ?? null),
        error: null,
      }
    },
    then(resolve, reject) {
      operations.push({ type: 'exec', table: this._table })
      if (options.queryError) {
        return Promise.resolve({ data: null, error: options.queryError }).then(resolve, reject)
      }
      return Promise.resolve({
        data: options.data !== undefined ? options.data : null,
        error: null,
      }).then(resolve, reject)
    },
  }

  const fakeChannel = (channelName) => {
    let onHandler = null
    const ch = {
      name: channelName,
      subscribed: false,
      event: null,
      filter: null,
      callback: null,
      on(event, filter, callback) {
        ch.event = event
        ch.filter = filter
        ch.callback = callback
        onHandler = callback
        return ch
      },
      subscribe() {
        ch.subscribed = true
        return ch
      },
      _trigger(payload) {
        return onHandler?.(payload)
      },
    }
    channels.push(ch)
    return ch
  }

  return {
    operations,
    channels,
    removedChannels,
    auth: {
      async getUser() {
        operations.push({ type: 'auth.getUser' })
        if (options.authError) {
          return { data: null, error: options.authError }
        }
        if (options.authData !== undefined) {
          return { data: options.authData, error: null }
        }
        return {
          data: options.authUser !== undefined ? { user: options.authUser } : { user: { id: 'test-user-id' } },
          error: null,
        }
      },
    },
    from(table) {
      operations.push({ type: 'from', table })
      const b = Object.create(queryBuilder)
      b._table = table
      return b
    },
    channel(name) {
      return fakeChannel(name)
    },
    removeChannel(ch) {
      removedChannels.push(ch)
    },
  }
}

// ---------------------------------------------------------------------------
// Re-exports from tripChatRules.js smoke test
// ---------------------------------------------------------------------------

test('tripMessagesClient re-exports tripChatRules helpers and constants', () => {
  assert.equal(canonicalQuickReply, tripChatRules.canonicalQuickReply)
  assert.equal(messageLimitForMode, tripChatRules.messageLimitForMode)
  assert.equal(normalizeMessageBody, tripChatRules.normalizeMessageBody)
  assert.equal(rideChatMode, tripChatRules.rideChatMode)
  assert.equal(rideChatBanner, tripChatRules.rideChatBanner)
  assert.equal(RIDE_CHAT_QUICK_REPLIES, tripChatRules.RIDE_CHAT_QUICK_REPLIES)
})

// ---------------------------------------------------------------------------
// requireClient throws when supabase missing
// ---------------------------------------------------------------------------

test('requireClient throws "Supabase is not configured" when client is missing', async () => {
  for (const emptyClient of [null, undefined, false, 0, '']) {
    await assert.rejects(
      () => fetchTripChat(emptyClient, 'trip-123'),
      /Supabase is not configured/,
    )
    await assert.rejects(
      () => listTripMessages(emptyClient, 'trip-123', 50),
      /Supabase is not configured/,
    )
    await assert.rejects(
      () => sendTripMessage(emptyClient, { tripId: 'trip-123', body: 'hello' }),
      /Supabase is not configured/,
    )
    await assert.rejects(
      () => sendTripQuickReply(emptyClient, { tripId: 'trip-123', phrase: "I'm on the way" }),
      /Supabase is not configured/,
    )
  }

  // BUG?: markTripMessagesRead does not throw when supabase is missing; it silently returns []
  assert.deepEqual(await markTripMessagesRead(null, ['msg-1']), [])
  assert.deepEqual(await markTripMessagesRead(undefined, ['msg-1']), [])

  // BUG?: subscribeTripMessages silently returns a no-op unsubscribe when supabase is missing
  const unsubMsg = subscribeTripMessages(null, 'trip-123', () => {})
  assert.equal(typeof unsubMsg, 'function')
  assert.doesNotThrow(() => unsubMsg())

  // BUG?: subscribeTripChatStatus silently returns a no-op unsubscribe when supabase is missing
  const unsubStatus = subscribeTripChatStatus(null, 'trip-123', () => {})
  assert.equal(typeof unsubStatus, 'function')
  assert.doesNotThrow(() => unsubStatus())
})

// ---------------------------------------------------------------------------
// fetchTripChat
// ---------------------------------------------------------------------------

test('fetchTripChat queries trips with TRIP_COLS and id filter', async () => {
  const fakeTrip = {
    id: 'trip-abc',
    status: 'accepted',
    rider_id: 'rider-1',
    driver_id: 'driver-2',
    completed_at: null,
    canceled_at: null,
  }
  const fake = createFakeSupabase({ maybeSingleData: fakeTrip })

  const result = await fetchTripChat(fake, 'trip-abc')
  assert.deepEqual(result, fakeTrip)

  const fromOp = fake.operations.find((op) => op.type === 'from')
  const selectOp = fake.operations.find((op) => op.type === 'select')
  const eqOp = fake.operations.find((op) => op.type === 'eq')
  const maybeSingleOp = fake.operations.find((op) => op.type === 'maybeSingle')

  assert.equal(fromOp.table, 'trips')
  assert.equal(selectOp.cols, 'id, status, rider_id, driver_id, completed_at, canceled_at')
  assert.deepEqual(eqOp, { type: 'eq', table: 'trips', col: 'id', val: 'trip-abc' })
  assert.ok(maybeSingleOp)
})

test('fetchTripChat returns null when trip is not found', async () => {
  const fake = createFakeSupabase({ maybeSingleData: null })
  const result = await fetchTripChat(fake, 'trip-nonexistent')
  assert.equal(result, null)
})

test('fetchTripChat throws database errors', async () => {
  const fake = createFakeSupabase({ queryError: { message: 'Database query timeout' } })
  await assert.rejects(
    () => fetchTripChat(fake, 'trip-err'),
    /Database query timeout/,
  )
})

// ---------------------------------------------------------------------------
// listTripMessages (order reverse after descending select)
// ---------------------------------------------------------------------------

test('listTripMessages selects descending by created_at then reverses to chronological order', async () => {
  const m1 = { id: 'm1', trip_id: 't-1', body: 'First', created_at: '2026-09-24T12:00:00.000Z' }
  const m2 = { id: 'm2', trip_id: 't-1', body: 'Second', created_at: '2026-09-24T12:01:00.000Z' }
  const m3 = { id: 'm3', trip_id: 't-1', body: 'Third', created_at: '2026-09-24T12:02:00.000Z' }

  // Database returns descending order (newest first: m3, m2, m1)
  const dbRows = [m3, m2, m1]
  const fake = createFakeSupabase({ data: dbRows })

  const list = await listTripMessages(fake, 't-1', 50)

  // Verify reverse to ascending order (oldest first: m1, m2, m3)
  assert.deepEqual(list, [m1, m2, m3])

  // Verify original dbRows array was not mutated by .slice().reverse()
  assert.equal(dbRows[0].id, 'm3')
  assert.equal(dbRows[1].id, 'm2')
  assert.equal(dbRows[2].id, 'm1')

  const fromOp = fake.operations.find((op) => op.type === 'from')
  const selectOp = fake.operations.find((op) => op.type === 'select')
  const eqOp = fake.operations.find((op) => op.type === 'eq')
  const orderOp = fake.operations.find((op) => op.type === 'order')
  const limitOp = fake.operations.find((op) => op.type === 'limit')

  assert.equal(fromOp.table, 'trip_messages')
  assert.equal(selectOp.cols, 'id, trip_id, sender_id, body, created_at, read_at')
  assert.deepEqual(eqOp, { type: 'eq', table: 'trip_messages', col: 'trip_id', val: 't-1' })
  assert.deepEqual(orderOp, {
    type: 'order',
    table: 'trip_messages',
    col: 'created_at',
    opts: { ascending: false },
  })
  assert.equal(limitOp.limit, 50)
})

test('listTripMessages returns empty array when data is null or empty', async () => {
  const fakeNull = createFakeSupabase({ data: null })
  assert.deepEqual(await listTripMessages(fakeNull, 't-1', 10), [])

  const fakeEmpty = createFakeSupabase({ data: [] })
  assert.deepEqual(await listTripMessages(fakeEmpty, 't-1', 10), [])
})

test('listTripMessages throws query errors', async () => {
  const fake = createFakeSupabase({ queryError: { message: 'Row level security violation' } })
  await assert.rejects(
    () => listTripMessages(fake, 't-1', 20),
    /Row level security violation/,
  )
})

test('listTripMessages passes undefined limit through to query builder', async () => {
  // BUG?: listTripMessages passes undefined limit through to query builder
  const fake = createFakeSupabase({ data: [] })
  await listTripMessages(fake, 't-1', undefined)
  const limitOp = fake.operations.find((op) => op.type === 'limit')
  assert.equal(limitOp.limit, undefined)
})

// ---------------------------------------------------------------------------
// sendTripMessage: normalizeMessageBody, auth missing, insert payload
// ---------------------------------------------------------------------------

test('sendTripMessage validates message body with normalizeMessageBody before auth check', async () => {
  const fake = createFakeSupabase()

  // Empty string, spaces, null, undefined reject with 'Message is empty'
  for (const emptyBody of ['', '   ', '  \t\n  ', null, undefined]) {
    await assert.rejects(
      () => sendTripMessage(fake, { tripId: 't-1', body: emptyBody }),
      /Message is empty/,
    )
  }

  // Oversized text (>500 chars) rejects with 'Message is too long'
  const oversized = 'x'.repeat(501)
  await assert.rejects(
    () => sendTripMessage(fake, { tripId: 't-1', body: oversized }),
    /Message is too long/,
  )

  // Verify auth.getUser was never reached when body validation failed
  const authCalls = fake.operations.filter((op) => op.type === 'auth.getUser')
  assert.equal(authCalls.length, 0)
})

test('sendTripMessage throws "Sign in to message" when auth user is missing', async () => {
  // authData is null
  const fakeNullData = createFakeSupabase({ authData: null })
  await assert.rejects(
    () => sendTripMessage(fakeNullData, { tripId: 't-1', body: 'hello' }),
    /Sign in to message/,
  )

  // authData has user: null
  const fakeNullUser = createFakeSupabase({ authUser: null })
  await assert.rejects(
    () => sendTripMessage(fakeNullUser, { tripId: 't-1', body: 'hello' }),
    /Sign in to message/,
  )

  // authData user exists but has empty id
  const fakeNoId = createFakeSupabase({ authUser: { id: null } })
  await assert.rejects(
    () => sendTripMessage(fakeNoId, { tripId: 't-1', body: 'hello' }),
    /Sign in to message/,
  )

  // Verify no insert was attempted when auth is missing
  const insertCalls = fakeNullUser.operations.filter((op) => op.type === 'insert')
  assert.equal(insertCalls.length, 0)
})

test('sendTripMessage throws when auth.getUser returns an error', async () => {
  const fake = createFakeSupabase({ authError: { message: 'Invalid JWT signature' } })
  await assert.rejects(
    () => sendTripMessage(fake, { tripId: 't-1', body: 'hello' }),
    /Invalid JWT signature/,
  )
})

test('sendTripMessage trims body, normalizes crlf, and inserts message row', async () => {
  const fakeInserted = {
    id: 'msg-99',
    trip_id: 'trip-100',
    sender_id: 'usr-42',
    body: 'Line 1\nLine 2',
    created_at: '2026-09-24T12:00:00.000Z',
    read_at: null,
  }
  const fake = createFakeSupabase({
    authUser: { id: 'usr-42' },
    singleData: fakeInserted,
  })

  const res = await sendTripMessage(fake, {
    tripId: 'trip-100',
    body: '  Line 1\r\nLine 2  ',
  })

  assert.deepEqual(res, fakeInserted)

  const insertOp = fake.operations.find((op) => op.type === 'insert')
  assert.deepEqual(insertOp, {
    type: 'insert',
    table: 'trip_messages',
    payload: {
      trip_id: 'trip-100',
      sender_id: 'usr-42',
      body: 'Line 1\nLine 2',
    },
  })

  const selectOp = fake.operations.find((op) => op.type === 'select')
  assert.equal(selectOp.cols, 'id, trip_id, sender_id, body, created_at, read_at')

  const singleOp = fake.operations.find((op) => op.type === 'single')
  assert.ok(singleOp)
})

test('sendTripMessage throws database errors on insert failure', async () => {
  const fake = createFakeSupabase({
    authUser: { id: 'usr-42' },
    queryError: { message: 'insert into trip_messages failed' },
  })

  await assert.rejects(
    () => sendTripMessage(fake, { tripId: 'trip-1', body: 'hello' }),
    /insert into trip_messages failed/,
  )
})

test('sendTripMessage suspicious behaviours: no trip status check and unvalidated tripId', async () => {
  // BUG?: sendTripMessage does not verify whether the trip is active/open or check rideChatMode before inserting
  const fake = createFakeSupabase({
    authUser: { id: 'usr-42' },
    singleData: { id: 'msg-1', trip_id: 'closed-trip', body: 'hi' },
  })
  const msg = await sendTripMessage(fake, { tripId: 'closed-trip', body: 'hi' })
  assert.equal(msg.trip_id, 'closed-trip')
  // Verify that trips table was never queried to check rideChatMode
  assert.equal(fake.operations.some((op) => op.table === 'trips'), false)

  // BUG?: sendTripMessage does not validate that tripId is provided
  const fakeNoTripId = createFakeSupabase({
    authUser: { id: 'usr-42' },
    singleData: { id: 'msg-2', trip_id: undefined, body: 'hi' },
  })
  await sendTripMessage(fakeNoTripId, { tripId: undefined, body: 'hi' })
  const insertOp = fakeNoTripId.operations.find((op) => op.type === 'insert')
  assert.equal(insertOp.payload.trip_id, undefined)
})

// ---------------------------------------------------------------------------
// sendTripQuickReply
// ---------------------------------------------------------------------------

test('sendTripQuickReply throws "Unknown quick reply" for unrecognized phrases', async () => {
  const fake = createFakeSupabase({ authUser: { id: 'usr-1' } })

  const unknownPhrases = [
    'hello',
    'Where are you?',
    '',
    '   ',
    null,
    undefined,
    123,
    "i'm on the way", // lowercase
    "I'm on the way ", // trailing space
    'Just got your request!', // extra punctuation
  ]

  for (const phrase of unknownPhrases) {
    await assert.rejects(
      () => sendTripQuickReply(fake, { tripId: 't-1', phrase }),
      /Unknown quick reply/,
    )
  }

  // BUG?: sendTripQuickReply validates phrase before checking supabase client
  await assert.rejects(
    () => sendTripQuickReply(null, { tripId: 't-1', phrase: 'unknown phrase' }),
    /Unknown quick reply/,
  )
})

test('sendTripQuickReply delegates known quick replies to sendTripMessage', async () => {
  for (const phrase of RIDE_CHAT_QUICK_REPLIES) {
    const fakeInserted = {
      id: 'qr-1',
      trip_id: 'trip-qr',
      sender_id: 'usr-1',
      body: phrase,
      created_at: '2026-09-24T12:00:00.000Z',
    }
    const fake = createFakeSupabase({
      authUser: { id: 'usr-1' },
      singleData: fakeInserted,
    })

    const res = await sendTripQuickReply(fake, { tripId: 'trip-qr', phrase })
    assert.deepEqual(res, fakeInserted)

    const insertOp = fake.operations.find((op) => op.type === 'insert')
    assert.equal(insertOp.payload.body, phrase)
    assert.equal(insertOp.payload.trip_id, 'trip-qr')
    assert.equal(insertOp.payload.sender_id, 'usr-1')
  }
})

// ---------------------------------------------------------------------------
// markTripMessagesRead: empty ids, only unread rows updated
// ---------------------------------------------------------------------------

test('markTripMessagesRead returns empty array without querying when ids is empty or null', async () => {
  const fake = createFakeSupabase()

  for (const emptyIds of [[], null, undefined]) {
    const res = await markTripMessagesRead(fake, emptyIds)
    assert.deepEqual(res, [])
    assert.equal(fake.operations.length, 0)
  }
})

test('markTripMessagesRead updates only unread rows (read_at is null) and returns id, read_at', async () => {
  const updatedRows = [
    { id: 'm1', read_at: '2026-09-24T12:30:00.000Z' },
    { id: 'm2', read_at: '2026-09-24T12:30:00.000Z' },
  ]
  const fake = createFakeSupabase({ data: updatedRows })

  const res = await markTripMessagesRead(fake, ['m1', 'm2', 'm3'])
  assert.deepEqual(res, updatedRows)

  const fromOp = fake.operations.find((op) => op.type === 'from')
  const updateOp = fake.operations.find((op) => op.type === 'update')
  const inOp = fake.operations.find((op) => op.type === 'in')
  const isOp = fake.operations.find((op) => op.type === 'is')
  const selectOp = fake.operations.find((op) => op.type === 'select')

  assert.equal(fromOp.table, 'trip_messages')
  assert.ok(typeof updateOp.payload.read_at === 'string')
  // read_at is a valid ISO 8601 timestamp
  assert.ok(!Number.isNaN(Date.parse(updateOp.payload.read_at)))

  assert.deepEqual(inOp, {
    type: 'in',
    table: 'trip_messages',
    col: 'id',
    vals: ['m1', 'm2', 'm3'],
  })

  // Critical: only unread rows where read_at is null are updated
  assert.deepEqual(isOp, {
    type: 'is',
    table: 'trip_messages',
    col: 'read_at',
    val: null,
  })

  assert.equal(selectOp.cols, 'id, read_at')
})

test('markTripMessagesRead returns empty array when query data is null', async () => {
  const fake = createFakeSupabase({ data: null })
  const res = await markTripMessagesRead(fake, ['m1'])
  assert.deepEqual(res, [])
})

test('markTripMessagesRead throws database errors', async () => {
  const fake = createFakeSupabase({ queryError: { message: 'Failed to update read status' } })
  await assert.rejects(
    () => markTripMessagesRead(fake, ['m1']),
    /Failed to update read status/,
  )
})

// ---------------------------------------------------------------------------
// subscribeTripMessages / subscribeTripChatStatus
// ---------------------------------------------------------------------------

test('subscribeTripMessages wires channel correctly and returns functional unsubscribe', () => {
  const fake = createFakeSupabase()
  const events = []
  const onChange = (payload) => events.push(payload)

  const unsubscribe = subscribeTripMessages(fake, 'trip-777', onChange)
  assert.equal(typeof unsubscribe, 'function')

  assert.equal(fake.channels.length, 1)
  const ch = fake.channels[0]
  assert.equal(ch.name, 'trip-messages-trip-777')
  assert.equal(ch.subscribed, true)
  assert.equal(ch.event, 'postgres_changes')
  assert.deepEqual(ch.filter, {
    event: '*',
    schema: 'public',
    table: 'trip_messages',
    filter: 'trip_id=eq.trip-777',
  })

  // Triggering the channel fires onChange
  const testPayload = { eventType: 'INSERT', new: { id: 'm-9', body: 'New message' } }
  ch._trigger(testPayload)
  assert.deepEqual(events, [testPayload])

  // Calling unsubscribe removes the channel from supabase
  unsubscribe()
  assert.deepEqual(fake.removedChannels, [ch])
})

test('subscribeTripMessages returns safe no-op when supabase or tripId is missing', () => {
  const fake = createFakeSupabase()

  // Missing supabase
  const unsub1 = subscribeTripMessages(null, 'trip-1', () => {})
  assert.equal(typeof unsub1, 'function')
  assert.doesNotThrow(() => unsub1())

  // Missing tripId
  for (const emptyTripId of [null, undefined, '']) {
    const unsub = subscribeTripMessages(fake, emptyTripId, () => {})
    assert.equal(typeof unsub, 'function')
    assert.doesNotThrow(() => unsub())
    assert.equal(fake.channels.length, 0)
  }

  // Gracefully handles null onChange
  const unsubNoCb = subscribeTripMessages(fake, 'trip-2', null)
  assert.equal(typeof unsubNoCb, 'function')
  const ch = fake.channels[0]
  assert.doesNotThrow(() => ch._trigger({ eventType: 'INSERT' }))
})

test('subscribeTripChatStatus wires channel correctly and extracts payload.new', () => {
  const fake = createFakeSupabase()
  const updates = []
  const onChange = (status) => updates.push(status)

  const unsubscribe = subscribeTripChatStatus(fake, 'trip-888', onChange)
  assert.equal(typeof unsubscribe, 'function')

  assert.equal(fake.channels.length, 1)
  const ch = fake.channels[0]
  assert.equal(ch.name, 'trip-chat-status-trip-888')
  assert.equal(ch.subscribed, true)
  assert.equal(ch.event, 'postgres_changes')
  assert.deepEqual(ch.filter, {
    event: 'UPDATE',
    schema: 'public',
    table: 'trips',
    filter: 'id=eq.trip-888',
  })

  // Triggering with payload containing new
  ch._trigger({ new: { id: 'trip-888', status: 'arriving' } })
  assert.deepEqual(updates, [{ id: 'trip-888', status: 'arriving' }])

  // BUG?: subscribeTripChatStatus passes null to onChange when payload.new is falsy
  ch._trigger({ new: null })
  ch._trigger({})
  ch._trigger(null)
  assert.deepEqual(updates, [
    { id: 'trip-888', status: 'arriving' },
    null,
    null,
    null,
  ])

  // Unsubscribe removes channel
  unsubscribe()
  assert.deepEqual(fake.removedChannels, [ch])
})

test('subscribeTripChatStatus returns safe no-op when supabase or tripId is missing', () => {
  const fake = createFakeSupabase()

  const unsub1 = subscribeTripChatStatus(null, 'trip-1', () => {})
  assert.equal(typeof unsub1, 'function')
  assert.doesNotThrow(() => unsub1())

  for (const emptyTripId of [null, undefined, '']) {
    const unsub = subscribeTripChatStatus(fake, emptyTripId, () => {})
    assert.equal(typeof unsub, 'function')
    assert.doesNotThrow(() => unsub())
    assert.equal(fake.channels.length, 0)
  }

  // Gracefully handles null onChange
  const unsubNoCb = subscribeTripChatStatus(fake, 'trip-3', null)
  assert.equal(typeof unsubNoCb, 'function')
  const ch = fake.channels[0]
  assert.doesNotThrow(() => ch._trigger({ new: { status: 'completed' } }))
})

// ---------------------------------------------------------------------------
// messageLimitForTrip delegates to messageLimitForMode with trip status/timestamps
// ---------------------------------------------------------------------------

test('messageLimitForTrip delegates to messageLimitForMode with trip status and timestamps', () => {
  const now = Date.parse('2026-09-24T12:00:00.000Z')
  const HOUR = 60 * 60 * 1000

  // Active trips get active limit (200)
  assert.equal(messageLimitForTrip({ status: 'accepted' }, now), 200)
  assert.equal(messageLimitForTrip({ status: 'arriving' }, now), 200)
  assert.equal(messageLimitForTrip({ status: 'in_progress' }, now), 200)

  // Completed / canceled within 24h get post-ride limit (40)
  assert.equal(
    messageLimitForTrip({ status: 'completed', completed_at: new Date(now - HOUR).toISOString() }, now),
    40,
  )
  assert.equal(
    messageLimitForTrip({ status: 'canceled', canceled_at: new Date(now - 23 * HOUR).toISOString() }, now),
    40,
  )
  assert.equal(
    messageLimitForTrip({ status: 'completed', completed_at: new Date(now - 24 * HOUR).toISOString() }, now),
    40,
  )

  // Ended trips after 24h are closed (0)
  assert.equal(
    messageLimitForTrip({ status: 'completed', completed_at: new Date(now - 24 * HOUR - 1).toISOString() }, now),
    0,
  )
  assert.equal(
    messageLimitForTrip({ status: 'canceled', canceled_at: new Date(now - 25 * HOUR).toISOString() }, now),
    0,
  )

  // Fallback to readonly (40) when completed/canceled but timestamp is missing or unparseable
  assert.equal(messageLimitForTrip({ status: 'completed' }, now), 40)
  assert.equal(messageLimitForTrip({ status: 'canceled' }, now), 40)
  assert.equal(messageLimitForTrip({ status: 'completed', completed_at: 'not-a-date' }, now), 40)

  // Closed statuses get 0
  assert.equal(messageLimitForTrip({ status: 'searching' }, now), 0)
  assert.equal(messageLimitForTrip({ status: 'offered' }, now), 0)
  assert.equal(messageLimitForTrip(null, now), 0)
  assert.equal(messageLimitForTrip(undefined, now), 0)
  assert.equal(messageLimitForTrip({}, now), 0)
})
