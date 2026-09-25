import assert from 'node:assert/strict'
import test from 'node:test'
import {
  closeLostFoundReport,
  confirmFound,
  confirmNotFound,
  createLostFoundReport,
  fetchLostFoundReport,
  fetchRecentLostFoundTrips,
  listLostFoundReports,
  markReturned,
  resolutionLabel,
  saveSupportNote,
  sendLostFoundMessage,
  statusLabel,
} from './lostFoundClient.js'

function createFakeSupabase({
  tables = {},
  errors = {},
} = {}) {
  const store = {
    profiles: [...(tables.profiles || [])],
    trips: [...(tables.trips || [])],
    lost_found_reports: [...(tables.lost_found_reports || [])],
    lost_found_messages: [...(tables.lost_found_messages || [])],
    trip_events: [...(tables.trip_events || [])],
  }

  const calls = {
    queries: [],
    inserts: [],
    updates: [],
  }

  function from(tableName) {
    if (!store[tableName]) {
      store[tableName] = []
    }

    let mode = 'select'
    let insertPayload = null
    let updatePayload = null
    const filters = []
    let orderSpec = null
    let limitCount = null

    const builder = {
      select() {
        return builder
      },
      eq(col, val) {
        filters.push({ type: 'eq', col, val })
        return builder
      },
      in(col, vals) {
        filters.push({ type: 'in', col, vals: Array.isArray(vals) ? vals : [vals] })
        return builder
      },
      or(expr) {
        filters.push({ type: 'or', expr })
        return builder
      },
      not(col, op, val) {
        filters.push({ type: 'not', col, op, val })
        return builder
      },
      order(col, options = {}) {
        orderSpec = { col, ascending: options.ascending !== false }
        return builder
      },
      limit(n) {
        limitCount = n
        return builder
      },
      insert(payload) {
        mode = 'insert'
        insertPayload = payload
        return builder
      },
      update(patch) {
        mode = 'update'
        updatePayload = patch
        return builder
      },
      single() {
        return execute(true, false)
      },
      maybeSingle() {
        return execute(false, true)
      },
      then(onFulfilled, onRejected) {
        return execute(false, false).then(onFulfilled, onRejected)
      },
    }

    function rowMatches(row) {
      for (const filter of filters) {
        if (filter.type === 'eq') {
          if (row[filter.col] !== filter.val) return false
        } else if (filter.type === 'in') {
          if (!filter.vals.includes(row[filter.col])) return false
        } else if (filter.type === 'not') {
          if (filter.op === 'is' && filter.val === null) {
            if (row[filter.col] === null || row[filter.col] === undefined) return false
          }
        } else if (filter.type === 'or') {
          const clauses = filter.expr.split(',')
          const matchedAny = clauses.some((clause) => {
            const parts = clause.split('.')
            if (parts.length >= 3 && parts[1] === 'eq') {
              const col = parts[0]
              const val = parts.slice(2).join('.')
              return String(row[col]) === String(val)
            }
            return false
          })
          if (!matchedAny) return false
        }
      }
      return true
    }

    async function execute(isSingle = false, isMaybeSingle = false) {
      if (errors[tableName]) {
        return { data: null, error: errors[tableName] }
      }

      if (mode === 'insert') {
        const rowsToInsert = Array.isArray(insertPayload) ? insertPayload : [insertPayload]
        const inserted = []
        for (const p of rowsToInsert) {
          const row = {
            id: p.id || `${tableName}_${store[tableName].length + 1}`,
            created_at: p.created_at || '2026-09-24T12:00:00.000Z',
            ...p,
          }
          store[tableName].push(row)
          inserted.push(row)
        }
        calls.inserts.push({ table: tableName, rows: inserted })
        if (isSingle) {
          return { data: inserted[0], error: null }
        }
        return { data: inserted, error: null }
      }

      if (mode === 'update') {
        const matched = store[tableName].filter(rowMatches)
        for (const row of matched) {
          Object.assign(row, updatePayload)
        }
        calls.updates.push({ table: tableName, patch: updatePayload, updated: matched, filters: [...filters] })
        return { data: matched, error: null }
      }

      // mode === 'select'
      calls.queries.push({ table: tableName, filters: [...filters], orderSpec, limitCount })
      let matched = store[tableName].filter(rowMatches)
      if (orderSpec) {
        matched.sort((a, b) => {
          const valA = a[orderSpec.col]
          const valB = b[orderSpec.col]
          if (valA === valB) return 0
          if (valA === null || valA === undefined) return 1
          if (valB === null || valB === undefined) return -1
          if (valA < valB) return orderSpec.ascending ? -1 : 1
          return orderSpec.ascending ? 1 : -1
        })
      }
      if (typeof limitCount === 'number') {
        matched = matched.slice(0, limitCount)
      }

      if (isSingle) {
        return { data: matched[0] || null, error: matched.length === 0 ? { message: 'Not found' } : null }
      }
      if (isMaybeSingle) {
        return { data: matched[0] || null, error: null }
      }
      return { data: matched, error: null }
    }

    return builder
  }

  return {
    from,
    store,
    calls,
    setError(table, err) {
      errors[table] = err
    },
    clearError(table) {
      delete errors[table]
    },
  }
}

