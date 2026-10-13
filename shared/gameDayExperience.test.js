import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSurge, SURGE_MAX } from '../src/lib/fareRates.js'
import {
  DEFAULT_PREP,
  DEFAULT_WINDOWS,
  DEFAULT_ZONES,
  GAME_DAY_ORANGE,
  GAME_DAY_PURPLE,
  SURGE_CAP,
  buildGameDayExperience,
  clampSurge,
  deriveQueueStatus,
  estimateWaitMinutes,
  kickoffBanner,
  postGameQueue,
  prepChecklist,
  rawGameDayMultiplier,
  readCalendarBonus,
  readDriverBonus,
  saturdayGameDay,
  selectGameDayEvent,
  surgeTransparency,
  zoneGuide,
  zoneHotTimeline,
} from './gameDayExperience.js'

const WEDNESDAY = new Date('2026-10-14T16:00:00.000Z')
const SATURDAY = new Date('2026-10-10T16:00:00.000Z')

function game(overrides = {}) {
  return {
    id: 'game-1',
    title: 'Home game',
    active: true,
    starts_at: '2026-10-14T18:00:00.000Z',
    ends_at: '2026-10-14T22:00:00.000Z',
    surge_multiplier: 2.1,
    pickup_zone_label: 'North plaza',
    ...overrides,
  }
}

test('brand colors and the fare cap stay published', () => {
  assert.equal(GAME_DAY_ORANGE, '#F56600')
  assert.equal(GAME_DAY_PURPLE, '#522D80')
  assert.equal(SURGE_CAP, SURGE_MAX)
  assert.equal(clampSurge(9), 2.5)
  assert.equal(clampSurge(0), 1)
})

test('Saturday game-day window matches the fare engine', () => {
  assert.equal(saturdayGameDay(SATURDAY), true)
  assert.equal(saturdayGameDay(WEDNESDAY), false)
  assert.equal(saturdayGameDay(new Date('2026-10-10T14:00:00.000Z')), false)
  assert.equal(saturdayGameDay(new Date('2026-12-12T16:00:00.000Z')), false)
  for (const at of [WEDNESDAY, SATURDAY, new Date('2026-10-10T20:30:00.000Z'), new Date('2026-11-07T16:00:00.000Z')]) {
    const matched = resolveSurge({ at, gameDayMultiplier: null }).matched.find((rule) => rule.id === 'game_day')
    const fromRules = matched ? matched.multiplier : 1
    const fromBoard = clampSurge(rawGameDayMultiplier(null, at))
    assert.equal(fromBoard, fromRules, at.toISOString())
  }
})

test('a live scheduled game uses the higher of the event rate and Saturday', () => {
  const liveSaturday = game({
    starts_at: '2026-10-10T15:00:00.000Z',
    ends_at: '2026-10-10T22:00:00.000Z',
    surge_multiplier: 2.1,
  })
  assert.equal(clampSurge(rawGameDayMultiplier(liveSaturday, SATURDAY)), resolveSurge({
    at: SATURDAY,
    gameDayMultiplier: 2.1,
  }).multiplier)

  const quieter = { ...liveSaturday, surge_multiplier: 1.5 }
  const quiet = surgeTransparency({ event: quieter, now: SATURDAY, phase: 'live' })
  assert.equal(quiet.multiplier, 1.8)
  assert.equal(quiet.source, 'saturday')
  assert.match(quiet.reasons.join(' '), /higher rate is charged/)

  const capped = surgeTransparency({
    event: { ...quieter, surge_multiplier: 4 },
    now: WEDNESDAY,
    phase: 'live',
  })
  const wednesdayLive = { ...quieter, starts_at: '2026-10-14T15:00:00.000Z', ends_at: '2026-10-14T22:00:00.000Z', surge_multiplier: 4 }
  const cappedLive = surgeTransparency({ event: wednesdayLive, now: WEDNESDAY, phase: 'live' })
  assert.equal(cappedLive.multiplier, 2.5)
  assert.equal(cappedLive.capped, true)
  assert.match(capped.reasons.join(' ') + cappedLive.reasons.join(' '), /published cap/)
})

test('countdown names kickoff and the rate that starts then', () => {
  const model = buildGameDayExperience({ now: WEDNESDAY, events: [game()] })
  assert.equal(model.phase, 'countdown')
  assert.equal(model.banner.countdownCaption, 'Until kickoff')
  assert.equal(model.banner.countdownLabel, '2h 0m')
  assert.equal(model.surge.multiplier, 1)
  assert.equal(model.surge.upcomingLabel, '2.1×')
  assert.match(model.surge.driverLine, /Before you go online/)
  assert.match(model.surge.riderLine, /until kickoff/)
  assert.equal(model.queue.status, 'closed')
  assert.equal(model.zones.pickups.length, 2)
  assert.equal(model.zones.dropoffs.length, 2)
})

