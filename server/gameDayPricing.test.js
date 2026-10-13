import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadGameDayMultiplier } from './creditLots.js'
import { NEIGHBORHOODS } from '../src/lib/carpoolEngine.js'
import { SURGE_MAX, SURGE_RULES } from '../src/lib/fareRates.js'
import {
  GAME_DAY_PICKUP_POINTS,
  GAME_DAY_SCHEDULE_LIVE_COPY,
  GAME_DAY_SCHEDULE_OFF_COPY,
  GAME_DAY_SCHEDULE_TIME_COPY,
  eventPickupPointId,
  gameDayScheduleCopy,
  matchGameDayPickupPoint,
  schedulePickupPresets,
  specialPickupOptionLabel,
  specialPickupPointLabel,
  surgeBannerVisible,
  surgeWindowMessage,
} from '../shared/gameDayPickupCopy.js'

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

test('special pickup labels map known campus points and keep other server zones', () => {
  assert.equal(specialPickupPointLabel(null), null)
  assert.equal(specialPickupPointLabel(''), null)
  assert.equal(specialPickupPointLabel('   '), null)
  assert.equal(specialPickupPointLabel({}), null)

  assert.equal(specialPickupPointLabel('Death Valley'), 'Memorial Stadium')
  assert.equal(specialPickupPointLabel('Memorial Stadium Gate 1'), 'Memorial Stadium')
  assert.equal(specialPickupPointLabel('  Lot 5 / Memorial Stadium  '), 'Memorial Stadium · Lot 5')
  assert.equal(specialPickupPointLabel({ pickup_zone_label: 'lot 5' }), 'Memorial Stadium · Lot 5')
  assert.equal(specialPickupPointLabel({ zone: 'Littlejohn Coliseum' }), 'Littlejohn')
  assert.equal(specialPickupPointLabel({ pickupZone: 'Bowman Field' }), 'Bowman Field')

  assert.equal(specialPickupPointLabel('Perimeter Lot'), 'Perimeter Lot')
  assert.equal(specialPickupPointLabel({ pickup_zone_label: 'West Campus' }), 'West Campus')
  assert.equal(specialPickupPointLabel('East Campus'), 'East Campus')

  const longZone = `Tailgate row ${'A'.repeat(90)}`
  assert.equal(specialPickupPointLabel(longZone).length, 80)
  assert.equal(matchGameDayPickupPoint('Perimeter Lot'), null)

  for (const id of ['memorial-stadium', 'littlejohn', 'bowman']) {
    const point = GAME_DAY_PICKUP_POINTS.find((row) => row.id === id)
    const neighborhood = NEIGHBORHOODS.find((row) => row.id === id)
    assert.equal(point.lat, neighborhood.lat)
    assert.equal(point.lng, neighborhood.lng)
  }
  const lot = GAME_DAY_PICKUP_POINTS.find((row) => row.id === 'lot-5')
  const stadium = NEIGHBORHOODS.find((row) => row.id === 'memorial-stadium')
  assert.equal(lot.lat, stadium.lat)
  assert.equal(lot.lng, stadium.lng)
  assert.equal(new Set(GAME_DAY_PICKUP_POINTS.map((row) => row.label)).size, GAME_DAY_PICKUP_POINTS.length)
})

test('surge banner visibility follows the multiplier and ignores cents', () => {
  assert.equal(surgeBannerVisible(null), false)
  assert.equal(surgeBannerVisible(1), false)
  assert.equal(surgeBannerVisible(1.0), false)
  assert.equal(surgeBannerVisible(0), false)
  assert.equal(surgeBannerVisible(0.5), false)
  assert.equal(surgeBannerVisible(Number.NaN), false)
  assert.equal(surgeBannerVisible(Number.POSITIVE_INFINITY), false)
  assert.equal(surgeBannerVisible('1.8×'), false)
  assert.equal(surgeBannerVisible({ multiplier: null }), false)
  assert.equal(surgeBannerVisible({ surge_multiplier: 'nope' }), false)
  assert.equal(surgeBannerVisible({ multiplier: 1, fareCents: 99999 }), false)

  assert.equal(surgeBannerVisible(1.8), true)
  assert.equal(surgeBannerVisible('1.35'), true)
  assert.equal(surgeBannerVisible({
    multiplier: 1.2,
    rule: { id: 'weekend', label: 'Weekend' },
    fareCents: 4200,
  }), true)
  assert.equal(surgeBannerVisible({ surge: { multiplier: 2.5 } }), true)

  const gameDay = SURGE_RULES.find((rule) => rule.id === 'game_day')
  const weekend = SURGE_RULES.find((rule) => rule.id === 'weekend')
  const airport = SURGE_RULES.find((rule) => rule.id === 'airport_rush')
  assert.equal(gameDay.multiplier, 1.8)
  assert.equal(weekend.multiplier, 1.2)
  assert.equal(airport.multiplier, 1.35)
  assert.equal(SURGE_MAX, 2.5)
})