// ---------------------------------------------------------------------------
// 1. requireClient validation
// ---------------------------------------------------------------------------
test('requireClient paths throw when supabase is missing', async () => {
  await assert.rejects(
    () => fetchRecentLostFoundTrips(null, 'user-1'),
    /Supabase is not configured/,
  )
  await assert.rejects(
    () => fetchRecentLostFoundTrips(undefined, 'user-1'),
    /Supabase is not configured/,
  )

  await assert.rejects(
    () => listLostFoundReports(null, 'user-1'),
    /Supabase is not configured/,
  )

  await assert.rejects(
    () => fetchLostFoundReport(null, 'rep-1', 'user-1'),
    /Supabase is not configured/,
  )

  await assert.rejects(
    () => createLostFoundReport(null, { description: 'Keys on back seat' }),
    /Supabase is not configured/,
  )

  await assert.rejects(
    () => sendLostFoundMessage(null, { reportId: 'rep-1', body: 'Hello' }),
    /Supabase is not configured/,
  )

  // updateReport (and thus confirmFound, confirmNotFound, markReturned, closeLostFoundReport, saveSupportNote)
  // validates supabase client via requireClient, rejecting with 'Supabase is not configured'
  await assert.rejects(
    () => confirmFound(null, 'rep-1'),
    /Supabase is not configured/,
  )
  await assert.rejects(
    () => confirmNotFound(null, 'rep-1'),
    /Supabase is not configured/,
  )
  await assert.rejects(
    () => markReturned(null, 'rep-1'),
    /Supabase is not configured/,
  )
  await assert.rejects(
    () => closeLostFoundReport(null, 'rep-1'),
    /Supabase is not configured/,
  )
  await assert.rejects(
    () => saveSupportNote(null, 'rep-1', 'Note'),
    /Supabase is not configured/,
  )
})

// ---------------------------------------------------------------------------
// 2. fetchRecentLostFoundTrips
// ---------------------------------------------------------------------------
test('fetchRecentLostFoundTrips: returns empty array when userId is falsy without calling DB', async () => {
  const supabase = createFakeSupabase()
  assert.deepEqual(await fetchRecentLostFoundTrips(supabase, ''), [])
  assert.deepEqual(await fetchRecentLostFoundTrips(supabase, null), [])
  assert.deepEqual(await fetchRecentLostFoundTrips(supabase, undefined), [])
  assert.equal(supabase.calls.queries.length, 0)
})

