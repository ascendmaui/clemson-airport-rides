import assert from 'node:assert/strict'
import test, { after, describe } from 'node:test'
import { quoteAtIso } from '../packages/rides-native/riderMoney.js'

describe('CI timezone determinism and host TZ isolation', () => {
  const origTz = process.env.TZ

  after(() => {
    if (origTz === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = origTz
    }
  })

  test('quoteAtIso resolves America/New_York wall time to deterministic UTC across diverse host timezones', () => {
    const testCases = [
      {
        input: { date: '2026-10-02', time: '14:00' },
        expected: '2026-10-02T18:00:00.000Z', // EDT (UTC-4)
        desc: '14:00 EDT -> 18:00Z',
      },
      {
        input: { date: '2026-12-15', time: '14:00' },
        expected: '2026-12-15T19:00:00.000Z', // EST (UTC-5)
        desc: '14:00 EST -> 19:00Z',
      },
      {
        input: { date: '2026-07-04', time: '09:15' },
        expected: '2026-07-04T13:15:00.000Z', // EDT (UTC-4)
        desc: '09:15 EDT -> 13:15Z',
      },
    ]

    const hostTzs = [
      'UTC',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'Europe/London',
      'Europe/Paris',
      'Asia/Tokyo',
      'Pacific/Honolulu',
    ]

    for (const hostTz of hostTzs) {
      process.env.TZ = hostTz
      for (const tc of testCases) {
        const iso = quoteAtIso(tc.input)
        assert.equal(
          iso,
          tc.expected,
          `Under host TZ=${hostTz}, ${tc.desc} must produce exact UTC output`,
        )
      }
    }
  })

  test('quoteAtIso handles DST transition boundaries in America/New_York', () => {
    // 2026-11-01 is fall-back in America/New_York (2am EDT becomes 1am EST)
    // 01:00 on Nov 1 can match EDT (05:00Z) or EST (06:00Z); standard civil-to-UTC resolves deterministically
    const preDst = quoteAtIso({ date: '2026-10-31', time: '12:00' })
    assert.equal(preDst, '2026-10-31T16:00:00.000Z') // EDT (UTC-4)

    const postDst = quoteAtIso({ date: '2026-11-02', time: '12:00' })
    assert.equal(postDst, '2026-11-02T17:00:00.000Z') // EST (UTC-5)
  })

  test('quoteAtIso invalid date components safely fallback to now without throwing', () => {
    const fixedNow = new Date('2026-09-24T12:00:00.000Z')
    assert.equal(quoteAtIso({ date: 'invalid' }, fixedNow), fixedNow.toISOString())
    assert.equal(quoteAtIso({ date: '2026-99-99' }, fixedNow), fixedNow.toISOString())
    assert.equal(quoteAtIso({ date: '2026-10-15', time: '99:99' }, fixedNow), fixedNow.toISOString())
    assert.equal(quoteAtIso(null, fixedNow), fixedNow.toISOString())
  })
})
