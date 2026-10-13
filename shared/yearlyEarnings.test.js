import test from 'node:test'
import assert from 'node:assert/strict'
import { buildYearlyEarningsSummary } from './yearlyEarnings.js'
import { platformFeeCents } from './platformFee.js'

const NOW = new Date('2026-08-15T16:00:00.000Z')

test('yearly summary keeps tips out of the platform fee and adds bonuses', () => {
  const summary = buildYearlyEarningsSummary({
    year: 2026,
    now: NOW,
    trips: [
      {
        status: 'completed',
        fare_cents: 10000,
        tip_cents: 500,
        completed_at: '2026-03-15T16:00:00.000Z',
        metadata: { boost_cents: 300 },
      },
      {
        status: 'completed',
        fare_cents: 4000,
        tip_cents: 0,
        completed_at: '2025-11-02T16:00:00.000Z',
      },
    ],
    bonuses: [
      { amount_cents: 1000, status: 'paid', created_at: '2026-03-20T16:00:00.000Z' },
      { amount_cents: 9000, status: 'void', created_at: '2026-03-21T16:00:00.000Z' },
    ],
    mileageDeductionCents: 1000,
    payoutsCents: 8000,
  })

  assert.equal(summary.grossFareCents, 10000)
  assert.equal(summary.tipsCents, 500)
  assert.equal(summary.platformFeeCents, platformFeeCents(10000))
  assert.notEqual(summary.platformFeeCents, platformFeeCents(10000 + 500))
  assert.equal(summary.bonusPerkCents, 1300)
  assert.equal(summary.netEarningsCents, 10000 - 2000 + 500 + 1300)
  assert.equal(summary.netPayoutCents, 8000)
  assert.equal(summary.throughMonth, 8)
  assert.equal(summary.months.length, 8)
  assert.equal(summary.months[2].label, 'March')
  assert.equal(summary.months[2].tipsCents, 500)
  assert.equal(summary.months[2].platformFeeCents, 2000)
  assert.equal(summary.months[2].bonusPerkCents, 1300)
  assert.equal(summary.months[2].netCents, summary.netEarningsCents)
  assert.equal(summary.months[0].netCents, 0)
  const taxable = summary.netEarningsCents - 1000
  assert.equal(summary.taxEstimate.taxableEarningsCents, taxable)
  assert.equal(summary.taxEstimate.mileageDeductionCents, 1000)
  const seBase = Math.round((taxable * 9235) / 10000)
  assert.equal(summary.taxEstimate.selfEmploymentTaxCents, Math.round((seBase * 153) / 1000))
  assert.match(summary.taxEstimate.note, /not tax advice/i)
})

test('a past year lists every month and the current year stops at this month', () => {
  const past = buildYearlyEarningsSummary({
    year: 2025,
    now: NOW,
    trips: [{
      status: 'completed',
      fareCents: 5000,
      tipCents: 200,
      platformFeeCents: 1000,
      boostCents: 0,
      completedAt: '2025-12-15T16:00:00.000Z',
    }],
    payoutsCents: 4200,
    mileageDeductionCents: 0,
  })
  assert.equal(past.months.length, 12)
  assert.equal(past.months[11].label, 'December')
  assert.equal(past.grossFareCents, 5000)
  assert.equal(past.tipsCents, 200)
  assert.equal(past.platformFeeCents, 1000)
  assert.equal(past.netEarningsCents, 5000 - 1000 + 200)
  assert.equal(past.netPayoutCents, 4200)
})