test('fetchRecentLostFoundTrips: maps completed trips via toPublicTrip and joins counterpart first names', async () => {
  const supabase = createFakeSupabase({
    tables: {
      trips: [
        {
          id: 'trip-1',
          rider_id: 'user-1',
          driver_id: 'driver-9',
          pickup_label: '100 Sikes Hall Clemson SC 29634',
          dropoff_label: 'Greenville-Spartanburg International Airport (GSP)',
          completed_at: '2026-09-24T18:00:00.000Z',
          requested_at: '2026-09-24T17:00:00.000Z',
          status: 'completed',
        },
        {
          id: 'trip-2',
          rider_id: 'rider-8',
          driver_id: 'user-1',
          pickup_label: 'CLT Douglas Airport',
          dropoff_label: 'Tillman Hall',
          completed_at: '2026-09-23T14:00:00.000Z',
          requested_at: '2026-09-23T13:00:00.000Z',
          status: 'completed',
        },
        {
          // Incomplete trip - should be filtered by status eq 'completed'
          id: 'trip-3',
          rider_id: 'user-1',
          driver_id: 'driver-9',
          pickup_label: 'Downtown',
          dropoff_label: 'Campus',
          completed_at: null,
          status: 'in_progress',
        },
        {
          // Completed trip but without driver - filtered by not driver_id is null
          id: 'trip-4',
          rider_id: 'user-1',
          driver_id: null,
          pickup_label: 'Downtown',
          dropoff_label: 'Campus',
          completed_at: '2026-09-22T10:00:00.000Z',
          status: 'completed',
        },
      ],
      profiles: [
        { id: 'driver-9', full_name: 'Robert Vance' },
        { id: 'rider-8', full_name: 'Angela Martin' },
      ],
    },
  })

  const trips = await fetchRecentLostFoundTrips(supabase, 'user-1')
  assert.equal(trips.length, 2)

  // Trip 1: user is rider, counterpart is driver-9
  assert.equal(trips[0].id, 'trip-1')
  assert.equal(trips[0].otherId, 'driver-9')
  assert.equal(trips[0].otherFirstName, 'Robert')
  assert.equal(trips[0].otherRole, 'driver')
  assert.equal(trips[0].pickup, 'Clemson area')
  assert.equal(trips[0].dropoff, 'GSP Airport')
  assert.equal(trips[0].completedAt, '2026-09-24T18:00:00.000Z')

  // Trip 2: user is driver, counterpart is rider-8
  assert.equal(trips[1].id, 'trip-2')
  assert.equal(trips[1].otherId, 'rider-8')
  assert.equal(trips[1].otherFirstName, 'Angela')
  assert.equal(trips[1].otherRole, 'rider')
  assert.equal(trips[1].pickup, 'CLT Airport')
  assert.equal(trips[1].dropoff, 'Tillman Hall')
  assert.equal(trips[1].completedAt, '2026-09-23T14:00:00.000Z')
})

test('fetchRecentLostFoundTrips: falls back to Driver/Rider when profile name is missing', async () => {
  const supabase = createFakeSupabase({
    tables: {
      trips: [
        {
          id: 'trip-10',
          rider_id: 'user-1',
          driver_id: 'driver-unknown',
          pickup_label: 'Campus',
          dropoff_label: 'Downtown',
          completed_at: '2026-09-24T12:00:00.000Z',
          status: 'completed',
        },
      ],
      profiles: [],
    },
  })

  const trips = await fetchRecentLostFoundTrips(supabase, 'user-1')
  assert.equal(trips.length, 1)
  assert.equal(trips[0].otherFirstName, 'Driver')
  assert.equal(trips[0].otherRole, 'driver')
})

test('fetchRecentLostFoundTrips: converts database errors to friendlyLostFoundError', async () => {
  const supabase = createFakeSupabase({
    errors: {
      trips: { message: 'permission denied for table trips' },
    },
  })

  await assert.rejects(
    () => fetchRecentLostFoundTrips(supabase, 'user-1'),
    /You can only open lost-and-found reports for your own completed rides/,
  )

  const supabaseProfileErr = createFakeSupabase({
    tables: {
      trips: [
        {
          id: 'trip-1',
          rider_id: 'user-1',
          driver_id: 'driver-1',
          status: 'completed',
          completed_at: '2026-09-24T12:00:00.000Z',
        },
      ],
    },
    errors: {
      profiles: { message: 'relation "profiles" does not exist' },
    },
  })

  await assert.rejects(
    () => fetchRecentLostFoundTrips(supabaseProfileErr, 'user-1'),
    /Lost and found is not available yet/,
  )
})

// ---------------------------------------------------------------------------
// 3. listLostFoundReports
// ---------------------------------------------------------------------------
test('listLostFoundReports: returns empty array when userId is falsy', async () => {
  const supabase = createFakeSupabase()
  assert.deepEqual(await listLostFoundReports(supabase, ''), [])
  assert.deepEqual(await listLostFoundReports(supabase, null), [])
  assert.deepEqual(await listLostFoundReports(supabase, undefined), [])
})

