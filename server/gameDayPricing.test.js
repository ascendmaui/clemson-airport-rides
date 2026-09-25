import assert from 'node:assert/strict'
import test from 'node:test'
import { loadGameDayMultiplier } from './creditLots.js'

/**
 * Creates a fake Supabase client simulating the game_day_events query chain:
 * sb.from('game_day_events')
 *   .select(...)
 *   .eq('active', true)
 *   .lte('starts_at', iso)
 *   .gte('ends_at', iso)
 *   .order('surge_multiplier', { ascending: false })
 *   .limit(1)
 */
function createFakeSb(events = [], { error = null, throwError = null, spy = null } = {}) {
  return {
    from(table) {
      if (spy) spy.table = table
      if (throwError) throw throwError

      const filters = {
        eq: {},
        lte: {},
        gte: {},
        order: null,
        limit: null,
        select: null,
      }

      const builder = {
        select(cols) {
          filters.select = cols
          if (spy) spy.select = cols
          return builder
        },
        eq(col, val) {
          filters.eq[col] = val
          if (spy) spy.eq = { ...spy.eq, [col]: val }
          return builder
        },
        lte(col, val) {
          filters.lte[col] = val
          if (spy) spy.lte = { ...spy.lte, [col]: val }
          return builder
        },
        gte(col, val) {
          filters.gte[col] = val
          if (spy) spy.gte = { ...spy.gte, [col]: val }
          return builder
        },
        order(col, options = {}) {
          filters.order = { col, options }
          if (spy) spy.order = { col, options }
          return builder
        },
        limit(count) {
          filters.limit = count
          if (spy) spy.limit = count
          return builder
        },
        then(onfulfilled, onrejected) {
          if (throwError) {
            return Promise.reject(throwError).catch(onrejected)
          }
          if (error) {
            return Promise.resolve({ data: null, error }).then(onfulfilled, onrejected)
          }

          let matched = events.filter((ev) => {
            for (const [col, val] of Object.entries(filters.eq)) {
              if (ev[col] !== val) return false
            }
            for (const [col, val] of Object.entries(filters.lte)) {
              // PostgREST .lte('starts_at', iso): starts_at <= iso
              if (ev[col] == null || ev[col] > val) return false
            }
            for (const [col, val] of Object.entries(filters.gte)) {
              // PostgREST .gte('ends_at', iso): ends_at >= iso
              if (ev[col] == null || ev[col] < val) return false
            }
            return true
          })

          if (filters.order) {
            const { col, options } = filters.order
            matched.sort((a, b) => {
              const va = Number(a[col])
              const vb = Number(b[col])
              if (Number.isFinite(va) && Number.isFinite(vb)) {
                return options.ascending ? va - vb : vb - va
              }
              const sa = String(a[col] ?? '')
              const sb = String(b[col] ?? '')
              return options.ascending ? sa.localeCompare(sb) : sb.localeCompare(sa)
            })
          }

          if (typeof filters.limit === 'number') {
            matched = matched.slice(0, filters.limit)
          }

          return Promise.resolve({ data: matched, error: null }).then(onfulfilled, onrejected)
        },
      }

      return builder
    },
  }
}

test('game day active window returns multiplier and event record', async () => {
  const event = {
    id: 'gameday-wake-forest',
    title: 'Clemson vs. Wake Forest',
    active: true,
    starts_at: '2026-10-10T12:00:00.000Z',
    ends_at: '2026-10-10T20:00:00.000Z',
    surge_multiplier: 1.75,
    pickup_zone_label: 'Memorial Stadium',
  }
  const sb = createFakeSb([event])

  // Midway inside the active window
  const mid = new Date('2026-10-10T16:00:00.000Z')
  const res = await loadGameDayMultiplier(sb, mid)

  assert.equal(res.multiplier, 1.75)
  assert.equal(res.event.id, 'gameday-wake-forest')
  assert.equal(res.event.title, 'Clemson vs. Wake Forest')
  assert.equal(res.event.pickup_zone_label, 'Memorial Stadium')

  // Supports ISO string as `at` parameter
  const strRes = await loadGameDayMultiplier(sb, '2026-10-10T16:00:00.000Z')
  assert.equal(strRes.multiplier, 1.75)
  assert.equal(strRes.event.id, 'gameday-wake-forest')
})