test('schedule copy maps the pickup zone and surge banner without fare fields', () => {
  const live = gameDayScheduleCopy({
    event: {
      title: 'Clemson vs. Wake Forest',
      pickup_zone_label: 'Lot 5 / Memorial Stadium',
      surge_multiplier: 4,
    },
    surge: {
      multiplier: 1.8,
      rule: { id: 'game_day', label: 'Game day' },
      fareCents: 6400,
    },
    purpose: 'game_day',
  })
  assert.equal(live.specialPickupLabel, 'Memorial Stadium · Lot 5')
  assert.equal(live.surgeBannerVisible, true)
  assert.equal(live.headline, 'Clemson vs. Wake Forest · Memorial Stadium · Lot 5 · 1.8×')
  assert.equal(live.detail, 'Pickup zone · Memorial Stadium · Lot 5 · Rider fare 1.8×')
  assert.equal(live.surgeBannerText, 'Surge · Game day 1.8×')
  assert.equal(live.body, GAME_DAY_SCHEDULE_LIVE_COPY)
  assert.equal(live.multiplierLabel, '1.8×')
  assert.doesNotMatch(JSON.stringify(live), /6400|\$|cents/)
  for (const key of Object.keys(live)) {
    assert.doesNotMatch(key, /cents|deposit|amount|fare/i)
  }

  const zoneOnly = gameDayScheduleCopy({
    event: { title: 'Game day', pickup_zone_label: 'West Campus', surge_multiplier: 1 },
    surge: { multiplier: 1, rule: null },
    purpose: 'planned',
  })
  assert.equal(zoneOnly.specialPickupLabel, 'West Campus')
  assert.equal(zoneOnly.surgeBannerVisible, false)
  assert.equal(zoneOnly.surgeBannerText, null)
  assert.equal(zoneOnly.multiplierLabel, null)
  assert.equal(zoneOnly.headline, 'Game day · West Campus')
  assert.equal(zoneOnly.detail, 'Pickup zone · West Campus')

  const noZone = gameDayScheduleCopy({
    event: { title: 'Clemson vs. NC State' },
    surge: { multiplier: 1, rule: { id: 'game_day', label: 'Game day' } },
  })
  assert.equal(noZone.specialPickupLabel, null)
  assert.equal(noZone.surgeBannerVisible, false)
  assert.equal(noZone.detail, 'Pickup zone is on the map')

  const weekend = gameDayScheduleCopy({
    event: null,
    surge: { multiplier: 1.2, rule: { id: 'weekend', label: 'Weekend' } },
    purpose: 'party_weekend',
  })
  assert.equal(weekend.headline, null)
  assert.equal(weekend.body, null)
  assert.equal(weekend.surgeBannerVisible, true)
  assert.equal(weekend.surgeBannerText, 'Surge · Weekend 1.2×')

  const off = gameDayScheduleCopy({ purpose: 'game_day' })
  assert.equal(off.surgeBannerVisible, false)
  assert.equal(off.specialPickupLabel, null)
  assert.equal(off.headline, null)
  assert.equal(off.body, GAME_DAY_SCHEDULE_OFF_COPY)
  assert.doesNotMatch(GAME_DAY_SCHEDULE_OFF_COPY, /\$|cents/)
  assert.doesNotMatch(GAME_DAY_SCHEDULE_LIVE_COPY, /\$|cents/)
  assert.match(GAME_DAY_SCHEDULE_TIME_COPY, /Game-day times are suggestions/)

  const presets = schedulePickupPresets([
    { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 },
    { label: 'Cooper Library', lat: 34.6757, lng: -82.8365 },
    { label: 'Skip me' },
  ], 'game_day')
  assert.equal(presets[0].label, 'Memorial Stadium · Lot 5')
  assert.equal(presets.filter((place) => place.label === 'Memorial Stadium').length, 1)
  assert.equal(presets.at(-1).label, 'Cooper Library')
  assert.equal(presets.some((place) => place.label === 'Skip me'), false)
  assert.deepEqual(
    schedulePickupPresets([{ label: 'Cooper Library', lat: 1, lng: 2 }], 'airport').map((place) => place.label),
    ['Cooper Library'],
  )
})

