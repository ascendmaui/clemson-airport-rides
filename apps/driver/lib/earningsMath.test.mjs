import assert from 'node:assert/strict'
import test from 'node:test'
import { reportPeriod, shiftAnchor } from './earningsMath.ts'

test('a completed trip lands in the September day bucket', () => {
  const report = reportPeriod(
    [
      {
        id: 't1',
        status: 'completed',
        fare_cents: 1000,
        completed_at: '2026-09-24T15:00:00Z',
        pickup_label: 'Campus',
        dropoff_label: 'Downtown',
      },
      {
        id: 't2',
        status: 'canceled',
        fare_cents: 500,
        completed_at: '2026-09-24T18:00:00Z',
      },
    ],
    'day',
    new Date('2026-09-24T16:00:00Z'),
  )
  assert.equal(report.completed, 1)
  assert.equal(report.canceled, 1)
  assert.equal(report.totalCents, 800)
  assert.equal(report.platformCents, 200)
  assert.equal(report.bars.reduce((sum, bar) => sum + bar.cents, 0), 800)
})

test('month view keeps a bar for every week and ignores other months', () => {
  const report = reportPeriod(
    [
      { id: 'a', status: 'completed', fare_cents: 500, completed_at: '2026-09-02T15:00:00Z' },
      { id: 'b', status: 'completed', fare_cents: 500, completed_at: '2026-08-31T15:00:00Z' },
    ],
    'month',
    new Date('2026-09-15T16:00:00Z'),
  )
  assert.equal(report.label, 'September')
  assert.ok(report.bars.length >= 4)
  assert.equal(report.completed, 1)
  assert.equal(report.previousLabel, 'Aug')
})

test('year view has twelve bars', () => {
  const report = reportPeriod([], 'year', new Date('2026-09-15T16:00:00Z'))
  assert.equal(report.bars.length, 12)
  assert.equal(report.label, '2026')
})

test('shifting the month anchor moves the label', () => {
  const next = shiftAnchor('month', new Date('2026-09-15T16:00:00Z'), -1)
  const report = reportPeriod([], 'month', next)
  assert.equal(report.label, 'August')
})