test('listLostFoundReports: non-admin only sees reports where they are reporter or counterpart', async () => {
  const supabase = createFakeSupabase({
    tables: {
      profiles: [
        { id: 'user-1', full_name: 'Jim Halpert', is_admin: false, role: 'rider' },
        { id: 'driver-1', full_name: 'Dwight Schrute', is_admin: false, role: 'driver' },
        { id: 'user-2', full_name: 'Pam Beesly', is_admin: false, role: 'rider' },
      ],
      trips: [
        {
          id: 'trip-1',
          pickup_label: '114 Earle',
          dropoff_label: 'GSP Airport',
          completed_at: '2026-09-24T10:00:00.000Z',
          metadata: { ride_chat_id: 'chat-thread-1' },
        },
        {
          id: 'trip-2',
          pickup_label: 'Memorial Stadium',
          dropoff_label: 'Tillman Hall',
          completed_at: '2026-09-24T11:00:00.000Z',
          metadata: null,
        },
      ],
      lost_found_reports: [
        {
          id: 'rep-1',
          trip_id: 'trip-1',
          reporter_id: 'user-1',
          counterpart_id: 'driver-1',
          item_description: 'Hydro Flask water bottle',
          status: 'open',
          resolution: null,
          support_note: 'Left in backseat cup holder',
          created_at: '2026-09-24T12:00:00.000Z',
        },
        {
          id: 'rep-2',
          trip_id: 'trip-2',
          reporter_id: 'driver-1',
          counterpart_id: 'user-1',
          item_description: 'Black Clemson cap',
          status: 'claimed',
          resolution: 'found',
          support_note: null,
          created_at: '2026-09-24T13:00:00.000Z',
        },
        {
          // User is neither reporter nor counterpart
          id: 'rep-3',
          trip_id: 'trip-1',
          reporter_id: 'user-2',
          counterpart_id: 'driver-1',
          item_description: 'Umbrella',
          status: 'open',
          created_at: '2026-09-24T14:00:00.000Z',
        },
      ],
    },
  })

  const reports = await listLostFoundReports(supabase, 'user-1')
  assert.equal(reports.length, 2)

  // Ordered by created_at desc (rep-2 is 13:00, rep-1 is 12:00)
  assert.equal(reports[0].id, 'rep-2')
  assert.equal(reports[0].itemDescription, 'Black Clemson cap')
  assert.equal(reports[0].reporterFirstName, 'Dwight')
  assert.equal(reports[0].counterpartFirstName, 'Jim')
  assert.equal(reports[0].pickup, 'Memorial Stadium')
  assert.equal(reports[0].dropoff, 'Tillman Hall')
  assert.equal(reports[0].mine, false)
  assert.equal(reports[0].hasRideChat, false)

  assert.equal(reports[1].id, 'rep-1')
  assert.equal(reports[1].itemDescription, 'Hydro Flask water bottle')
  assert.equal(reports[1].reporterFirstName, 'Jim')
  assert.equal(reports[1].counterpartFirstName, 'Dwight')
  assert.equal(reports[1].pickup, '114 Earle')
  assert.equal(reports[1].dropoff, 'GSP Airport')
  assert.equal(reports[1].mine, true)
  assert.equal(reports[1].hasRideChat, true)
})

test('listLostFoundReports: admin or ops user sees all reports without user filter', async () => {
  const supabase = createFakeSupabase({
    tables: {
      profiles: [
        { id: 'admin-1', full_name: 'Admin Boss', is_admin: true, role: 'admin' },
        { id: 'u1', full_name: 'User One' },
        { id: 'u2', full_name: 'User Two' },
      ],
      lost_found_reports: [
        {
          id: 'rep-1',
          trip_id: 't-1',
          reporter_id: 'u1',
          counterpart_id: 'u2',
          item_description: 'Item A',
          status: 'open',
          created_at: '2026-09-24T10:00:00.000Z',
        },
        {
          id: 'rep-2',
          trip_id: 't-2',
          reporter_id: 'u2',
          counterpart_id: 'u1',
          item_description: 'Item B',
          status: 'closed',
          created_at: '2026-09-24T11:00:00.000Z',
        },
      ],
    },
  })

  const reports = await listLostFoundReports(supabase, 'admin-1')
  assert.equal(reports.length, 2)
})

