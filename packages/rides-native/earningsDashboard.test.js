import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  bonusLabel,
  forecastHighlights,
  formatBestWindow,
  nextDailyPayoutAt,
  payoutTimeline,
  rideDetails,
  streakBoard,
  tipsBreakdown,
} from './earningsDashboard.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

const trip = {
  id: 't1',
  status: 'completed',
  fare_cents: 2500,
  completed_at: '2026-10-12T18:00:00Z',
  pickup_label: 'Campus',
  dropoff_label: 'Downtown',
  metadata: { payout: { status: 'paid', amountCents: 2000, paidAt: '2026-10-13T12:05:00Z' } },
}

test('tips breakdown keeps succeeded tips and drops failed ones', () => {
  const report = tipsBreakdown(
    [trip, { ...trip, id: 't2', dropoff_label: 'GSP', completed_at: '2026-10-12T20:00:00Z' }],
    {
      t1: [
        { kind: 'tip', amountCents: 300, status: 'succeeded' },
        { kind: 'tip', amount_cents: 100, status: 'refunded' },
        { kind: 'fare', amountCents: 2500, status: 'succeeded' },
      ],
      t2: [{ kind: 'tip', amountCents: 500, status: 'succeeded' }],
    },
  )
  assert.equal(report.tipCents, 800)
  assert.equal(report.tippedRides, 2)
  assert.equal(report.averageTipCents, 400)
  assert.equal(report.rides[0].label, 'GSP')
  assert.ok(report.shareOfTake > 0 && report.shareOfTake < 1)
})

test('streak board maps perk progress and bonus labels', () => {
  const board = streakBoard({
    streaks: {
      trips: { enabled: true, current: 7, target: 10, toNext: 3, progress: 0.7, bonusCents: 1000 },
      days: { enabled: false, current: 2, target: 5, toNext: 3, progress: 0.4, bonusCents: 1500 },
    },
    bonuses: [
      { kind: 'streak_trips', amountCents: 1000, status: 'paid', at: '2026-10-01T12:00:00Z' },
      { kind: 'streak_days', amountCents: 1500, status: 'pending', at: '2026-10-11T12:00:00Z' },
    ],
  })
  assert.equal(board.available, true)
  assert.equal(board.cards.length, 1)
  assert.equal(board.cards[0].title, 'Trip streak')
  assert.equal(board.cards[0].toNext, 3)
  assert.equal(board.bonuses[0].label, 'Trip streak bonus')
  assert.equal(bonusLabel('streak_days'), 'Day streak bonus')
  assert.equal(streakBoard(null).available, false)
})

test('forecast highlights keep the best hour per zone', () => {
  const stadium = {
    zone: 'stadium',
    zoneLabel: 'Memorial Stadium',
    startsAt: '2026-10-15T00:00:00Z',
    endsAt: '2026-10-15T02:00:00Z',
    expectedCentsPerHour: 4200,
    confidence: 'medium',
    reasons: ['Home game'],
  }
  const downtown = {
    zone: 'downtown',
    zoneLabel: 'Downtown / College Ave bars',
    startsAt: '2026-10-18T00:00:00Z',
    endsAt: '2026-10-18T02:00:00Z',
    expectedCentsPerHour: 2800,
    confidence: 'low',
    reasons: ['Typical demand for this time'],
  }
  const highlights = forecastHighlights({
    lowData: true,
    disclaimer: 'Estimate only.',
    eventsNote: null,
    top: [stadium, { ...stadium, expectedCentsPerHour: 1000, startsAt: '2026-10-16T00:00:00Z', endsAt: '2026-10-16T02:00:00Z' }, downtown],
  }, 2)
  assert.equal(highlights.available, true)
  assert.equal(highlights.hours.length, 2)
  assert.equal(highlights.hours[0].zoneLabel, 'Memorial Stadium')
  assert.equal(highlights.zones.length, 2)
  assert.equal(highlights.zones[0].expectedCentsPerHour, 4200)
  assert.match(formatBestWindow(stadium), /–/)
  assert.equal(forecastHighlights(null).available, false)
})