test('boundaries: start and end exact timestamps match', async () => {
  const event = {
    id: 'gameday-boundary',
    title: 'Clemson vs. NC State',
    active: true,
    starts_at: '2026-10-17T14:00:00.000Z',
    ends_at: '2026-10-17T22:00:00.000Z',
    surge_multiplier: 2.0,
    pickup_zone_label: 'Perimeter Lot',
  }
  const sb = createFakeSb([event])

  // Exact start instant: starts_at <= iso and ends_at >= iso are both satisfied
  const atStart = await loadGameDayMultiplier(sb, new Date('2026-10-17T14:00:00.000Z'))
  assert.equal(atStart.multiplier, 2.0)
  assert.equal(atStart.event.id, 'gameday-boundary')

  // Exact end instant: starts_at <= iso and ends_at >= iso are both satisfied
  const atEnd = await loadGameDayMultiplier(sb, new Date('2026-10-17T22:00:00.000Z'))
  assert.equal(atEnd.multiplier, 2.0)
  assert.equal(atEnd.event.id, 'gameday-boundary')

  // 1 millisecond before start: starts_at <= iso fails
  const beforeStart = await loadGameDayMultiplier(sb, new Date('2026-10-17T13:59:59.999Z'))
  assert.equal(beforeStart.multiplier, null)
  assert.equal(beforeStart.event, null)

  // 1 millisecond after end: ends_at >= iso fails
  const afterEnd = await loadGameDayMultiplier(sb, new Date('2026-10-17T22:00:00.001Z'))
  assert.equal(afterEnd.multiplier, null)
  assert.equal(afterEnd.event, null)
})

test('no rows: empty table, inactive events, or query error return nulls', async () => {
  // Empty table
  const emptySb = createFakeSb([])
  const emptyRes = await loadGameDayMultiplier(emptySb, new Date('2026-10-10T16:00:00.000Z'))
  assert.deepEqual(emptyRes, { multiplier: null, event: null })

  // Event exists but active is false
  const inactiveEvent = {
    id: 'gameday-cancelled',
    title: 'Cancelled Match',
    active: false,
    starts_at: '2026-10-10T12:00:00.000Z',
    ends_at: '2026-10-10T20:00:00.000Z',
    surge_multiplier: 1.5,
  }
  const inactiveSb = createFakeSb([inactiveEvent])
  const inactiveRes = await loadGameDayMultiplier(inactiveSb, new Date('2026-10-10T16:00:00.000Z'))
  assert.deepEqual(inactiveRes, { multiplier: null, event: null })

  // Database / network query error
  const errorSb = createFakeSb([], { error: { message: 'relation game_day_events does not exist' } })
  const errorRes = await loadGameDayMultiplier(errorSb, new Date('2026-10-10T16:00:00.000Z'))
  assert.deepEqual(errorRes, { multiplier: null, event: null })
})

test('malformed multiplier: strings, NaN, Infinity, and null handling', async () => {
  const at = new Date('2026-10-10T16:00:00.000Z')

  // Non-numeric string surge_multiplier -> Number('invalid') is NaN -> null
  const nanEvent = {
    id: 'bad-1',
    active: true,
    starts_at: '2026-10-10T12:00:00.000Z',
    ends_at: '2026-10-10T20:00:00.000Z',
    surge_multiplier: 'not-a-number',
  }
  const nanRes = await loadGameDayMultiplier(createFakeSb([nanEvent]), at)
  assert.equal(nanRes.multiplier, null)
  assert.equal(nanRes.event.id, 'bad-1')

  // Undefined surge_multiplier -> Number(undefined) is NaN -> null
  const undefEvent = {
    id: 'bad-2',
    active: true,
    starts_at: '2026-10-10T12:00:00.000Z',
    ends_at: '2026-10-10T20:00:00.000Z',
  }
  const undefRes = await loadGameDayMultiplier(createFakeSb([undefEvent]), at)
  assert.equal(undefRes.multiplier, null)
  assert.equal(undefRes.event.id, 'bad-2')

  // Infinity surge_multiplier -> Number.isFinite(Infinity) is false -> null
  const infEvent = {
    id: 'bad-3',
    active: true,
    starts_at: '2026-10-10T12:00:00.000Z',
    ends_at: '2026-10-10T20:00:00.000Z',
    surge_multiplier: Infinity,
  }
  const infRes = await loadGameDayMultiplier(createFakeSb([infEvent]), at)
  assert.equal(infRes.multiplier, null)
  assert.equal(infRes.event.id, 'bad-3')

  // Stringified valid number -> parsed via Number('1.6')
  const strEvent = {
    id: 'str-num',
    active: true,
    starts_at: '2026-10-10T12:00:00.000Z',
    ends_at: '2026-10-10T20:00:00.000Z',
    surge_multiplier: '1.6',
  }
  const strRes = await loadGameDayMultiplier(createFakeSb([strEvent]), at)
  assert.equal(strRes.multiplier, 1.6)

  // BUG?: Number(null) evaluates to 0 in JavaScript, and Number.isFinite(0) is true.
  // When surge_multiplier is null in the database row, loadGameDayMultiplier returns multiplier: 0
  // instead of null.
  const nullEvent = {
    id: 'null-mult',
    active: true,
    starts_at: '2026-10-10T12:00:00.000Z',
    ends_at: '2026-10-10T20:00:00.000Z',
    surge_multiplier: null,
  }
  const nullRes = await loadGameDayMultiplier(createFakeSb([nullEvent]), at)
  assert.equal(nullRes.multiplier, 0) // BUG?: coerces null to 0 instead of returning null
  assert.equal(nullRes.event.id, 'null-mult')
})