test('selects the highest live multiplier, then the next kickoff, then a recent ending', () => {
  const now = new Date('2026-10-14T19:00:00.000Z')
  const low = game({ id: 'low', surge_multiplier: 1.4, starts_at: '2026-10-14T18:00:00.000Z', ends_at: '2026-10-14T23:00:00.000Z' })
  const high = game({ id: 'high', surge_multiplier: 2.2, starts_at: '2026-10-14T18:00:00.000Z', ends_at: '2026-10-14T23:00:00.000Z' })
  assert.equal(selectGameDayEvent([low, high], now).id, 'high')
  const later = game({ id: 'later', starts_at: '2026-10-16T18:00:00.000Z', ends_at: '2026-10-16T22:00:00.000Z' })
  const sooner = game({ id: 'sooner', starts_at: '2026-10-15T18:00:00.000Z', ends_at: '2026-10-15T22:00:00.000Z' })
  assert.equal(selectGameDayEvent([later, sooner], WEDNESDAY).id, 'sooner')
  const ended = game({ id: 'ended', starts_at: '2026-10-14T12:00:00.000Z', ends_at: '2026-10-14T15:00:00.000Z' })
  assert.equal(selectGameDayEvent([ended], WEDNESDAY).id, 'ended')
  assert.equal(selectGameDayEvent([{ ...ended, ends_at: '2026-10-13T12:00:00.000Z' }], WEDNESDAY), null)
})

test('post-game queue uses a fresh snapshot and otherwise says the line is forming', () => {
  const now = new Date('2026-10-14T22:30:00.000Z')
  const ended = game({ starts_at: '2026-10-14T18:00:00.000Z', ends_at: '2026-10-14T22:00:00.000Z' })
  const forming = buildGameDayExperience({ now, events: [ended] })
  assert.equal(forming.phase, 'postgame')
  assert.equal(forming.queue.status, 'forming')
  assert.match(forming.banner.kicker, /POST-GAME/)

  const open = buildGameDayExperience({
    now,
    events: [ended],
    queue: {
      status: 'open',
      riders_waiting: 8,
      drivers_staged: 4,
      wait_minutes: 12,
      updated_at: now.toISOString(),
      note: 'North plaza is moving.',
    },
  })
  assert.equal(open.queue.status, 'open')
  assert.equal(open.queue.waitLabel, '12 min')
  assert.match(open.queue.detail, /North plaza is moving/)

  const stale = postGameQueue({
    phase: 'postgame',
    now,
    snapshot: { status: 'paused', riders_waiting: 3, drivers_staged: 1, updated_at: '2026-10-13T00:00:00.000Z' },
  })
  assert.equal(stale.status, 'forming')
  assert.equal(deriveQueueStatus({ ridersWaiting: 9, driversStaged: 2 }), 'busy')
  assert.equal(deriveQueueStatus({ ridersWaiting: 2, driversStaged: 2 }), 'open')
  assert.equal(estimateWaitMinutes(0, 3), 0)
})

test('driver prep, hot times, and the zone bonus stay off the rider fare', () => {
  const now = new Date('2026-10-14T19:00:00.000Z')
  const live = game({ starts_at: '2026-10-14T18:00:00.000Z', ends_at: '2026-10-14T23:00:00.000Z', surge_multiplier: 2 })
  const model = buildGameDayExperience({
    now,
    events: [live],
    checkedIds: ['charge', 'surge'],
    surgeConfig: { enabled: true, driverBonusCents: 300, zoneBoost: 1, radiusKm: 1.5 },
    calendarEvents: [{
      active: true,
      title: 'Move-in',
      kind: 'move_in',
      driver_bonus_cents: 500,
      bonus_starts_at: '2026-10-14T18:00:00.000Z',
      bonus_ends_at: '2026-10-14T23:00:00.000Z',
    }],
  })
  assert.equal(model.prep.done, 2)
  assert.equal(model.prep.total, DEFAULT_PREP.length)
  assert.equal(model.surge.multiplier, 2)
  assert.match(model.surge.driverBonusLabel, /\$3 per completed stadium trip/)
  assert.match(model.surge.calendarBonusLabel, /\$5 per completed trip/)
  assert.match(model.surge.reasons.join(' '), /favored for matching/)
  const current = model.timeline.windows.find((row) => row.state === 'now')
  assert.equal(current.label, 'In the seats')
  assert.equal(model.timeline.windows.length, DEFAULT_WINDOWS.length)
  assert.equal(readDriverBonus({ driverBonusCents: 300 }, 'countdown'), null)
  assert.equal(readCalendarBonus([{ driver_bonus_cents: 0, bonus_starts_at: live.starts_at, bonus_ends_at: live.ends_at }], now), null)
})

test('a campus calendar kickoff does not invent a fare, and an empty board still has the guide', () => {
  const model = buildGameDayExperience({
    now: new Date('2026-10-12T16:00:00.000Z'),
    calendarEvents: [{
      id: 'cal-1',
      active: true,
      kind: 'football_home',
      title: 'Home game',
      event_date: '2026-10-17',
      ends_on: '2026-10-17',
    }],
  })
  assert.equal(model.phase, 'countdown')
  assert.equal(model.eventId, null)
  assert.equal(model.banner.title, 'Home game')
  assert.equal(model.surge.driverBonusLabel, null)
  assert.ok(model.banner.countdownLabel)
  const quiet = buildGameDayExperience({ now: WEDNESDAY })
  assert.equal(quiet.phase, 'off')
  assert.equal(quiet.banner.title, 'No game on the board')
  assert.equal(quiet.queue.visible, false)
  assert.equal(zoneGuide(DEFAULT_ZONES).pickups[0].name, 'North plaza')
  const prep = prepChecklist(null, [])
  assert.equal(prep.items[0].checked, false)
  const timeline = zoneHotTimeline(null, null, WEDNESDAY)
  assert.match(timeline.windows[0].whenLabel, /before/)
  const banner = kickoffBanner(null, WEDNESDAY)
  assert.equal(banner.phase, 'off')
})