test('web schedule flow renders shared pickup labels and surge banner copy', () => {
  const root = new URL('..', import.meta.url)
  const planner = readFileSync(new URL('src/components/ScheduledRidePlanner.jsx', root), 'utf8')
  const rides = readFileSync(new URL('src/lib/scheduledRides.js', root), 'utf8')
  const quote = readFileSync(new URL('server/endpoints/quoteFare.js', root), 'utf8')
  const helper = readFileSync(new URL('shared/gameDayPickupCopy.js', root), 'utf8')

  assert.match(planner, /gameDayScheduleCopy/)
  assert.match(planner, /GAME_DAY_PICKUP_POINTS/)
  assert.match(planner, /data-testid="game-day-schedule-copy"/)
  assert.match(planner, /data-testid="game-day-pickup-points"/)
  assert.match(planner, /scheduleCopy\.surgeBannerText/)
  assert.match(planner, /scheduleCopy\.surgeWindowText/)
  assert.match(planner, /data-testid="game-day-surge-window"/)
  assert.match(planner, /specialPickupOptionLabel/)
  assert.match(planner, /eventPickupPointId/)
  const picker = readFileSync(new URL('src/components/PlacePicker.jsx', root), 'utf8')
  assert.match(picker, /menuLabel/)
  assert.match(rides, /gameDay: data\.gameDay \|\| null/)
  assert.match(quote, /zone: gameDayEvent\.pickup_zone_label/)
  assert.match(quote, /gameDayMultiplier = game\.multiplier/)
  assert.doesNotMatch(helper, /quoteFare|fareCents|resolveSurge|SURGE_RULES/)
  assert.match(helper, /Campus event surge window/)
  assert.doesNotMatch(helper, /\$\d/)
})

test('pickup option labels name the meeting spot and surge windows skip prices', () => {
  const lot = GAME_DAY_PICKUP_POINTS.find((row) => row.id === 'lot-5')
  const gate = GAME_DAY_PICKUP_POINTS.find((row) => row.id === 'memorial-stadium')
  assert.equal(specialPickupOptionLabel(lot), 'Memorial Stadium · Lot 5 — Lot 5 perimeter')
  assert.equal(specialPickupOptionLabel(gate), 'Memorial Stadium — Stadium gate')
  assert.notEqual(specialPickupOptionLabel(lot), specialPickupOptionLabel(gate))
  assert.equal(specialPickupOptionLabel(null), '')
  assert.equal(specialPickupOptionLabel({ label: 'West Campus' }), 'West Campus')
  assert.equal(eventPickupPointId('Lot 5 / Memorial Stadium'), 'lot-5')
  assert.equal(eventPickupPointId('Death Valley'), 'memorial-stadium')
  assert.equal(eventPickupPointId('West Campus'), null)

  const presets = schedulePickupPresets([
    { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 },
    { label: 'Cooper Library', lat: 34.6757, lng: -82.8365 },
  ], 'game_day')
  assert.equal(presets[0].menuLabel, 'Memorial Stadium · Lot 5 — Lot 5 perimeter')
  assert.equal(presets[0].detail, 'Lot 5 perimeter')
  assert.equal(presets.find((place) => place.label === 'Cooper Library').menuLabel, undefined)

  const live = gameDayScheduleCopy({
    event: {
      title: 'Clemson vs. Wake Forest',
      pickup_zone_label: 'Lot 5 / Memorial Stadium',
      surge_multiplier: 4,
    },
    surge: {
      multiplier: 1.8,
      rule: { id: 'game_day', label: 'Game day' },
      fareCents: 6400,
    },
    purpose: 'game_day',
  })
  assert.match(live.surgeWindowText, /Campus event surge window is on for Clemson vs\. Wake Forest/)
  assert.match(live.surgeWindowText, /event start to the event end/)
  assert.doesNotMatch(live.surgeWindowText, /6400|\$|cents|1\.8/)
  assert.equal(surgeWindowMessage({ multiplier: 1.8, rule: { id: 'game_day' } }, null),
    'Campus event surge window. A listed campus event uses the event start and end. With no listed event, fall Saturdays run from 11:00 AM until 11:00 PM Eastern.')

  const weekend = gameDayScheduleCopy({
    event: null,
    surge: { multiplier: 1.2, rule: { id: 'weekend', label: 'Weekend' }, fareCents: 4200 },
    purpose: 'party_weekend',
  })
  assert.equal(weekend.surgeWindowText, 'Weekend surge window. Friday 5:00 PM through Sunday, Eastern.')
  assert.doesNotMatch(weekend.surgeWindowText, /\$|cents|1\.2/)

  const airport = surgeWindowMessage({ multiplier: 1.35, rule: { id: 'airport_rush' } })
  assert.equal(airport, 'Airport rush window. 5:00–8:00 AM and 3:00–7:00 PM Eastern on airport trips.')
  assert.doesNotMatch(airport, /\$|cents|1\.35/)

  const generic = surgeWindowMessage({ multiplier: 1.5, rule: { id: 'other' } })
  assert.equal(generic, 'A surge window is on for this pickup time.')
  assert.equal(surgeWindowMessage({ multiplier: 1, fareCents: 99999 }), null)

  const off = gameDayScheduleCopy({ purpose: 'game_day' })
  assert.match(off.surgeWindowText, /No campus event surge window is on/)
  assert.match(off.surgeWindowText, /11:00 AM until 11:00 PM Eastern/)
  assert.doesNotMatch(off.surgeWindowText, /\$|cents/)
  assert.equal(gameDayScheduleCopy({ purpose: 'planned' }).surgeWindowText, null)
})