test('multiple overlapping game days: picks highest surge_multiplier', async () => {
  const low = {
    id: 'event-low',
    title: 'Low Multiplier Event',
    active: true,
    starts_at: '2026-10-10T10:00:00.000Z',
    ends_at: '2026-10-10T22:00:00.000Z',
    surge_multiplier: 1.35,
    pickup_zone_label: 'West Campus',
  }
  const high = {
    id: 'event-high',
    title: 'High Multiplier Event',
    active: true,
    starts_at: '2026-10-10T12:00:00.000Z',
    ends_at: '2026-10-10T20:00:00.000Z',
    surge_multiplier: 2.25,
    pickup_zone_label: 'Memorial Stadium',
  }
  const mid = {
    id: 'event-mid',
    title: 'Mid Multiplier Event',
    active: true,
    starts_at: '2026-10-10T14:00:00.000Z',
    ends_at: '2026-10-10T18:00:00.000Z',
    surge_multiplier: 1.8,
    pickup_zone_label: 'East Campus',
  }

  // Inserted out of order in DB
  const sb = createFakeSb([low, high, mid])
  const at = new Date('2026-10-10T16:00:00.000Z')
  const res = await loadGameDayMultiplier(sb, at)

  assert.equal(res.multiplier, 2.25)
  assert.equal(res.event.id, 'event-high')
  assert.equal(res.event.title, 'High Multiplier Event')
  assert.equal(res.event.pickup_zone_label, 'Memorial Stadium')
})

test('query structure and PostgREST parameters verification', async () => {
  const spy = {}
  const event = {
    id: 'gameday-spy',
    active: true,
    starts_at: '2026-10-10T12:00:00.000Z',
    ends_at: '2026-10-10T20:00:00.000Z',
    surge_multiplier: 1.5,
  }
  const sb = createFakeSb([event], { spy })
  const at = new Date('2026-10-10T15:30:00.000Z')

  await loadGameDayMultiplier(sb, at)

  assert.equal(spy.table, 'game_day_events')
  assert.equal(spy.select, 'id, title, surge_multiplier, pickup_zone_label')
  assert.equal(spy.eq.active, true)
  assert.equal(spy.lte.starts_at, '2026-10-10T15:30:00.000Z')
  assert.equal(spy.gte.ends_at, '2026-10-10T15:30:00.000Z')
  assert.deepEqual(spy.order, { col: 'surge_multiplier', options: { ascending: false } })
  assert.equal(spy.limit, 1)
})

test('unhandled query exceptions and invalid dates', async () => {
  // BUG?: loadGameDayMultiplier does not wrap sb query in try/catch; thrown rejections bubble
  const throwingSb = createFakeSb([], { throwError: new Error('Postgres connection pool exhausted') })
  await assert.rejects(
    () => loadGameDayMultiplier(throwingSb, new Date('2026-10-10T15:00:00.000Z')),
    /Postgres connection pool exhausted/,
  )

  // BUG?: Invalid date parameter causes toISOString() to reject with RangeError
  const sb = createFakeSb([])
  await assert.rejects(
    () => loadGameDayMultiplier(sb, 'not-a-valid-date'),
    RangeError,
  )
})
