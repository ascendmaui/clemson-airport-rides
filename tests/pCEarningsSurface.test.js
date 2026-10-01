/**
 * Parallel C. Earnings hub, details, and period buckets.
 * Bar placement is asserted. The 80/20 split is not re-derived here.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  currentWeekLabel,
  reportPeriod,
  shiftAnchor,
  straightLineMiles,
  tipCentsFromPayments,
} from '../apps/driver/lib/earningsMath.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

const hub = read('apps/driver/app/(tabs)/earnings.tsx')
const details = read('apps/driver/app/earnings-details.tsx')
const charts = read('apps/driver/components/charts.tsx')
const DAY = new Date('2026-09-24T16:00:00.000Z')

function trip(id, completedAt, status = 'completed') {
  return { id, status, fare_cents: 1000, completed_at: completedAt }
}

test('an empty week paints the standard 80/20/0 donut and signed-out copy', () => {
  assert.match(hub, /const standard = you \+ platform \+ other <= 0/)
  assert.match(hub, /label: 'You', value: 80/)
  assert.match(hub, /label: 'Clemson RIDES', value: 20/)
  assert.match(hub, /label: 'Other', value: 0/)
  assert.match(hub, /No completed trips yet\. The chart shows the standard split until one is on file\. You keep 80%\./)
  assert.match(hub, /title="Sign in to see earnings"/)
  assert.match(hub, /Completed trips, the 80% you keep, and your payout balance appear after you sign in\./)
  assert.match(hub, /No completed trips this week\. You keep 80% of each fare once a ride finishes\./)
  assert.match(hub, /earningsPrivate \? \([\s\S]*Amounts are hidden on this phone/)
  assert.match(hub, /<DonutChart segments=\{segments\} \/>/)
  assert.match(hub, /shownCents\(week, earningsPrivate\)/)
  assert.match(hub, /shownCents\(pending, earningsPrivate\)/)
  assert.match(hub, /accessibilityLabel="Cash out and more"/)
  assert.match(hub, /Nothing is waiting to pay out/)
  assert.match(hub, /This balance pays out when a Stripe transfer is due\./)
})

test('earnings details starts on month, hides the chart when private, and leaves rate stubs blank', () => {
  assert.match(details, /id: 'day', label: 'Day'/)
  assert.match(details, /id: 'week', label: 'Week'/)
  assert.match(details, /id: 'month', label: 'Month'/)
  assert.match(details, /id: 'year', label: 'Year'/)
  assert.match(details, /useState<EarningsPeriod>\('month'\)/)
  assert.match(details, /const quiet = report\.completed === 0 && report\.canceled === 0/)
  assert.match(details, /shiftAnchor\(period, current, -1\)/)
  assert.match(details, /shiftAnchor\(period, current, 1\)/)
  assert.match(details, /accessibilityLabel=\{report\.previousLabel\}/)
  assert.match(details, /accessibilityLabel=\{report\.nextLabel\}/)
  assert.match(details, /Night, morning, afternoon, and evening\. Bars use the 80% you keep\./)
  assert.match(details, /Bars use the 80% you keep after the platform fee\./)
  assert.match(details, /No earnings this day\. Finished rides add to the total\. Canceled rides stay at zero\./)
  assert.match(details, /The chart is hidden while earnings are private on this phone\./)
  assert.match(details, /per booked hour/)
  assert.match(details, /Not recorded in this build\./)
  assert.match(details, />Not recorded</)
  assert.match(details, /Hides dollar amounts on this phone\. Payouts still run on the account\./)
  assert.match(details, /label="Make earnings private"/)
  assert.match(details, /\{report\.completed\}/)
  assert.match(details, /\{report\.canceled\}/)
  assert.match(hub, /router\.push\('\/earnings-details'\)/)
})

test('the donut uses 48 slices and the capsule keeps a stub height for zero bars', () => {
  assert.match(charts, /const slices = 48/)
  assert.match(charts, /if \(total <= 0\)/)
  assert.match(charts, /paint\.push\(colors\.track\)/)
  assert.match(charts, /total <= 0 \? '—' : `\$\{Math\.round\(\(Math\.max\(0, segment\.value\) \/ total\) \* 100\)\}%`/)
  assert.match(charts, /const height = empty \? 10 : Math\.max\(22, Math\.round\(\(bar\.cents \/ max\) \* 112\)\)/)
  assert.match(charts, /width: bars\.length > 8 \? 10 : 16/)
  assert.match(charts, /empty \? colors\.segment : peak \? colors\.barPeak : colors\.bar/)
  assert.match(charts, /case 'you':/)
  assert.match(charts, /return colors\.purple/)
  assert.match(charts, /case 'platform':/)
  assert.match(charts, /return colors\.orange/)
})

test('empty periods keep their buckets at zero cents', () => {
  const day = reportPeriod([], 'day', DAY)
  assert.deepEqual(day.bars.map((bar) => bar.key), ['night', 'morning', 'afternoon', 'evening'])
  assert.deepEqual(day.bars.map((bar) => bar.label), ['Night', 'AM', 'Mid', 'PM'])
  assert.deepEqual(day.bars.map((bar) => bar.cents), [0, 0, 0, 0])
  assert.equal(day.label, 'Thursday, Sep 24')
  assert.equal(day.previousLabel, 'Sep 23')
  assert.equal(day.nextLabel, 'Sep 25')
  assert.equal(day.completed, 0)
  assert.equal(day.canceled, 0)
  assert.equal(day.totalCents, 0)

  const week = reportPeriod(null, 'week', DAY)
  assert.equal(week.bars.length, 7)
  assert.deepEqual(week.bars.map((bar) => bar.label), ['S', 'M', 'T', 'W', 'T', 'F', 'S'])
  assert.ok(week.bars.every((bar) => bar.cents === 0))
  assert.match(week.label, /Sep 20 – Sep 26/)
  assert.equal(currentWeekLabel(DAY), week.label)

  const month = reportPeriod(undefined, 'month', new Date('2026-09-15T16:00:00.000Z'))
  assert.equal(month.label, 'September')
  assert.equal(month.previousLabel, 'Aug')
  assert.equal(month.nextLabel, 'Oct')
  assert.deepEqual(month.bars.map((bar) => bar.label), ['9/1', '9/6', '9/13', '9/20', '9/27'])
  assert.ok(month.bars.every((bar) => bar.cents === 0))

  const year = reportPeriod([], 'year', new Date('2026-09-15T16:00:00.000Z'))
  assert.deepEqual(year.bars.map((bar) => bar.label), ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'])
  assert.deepEqual(year.bars.map((bar) => bar.key), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'])
  assert.equal(year.previousLabel, '2025')
  assert.equal(year.nextLabel, '2027')
  assert.equal(year.totalCents, 0)
})

test('day buckets follow New York hours and skip rows that are not completed', () => {
  const placed = reportPeriod([
    trip('night', '2026-09-24T09:30:00Z'),
    trip('morning', '2026-09-24T10:00:00Z'),
    trip('afternoon', '2026-09-24T16:00:00Z'),
    trip('evening', '2026-09-24T22:00:00Z'),
    trip('canceled', '2026-09-24T15:00:00Z', 'canceled'),
    trip('live', '2026-09-24T15:30:00Z', 'accepted'),
    { id: 'nodate', status: 'completed', fare_cents: 1000, completed_at: null },
    { id: 'baddate', status: 'completed', fare_cents: 1000, completed_at: 'nope' },
    { id: 'blank-status', fare_cents: 0, completed_at: '2026-09-24T15:00:00Z' },
  ], 'day', DAY)

  assert.equal(placed.completed, 5)
  assert.equal(placed.canceled, 1)
  assert.ok(placed.bars[0].cents > 0)
  assert.ok(placed.bars[1].cents > 0)
  assert.ok(placed.bars[2].cents > 0)
  assert.ok(placed.bars[3].cents > 0)
  assert.equal(placed.bars[0].cents, placed.bars[1].cents)
  assert.equal(placed.bars[1].cents, placed.bars[2].cents)
  assert.equal(placed.bars[2].cents, placed.bars[3].cents)
  assert.equal(
    placed.bars.reduce((sum, bar) => sum + bar.cents, 0),
    placed.totalCents,
  )
  assert.equal(placed.youCents, placed.totalCents)
  assert.ok(placed.platformCents >= 0)

  const edges = reportPeriod([
    trip('still-night', '2026-09-24T09:59:00Z'),
    trip('late-morning', '2026-09-24T15:59:00Z'),
    trip('late-afternoon', '2026-09-24T21:59:00Z'),
  ], 'day', DAY)
  assert.ok(edges.bars[0].cents > 0)
  assert.ok(edges.bars[1].cents > 0)
  assert.ok(edges.bars[2].cents > 0)
  assert.equal(edges.bars[3].cents, 0)
})

test('week, month, and year bars ignore trips outside the anchor', () => {
  const week = reportPeriod([
    trip('thu', '2026-09-24T16:00:00Z'),
    trip('prev', '2026-09-19T16:00:00Z'),
  ], 'week', DAY)
  const thursday = week.bars.find((bar) => bar.key === '9-24')
  assert.ok(thursday)
  assert.equal(thursday.label, 'T')
  assert.equal(thursday.cents, week.totalCents)
  assert.equal(week.completed, 1)
  assert.equal(week.bars.filter((bar) => bar.cents > 0).length, 1)

  const year = reportPeriod([
    trip('jan', '2026-01-15T16:00:00Z'),
    trip('mar', '2026-03-15T16:00:00Z'),
    trip('old', '2025-12-15T16:00:00Z'),
  ], 'year', new Date('2026-06-15T16:00:00.000Z'))
  assert.equal(year.completed, 2)
  assert.equal(year.bars[0].cents, year.bars[2].cents)
  assert.ok(year.bars[0].cents > 0)
  assert.equal(year.bars[1].cents, 0)
  assert.equal(year.bars[11].cents, 0)
})

test('shifting the anchor moves the New York period label', () => {
  const anchor = new Date('2026-06-15T16:00:00.000Z')
  const prevDay = shiftAnchor('day', anchor, -1)
  const nextDay = shiftAnchor('day', anchor, 1)
  assert.ok(prevDay.getTime() < anchor.getTime())
  assert.ok(nextDay.getTime() > anchor.getTime())
  assert.equal(reportPeriod([], 'year', shiftAnchor('year', anchor, 1)).label, '2027')
  assert.equal(reportPeriod([], 'year', shiftAnchor('year', anchor, -1)).label, '2025')
  assert.equal(reportPeriod([], 'month', shiftAnchor('month', new Date('2026-12-15T16:00:00.000Z'), 1)).label, 'January')
  assert.equal(reportPeriod([], 'month', shiftAnchor('month', new Date('2026-01-15T16:00:00.000Z'), -1)).label, 'December')
  const weekShift = shiftAnchor('week', DAY, 1)
  assert.ok(weekShift.getTime() - DAY.getTime() >= 6 * 24 * 60 * 60 * 1000)
  assert.ok(weekShift.getTime() - DAY.getTime() <= 8 * 24 * 60 * 60 * 1000)
})

test('tip rows feed Other and straight-line miles stay empty without two points', () => {
  assert.equal(tipCentsFromPayments(null), 0)
  assert.equal(tipCentsFromPayments(undefined), 0)
  assert.equal(tipCentsFromPayments([]), 0)
  assert.equal(tipCentsFromPayments([
    { kind: 'tip', amountCents: 250, status: 'succeeded' },
    { kind: 'tip', amount_cents: 100 },
    { kind: 'tip', amountCents: 40, status: 'failed' },
    { kind: 'tip', amountCents: 40, status: 'refunded' },
    { kind: 'tip', amountCents: 40, status: 'canceled' },
    { kind: 'fare', amountCents: 900, status: 'succeeded' },
    { kind: 'tip', amountCents: -20, status: 'succeeded' },
    { kind: 'tip', amountCents: 10.4, status: 'succeeded' },
  ]), 360)

  assert.equal(straightLineMiles(null, { latitude: 1, longitude: 1 }), null)
  assert.equal(straightLineMiles({ latitude: 1, longitude: 1 }, null), null)
  assert.equal(straightLineMiles(
    { latitude: 34.68, longitude: -82.84 },
    { latitude: 34.68, longitude: -82.84 },
  ), 0)
  assert.equal(straightLineMiles(
    { latitude: Number.NaN, longitude: 0 },
    { latitude: 1, longitude: 1 },
  ), null)
  const north = straightLineMiles(
    { latitude: 0, longitude: 0 },
    { latitude: 1, longitude: 0 },
  )
  assert.ok(north > 68 && north < 70)
  assert.equal(straightLineMiles(
    { latitude: 1, longitude: 0 },
    { latitude: 0, longitude: 0 },
  ), north)
})