test('listLostFoundReports: handles missing joins and errors gracefully', async () => {
  const supabaseMissingJoins = createFakeSupabase({
    tables: {
      profiles: [
        { id: 'u1', full_name: 'Solo User', is_admin: false },
      ],
      lost_found_reports: [
        {
          id: 'rep-1',
          trip_id: 'missing-trip',
          reporter_id: 'u1',
          counterpart_id: 'missing-counterpart',
          item_description: 'Keys',
          status: 'open',
          created_at: '2026-09-24T10:00:00.000Z',
        },
      ],
    },
  })

  const [rep] = await listLostFoundReports(supabaseMissingJoins, 'u1')
  assert.equal(rep.reporterFirstName, 'Solo')
  assert.equal(rep.counterpartFirstName, 'Driver')
  assert.equal(rep.pickup, 'Pickup area')
  assert.equal(rep.dropoff, 'Dropoff area')
  assert.equal(rep.completedAt, null)
  assert.equal(rep.hasRideChat, false)

  const supabaseErr = createFakeSupabase({
    errors: {
      lost_found_reports: { message: 'invalid status transition' },
    },
  })

  await assert.rejects(
    () => listLostFoundReports(supabaseErr, 'u1'),
    /That step does not match this report’s status/,
  )
})

// ---------------------------------------------------------------------------
// 4. fetchLostFoundReport
// ---------------------------------------------------------------------------
test('fetchLostFoundReport: returns null if report not found', async () => {
  const supabase = createFakeSupabase()
  const res = await fetchLostFoundReport(supabase, 'non-existent', 'user-1')
  assert.equal(res, null)
})

test('fetchLostFoundReport: joins profiles, trips, messages and computes claim choices', async () => {
  const supabase = createFakeSupabase({
    tables: {
      profiles: [
        { id: 'user-reporter', full_name: 'Stanley Hudson' },
        { id: 'user-counterpart', full_name: 'Phyllis Vance' },
      ],
      trips: [
        {
          id: 'trip-100',
          pickup_label: 'Downtown / College Ave',
          dropoff_label: 'The Pier',
          completed_at: '2026-09-24T14:00:00.000Z',
          metadata: { ride_chat_id: 'rc-1' },
        },
      ],
      lost_found_reports: [
        {
          id: 'rep-100',
          trip_id: 'trip-100',
          reporter_id: 'user-reporter',
          counterpart_id: 'user-counterpart',
          item_description: 'Crossword puzzle book',
          status: 'open',
          resolution: null,
          support_note: 'Left on the back seat',
          created_at: '2026-09-24T15:00:00.000Z',
        },
      ],
      lost_found_messages: [
        {
          id: 'msg-1',
          report_id: 'rep-100',
          sender_id: 'user-reporter',
          body: 'Did you find my crossword book?',
          created_at: '2026-09-24T15:05:00.000Z',
        },
        {
          id: 'msg-2',
          report_id: 'rep-100',
          sender_id: 'user-counterpart',
          body: 'Yes, I see it on the floor.',
          created_at: '2026-09-24T15:10:00.000Z',
        },
        {
          id: 'msg-3',
          report_id: 'rep-100',
          sender_id: 'other-staff',
          body: 'Support verified both parties.',
          created_at: '2026-09-24T15:15:00.000Z',
        },
      ],
    },
  })

  // Viewed as the reporter
  const asReporter = await fetchLostFoundReport(supabase, 'rep-100', 'user-reporter')
  assert.equal(asReporter.id, 'rep-100')
  assert.equal(asReporter.itemDescription, 'Crossword puzzle book')
  assert.equal(asReporter.reporterFirstName, 'Stanley')
  assert.equal(asReporter.counterpartFirstName, 'Phyllis')
  assert.equal(asReporter.pickup, 'Downtown / College Ave')
  assert.equal(asReporter.dropoff, 'The Pier')
  assert.equal(asReporter.hasRideChat, true)
  assert.equal(asReporter.mine, true)

  // Messages verification
  assert.equal(asReporter.messages.length, 3)
  assert.deepEqual(asReporter.messages[0], {
    id: 'msg-1',
    body: 'Did you find my crossword book?',
    createdAt: '2026-09-24T15:05:00.000Z',
    mine: true,
    senderFirstName: 'You',
  })
  assert.deepEqual(asReporter.messages[1], {
    id: 'msg-2',
    body: 'Yes, I see it on the floor.',
    createdAt: '2026-09-24T15:10:00.000Z',
    mine: false,
    senderFirstName: 'Phyllis',
  })
  assert.deepEqual(asReporter.messages[2], {
    id: 'msg-3',
    body: 'Support verified both parties.',
    createdAt: '2026-09-24T15:15:00.000Z',
    mine: false,
    senderFirstName: 'Them',
  })

  // Reporter choices on open report: cannot confirm found, but can withdraw
  assert.equal(asReporter.choices.canConfirmFound, false)
  assert.equal(asReporter.choices.canConfirmNotFound, false)
  assert.equal(asReporter.choices.canWithdraw, true)
  assert.equal(asReporter.choices.canSupportNote, true)

  // Viewed as counterpart: can confirm found/not found
  const asCounterpart = await fetchLostFoundReport(supabase, 'rep-100', 'user-counterpart')
  assert.equal(asCounterpart.mine, false)
  assert.equal(asCounterpart.choices.canConfirmFound, true)
  assert.equal(asCounterpart.choices.canConfirmNotFound, true)
  assert.equal(asCounterpart.choices.canWithdraw, false)

  // Change report to claimed: both can message, close, markReturned
  supabase.store.lost_found_reports[0].status = 'claimed'
  const asClaimed = await fetchLostFoundReport(supabase, 'rep-100', 'user-reporter')
  assert.equal(asClaimed.choices.canMessage, true)
  assert.equal(asClaimed.choices.canMarkReturned, true)
  assert.equal(asClaimed.choices.canClose, true)

  // Change report to returned: can message, support note, close
  supabase.store.lost_found_reports[0].status = 'returned'
  const asReturned = await fetchLostFoundReport(supabase, 'rep-100', 'user-reporter')
  assert.equal(asReturned.choices.canMessage, true)
  assert.equal(asReturned.choices.canMarkReturned, false)
  assert.equal(asReturned.choices.canClose, true)

  // Change report to closed: all choices false
  supabase.store.lost_found_reports[0].status = 'closed'
  const asClosed = await fetchLostFoundReport(supabase, 'rep-100', 'user-reporter')
  assert.equal(asClosed.choices.canMessage, false)
  assert.equal(asClosed.choices.canConfirmFound, false)
})