test('next payout lands on the daily 12:00 UTC sweep', () => {
  assert.equal(nextDailyPayoutAt(Date.parse('2026-10-13T11:00:00Z')), Date.parse('2026-10-13T12:00:00Z'))
  assert.equal(nextDailyPayoutAt(Date.parse('2026-10-13T15:00:00Z')), Date.parse('2026-10-14T12:00:00Z'))
  assert.equal(nextDailyPayoutAt(Date.parse('2026-10-13T12:00:00Z')), Date.parse('2026-10-13T12:00:00Z'))
  const timeline = payoutTimeline({
    trips: [trip, {
      id: 't9',
      status: 'completed',
      fare_cents: 1000,
      completed_at: '2026-10-12T22:00:00Z',
      dropoff_label: 'CLT',
      metadata: { payout: { status: 'pending', amountCents: 800, nextRetryAt: '2026-10-15T18:00:00Z' } },
    }],
    payouts: {
      paidCents: 2000,
      pendingCents: 800,
      pending: [{ amountCents: 800, nextRetryAt: '2026-10-15T18:00:00Z', dropoffLabel: 'CLT' }],
    },
    bonuses: [{ kind: 'streak_days', label: 'Day streak bonus', amountCents: 1500, status: 'pending', at: '2026-10-11T12:00:00Z' }],
    now: Date.parse('2026-10-13T15:00:00Z'),
  })
  assert.equal(timeline.etaAt, Date.parse('2026-10-16T12:00:00Z'))
  assert.equal(timeline.waitingCents, 2300)
  assert.equal(timeline.history[0].label, 'Downtown')
  assert.equal(timeline.history[0].status, 'paid')
})

test('a due payout waits for the next sweep, not a past one', () => {
  const timeline = payoutTimeline({
    payouts: { pendingCents: 500, pending: [{ amountCents: 500, nextRetryAt: '2026-10-13T10:00:00Z' }] },
    now: Date.parse('2026-10-13T15:00:00Z'),
  })
  assert.equal(timeline.etaAt, Date.parse('2026-10-14T12:00:00Z'))
})

test('per-ride details include tip, boost, and carpool bonus', () => {
  const rows = rideDetails(
    [{
      ...trip,
      metadata: {
        kind: 'carpool',
        driver_payout_cents: 3600,
        incentive_id: 'driver_carpool_bonus',
        boost_cents: 200,
        carpool: { driver: { payoutCents: 3600, soloPayoutCents: 2400, carpoolBonusCents: 1200, incentiveId: 'driver_carpool_bonus' } },
        payout: { status: 'pending', amountCents: 3800 },
      },
    }, {
      id: 'gone',
      status: 'canceled',
      fare_cents: 900,
      completed_at: '2026-10-12T19:00:00Z',
    }],
    { t1: [{ kind: 'tip', amountCents: 400, status: 'succeeded' }] },
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].tipCents, 400)
  assert.equal(rows[0].carpoolBonusCents, 1200)
  assert.ok(rows[0].boostCents > 0)
  assert.equal(rows[0].payoutStatus, 'pending')
  assert.equal(rows[0].pickup, 'Campus')
})

test('the earnings dashboard uses the brand colors and does not name a car company', () => {
  const board = read('apps/driver/components/EarningsBoard.tsx')
  const screen = read('apps/driver/app/(tabs)/earnings.tsx')
  const palette = read('apps/driver/lib/palette.ts')
  const combined = `${board}\n${screen}`
  assert.match(palette, /#F56600/)
  assert.match(palette, /#522D80/)
  assert.match(palette, /#0E0B14/)
  assert.match(combined, /Tips/)
  assert.match(combined, /Trip streak|Streaks/)
  assert.match(combined, /Best hours/)
  assert.match(combined, /Zones/)
  assert.match(combined, /next payout/i)
  assert.match(combined, /Day/)
  assert.match(combined, /Week/)
  assert.match(combined, /Month/)
  assert.match(board, /colors\.orange/)
  assert.match(board, /colors\.purple/)
  assert.match(board, /scheme === 'dark'/)
  const banned = ['te', 'sla'].join('')
  assert.equal(combined.toLowerCase().includes(banned), false)
})