test('fetchLostFoundReport: throws friendlyLostFoundError on database errors', async () => {
  const supabaseReportErr = createFakeSupabase({
    errors: {
      lost_found_reports: { message: 'permission denied' },
    },
  })
  await assert.rejects(
    () => fetchLostFoundReport(supabaseReportErr, 'rep-1', 'user-1'),
    /You can only open lost-and-found reports for your own completed rides/,
  )

  const supabaseMsgErr = createFakeSupabase({
    tables: {
      lost_found_reports: [
        { id: 'rep-1', trip_id: 't-1', reporter_id: 'u1', counterpart_id: 'u2', status: 'open' },
      ],
    },
    errors: {
      lost_found_messages: { message: 'relation "lost_found_messages" does not exist' },
    },
  })
  await assert.rejects(
    () => fetchLostFoundReport(supabaseMsgErr, 'rep-1', 'u1'),
    /Lost and found is not available yet/,
  )
})

// ---------------------------------------------------------------------------
// 5. createLostFoundReport
// ---------------------------------------------------------------------------
test('createLostFoundReport: validates description length (2-400 chars)', async () => {
  const supabase = createFakeSupabase()

  await assert.rejects(
    () => createLostFoundReport(supabase, { tripId: 't1', description: '' }),
    /Describe the item in a few words/,
  )
  await assert.rejects(
    () => createLostFoundReport(supabase, { tripId: 't1', description: ' ' }),
    /Describe the item in a few words/,
  )
  await assert.rejects(
    () => createLostFoundReport(supabase, { tripId: 't1', description: 'x' }),
    /Describe the item in a few words/,
  )
  await assert.rejects(
    () => createLostFoundReport(supabase, { tripId: 't1', description: null }),
    /Describe the item in a few words/,
  )
  await assert.rejects(
    () => createLostFoundReport(supabase, { tripId: 't1', description: 'a'.repeat(401) }),
    /Keep the description under 400 characters/,
  )
})

test('createLostFoundReport: inserts report with trimmed description and adds trip_event', async () => {
  const supabase = createFakeSupabase()

  const data = await createLostFoundReport(supabase, {
    tripId: 'trip-abc',
    reporterId: 'user-rider',
    counterpartId: 'user-driver',
    description: '   Black North Face backpack with laptop inside   ',
  })

  assert.ok(data?.id)
  assert.equal(supabase.store.lost_found_reports.length, 1)

  const insertedReport = supabase.store.lost_found_reports[0]
  assert.equal(insertedReport.trip_id, 'trip-abc')
  assert.equal(insertedReport.reporter_id, 'user-rider')
  assert.equal(insertedReport.counterpart_id, 'user-driver')
  assert.equal(insertedReport.item_description, 'Black North Face backpack with laptop inside')
  assert.equal(insertedReport.status, 'open')

  assert.equal(supabase.store.trip_events.length, 1)
  const insertedEvent = supabase.store.trip_events[0]
  assert.equal(insertedEvent.trip_id, 'trip-abc')
  assert.equal(insertedEvent.kind, 'lost_found_reported')
  assert.deepEqual(insertedEvent.payload, { report_id: data.id })
})

test('createLostFoundReport: asserts current behavior regarding tripId validation', async () => {
  // BUG?: createLostFoundReport does not validate tripId, reporterId, or counterpartId client-side
  // before inserting into supabase. When tripId is omitted, it still proceeds to insert undefined trip_id.
  const supabase = createFakeSupabase()
  const data = await createLostFoundReport(supabase, {
    tripId: undefined,
    reporterId: undefined,
    counterpartId: undefined,
    description: 'Car keys',
  })
  assert.ok(data?.id)
  assert.equal(supabase.store.lost_found_reports[0].trip_id, undefined)
})

test('createLostFoundReport: warns but does not fail if trip_events insert errors', async () => {
  const supabase = createFakeSupabase({
    errors: {
      trip_events: { message: 'event write failed' },
    },
  })

  const originalWarn = console.warn
  let warned = null
  console.warn = (prefix, msg) => {
    warned = { prefix, msg }
  }

  try {
    const data = await createLostFoundReport(supabase, {
      tripId: 'trip-1',
      reporterId: 'u1',
      counterpartId: 'd1',
      description: 'AirPods Pro case',
    })
    assert.ok(data?.id)
    assert.equal(warned?.prefix, '[lost-found] notify event')
    assert.equal(warned?.msg, 'event write failed')
  } finally {
    console.warn = originalWarn
  }
})

test('createLostFoundReport: throws friendlyLostFoundError on report insert error', async () => {
  const supabase = createFakeSupabase({
    errors: {
      lost_found_reports: { message: 'immutable lost and found' },
    },
  })

  await assert.rejects(
    () => createLostFoundReport(supabase, {
      tripId: 't1',
      description: 'Water bottle',
    }),
    /The item description and ride cannot be changed/,
  )
})

// ---------------------------------------------------------------------------
// 6. Update paths: confirmFound, confirmNotFound, markReturned, closeLostFoundReport, saveSupportNote
// ---------------------------------------------------------------------------
test('confirmFound: updates status to claimed and resolution to found', async () => {
  const supabase = createFakeSupabase({
    tables: {
      lost_found_reports: [
        { id: 'rep-1', status: 'open', resolution: null },
      ],
    },
  })

  await confirmFound(supabase, 'rep-1')
  const report = supabase.store.lost_found_reports[0]
  assert.equal(report.status, 'claimed')
  assert.equal(report.resolution, 'found')
})

test('confirmNotFound: updates status to closed and resolution to not_found', async () => {
  const supabase = createFakeSupabase({
    tables: {
      lost_found_reports: [
        { id: 'rep-1', status: 'open', resolution: null },
      ],
    },
  })

  await confirmNotFound(supabase, 'rep-1')
  const report = supabase.store.lost_found_reports[0]
  assert.equal(report.status, 'closed')
  assert.equal(report.resolution, 'not_found')
})

test('markReturned: updates status to returned', async () => {
  const supabase = createFakeSupabase({
    tables: {
      lost_found_reports: [
        { id: 'rep-1', status: 'claimed', resolution: 'found' },
      ],
    },
  })

  await markReturned(supabase, 'rep-1')
  const report = supabase.store.lost_found_reports[0]
  assert.equal(report.status, 'returned')
})

test('closeLostFoundReport: updates status to closed', async () => {
  const supabase = createFakeSupabase({
    tables: {
      lost_found_reports: [
        { id: 'rep-1', status: 'claimed' },
      ],
    },
  })

  await closeLostFoundReport(supabase, 'rep-1')
  const report = supabase.store.lost_found_reports[0]
  assert.equal(report.status, 'closed')
})

test('saveSupportNote: validates note length <= 1000 and trims text', async () => {
  const supabase = createFakeSupabase({
    tables: {
      lost_found_reports: [
        { id: 'rep-1', support_note: null },
      ],
    },
  })

  await assert.rejects(
    () => saveSupportNote(supabase, 'rep-1', 'x'.repeat(1001)),
    /Keep the support note under 1000 characters/,
  )

  await saveSupportNote(supabase, 'rep-1', '   Handed item to front desk   ')
  assert.equal(supabase.store.lost_found_reports[0].support_note, 'Handed item to front desk')

  // Empty or whitespace note resets support_note to null
  await saveSupportNote(supabase, 'rep-1', '   ')
  assert.equal(supabase.store.lost_found_reports[0].support_note, null)

  await saveSupportNote(supabase, 'rep-1', null)
  assert.equal(supabase.store.lost_found_reports[0].support_note, null)
})

test('updateReport paths: throws friendlyLostFoundError on database error', async () => {
  const supabase = createFakeSupabase({
    errors: {
      lost_found_reports: { message: 'only the other party can confirm' },
    },
  })

  await assert.rejects(
    () => confirmFound(supabase, 'rep-1'),
    /Only the other person on this ride can confirm whether it was found/,
  )
})

// ---------------------------------------------------------------------------
// 7. sendLostFoundMessage
// ---------------------------------------------------------------------------
test('sendLostFoundMessage: validates message body (non-empty, <= 1000 characters)', async () => {
  const supabase = createFakeSupabase()

  await assert.rejects(
    () => sendLostFoundMessage(supabase, { reportId: 'r1', senderId: 'u1', body: '' }),
    /Write a short message about the return/,
  )
  await assert.rejects(
    () => sendLostFoundMessage(supabase, { reportId: 'r1', senderId: 'u1', body: '   ' }),
    /Write a short message about the return/,
  )
  await assert.rejects(
    () => sendLostFoundMessage(supabase, { reportId: 'r1', senderId: 'u1', body: null }),
    /Write a short message about the return/,
  )
  await assert.rejects(
    () => sendLostFoundMessage(supabase, { reportId: 'r1', senderId: 'u1', body: 'm'.repeat(1001) }),
    /Keep the message under 1000 characters/,
  )
})

test('sendLostFoundMessage: trims body and inserts into lost_found_messages', async () => {
  const supabase = createFakeSupabase()

  await sendLostFoundMessage(supabase, {
    reportId: 'rep-42',
    senderId: 'user-7',
    body: '   I can meet you by Cooper Library at 3 PM   ',
  })

  assert.equal(supabase.store.lost_found_messages.length, 1)
  const msg = supabase.store.lost_found_messages[0]
  assert.equal(msg.report_id, 'rep-42')
  assert.equal(msg.sender_id, 'user-7')
  assert.equal(msg.body, 'I can meet you by Cooper Library at 3 PM')
})

test('sendLostFoundMessage: asserts current behavior regarding reportId/senderId validation', async () => {
  // BUG?: sendLostFoundMessage does not validate reportId or senderId client-side before inserting
  const supabase = createFakeSupabase()
  await sendLostFoundMessage(supabase, {
    reportId: undefined,
    senderId: undefined,
    body: 'Hello',
  })
  assert.equal(supabase.store.lost_found_messages.length, 1)
  assert.equal(supabase.store.lost_found_messages[0].report_id, undefined)
  assert.equal(supabase.store.lost_found_messages[0].sender_id, undefined)
})

test('sendLostFoundMessage: throws friendlyLostFoundError on insert error', async () => {
  const supabase = createFakeSupabase({
    errors: {
      lost_found_messages: { message: 'permission denied' },
    },
  })

  await assert.rejects(
    () => sendLostFoundMessage(supabase, { reportId: 'r1', senderId: 'u1', body: 'Hello' }),
    /You can only open lost-and-found reports for your own completed rides/,
  )
})

// ---------------------------------------------------------------------------
// 8. Smoke test re-exports from lostFoundFlow.js
// ---------------------------------------------------------------------------
test('statusLabel and resolutionLabel: smoke test re-exports from lostFoundFlow.js', () => {
  assert.equal(statusLabel('open'), 'Open')
  assert.equal(statusLabel('claimed'), 'Claimed')
  assert.equal(statusLabel('returned'), 'Returned')
  assert.equal(statusLabel('closed'), 'Closed')
  assert.equal(statusLabel('archived'), 'archived')
  assert.equal(statusLabel(undefined), 'Open')

  assert.equal(resolutionLabel('found'), 'Found')
  assert.equal(resolutionLabel('not_found'), 'Not found')
  assert.equal(resolutionLabel(''), '')
  assert.equal(resolutionLabel(null), '')
  assert.equal(resolutionLabel(undefined), '')
  assert.equal(resolutionLabel('other'), '')
})
