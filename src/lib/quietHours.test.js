import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { DEFAULT_QUIET, isQuietNow, quietFromPrefs } from './quietHours.js'

describe('DEFAULT_QUIET', () => {
  test('exports default quiet configuration', () => {
    assert.deepEqual(DEFAULT_QUIET, {
      dnd: false,
      scheduleEnabled: false,
      start: '22:00',
      end: '07:00',
    })
  })
})

describe('quietFromPrefs', () => {
  test('returns default values when input is null, undefined, or empty', () => {
    assert.deepEqual(quietFromPrefs(null), DEFAULT_QUIET)
    assert.deepEqual(quietFromPrefs(undefined), DEFAULT_QUIET)
    assert.deepEqual(quietFromPrefs({}), DEFAULT_QUIET)
    assert.deepEqual(quietFromPrefs('invalid'), DEFAULT_QUIET)
    assert.deepEqual(quietFromPrefs(123), DEFAULT_QUIET)
  })

  test('returns default values when quiet property is not an object', () => {
    assert.deepEqual(quietFromPrefs({ quiet: null }), DEFAULT_QUIET)
    assert.deepEqual(quietFromPrefs({ quiet: 'disabled' }), DEFAULT_QUIET)
    assert.deepEqual(quietFromPrefs({ quiet: 42 }), DEFAULT_QUIET)
    assert.deepEqual(quietFromPrefs({ quiet: true }), DEFAULT_QUIET)
  })

  test('parses valid quiet settings', () => {
    const prefs = {
      quiet: {
        dnd: true,
        scheduleEnabled: true,
        start: '23:30',
        end: '06:15',
      },
    }
    assert.deepEqual(quietFromPrefs(prefs), {
      dnd: true,
      scheduleEnabled: true,
      start: '23:30',
      end: '06:15',
    })
  })

  test('coerces dnd and scheduleEnabled to booleans', () => {
    assert.equal(quietFromPrefs({ quiet: { dnd: 1 } }).dnd, true)
    assert.equal(quietFromPrefs({ quiet: { dnd: 0 } }).dnd, false)
    assert.equal(quietFromPrefs({ quiet: { dnd: 'yes' } }).dnd, true)
    assert.equal(quietFromPrefs({ quiet: { dnd: '' } }).dnd, false)
    assert.equal(quietFromPrefs({ quiet: { scheduleEnabled: 1 } }).scheduleEnabled, true)
    assert.equal(quietFromPrefs({ quiet: { scheduleEnabled: null } }).scheduleEnabled, false)
  })

  test('falls back to default times when start or end are malformed', () => {
    assert.equal(quietFromPrefs({ quiet: { start: 'morning' } }).start, '22:00')
    assert.equal(quietFromPrefs({ quiet: { start: '2pm' } }).start, '22:00')
    assert.equal(quietFromPrefs({ quiet: { start: null } }).start, '22:00')
    assert.equal(quietFromPrefs({ quiet: { start: 1000 } }).start, '22:00')
    assert.equal(quietFromPrefs({ quiet: { end: 'sunset' } }).end, '07:00')
    assert.equal(quietFromPrefs({ quiet: { end: '' } }).end, '07:00')
    assert.equal(quietFromPrefs({ quiet: { end: undefined } }).end, '07:00')

    // BUG?: hhmm rejects single-digit hours like '9:00' because of /^\d{2}:\d{2}$/ regex, falling back to default
    assert.equal(quietFromPrefs({ quiet: { start: '9:00' } }).start, '22:00')
    assert.equal(quietFromPrefs({ quiet: { end: '7:00' } }).end, '07:00')

    // BUG?: hhmm regex allows invalid time strings like '99:99' or '25:70' due to lack of 24h range validation
    assert.equal(quietFromPrefs({ quiet: { start: '99:99' } }).start, '99:99')
  })
})

describe('isQuietNow', () => {
  // Helper to create a local Date at specified hour and minute
  function localTime(hour, minute) {
    return new Date(2026, 8, 25, hour, minute, 0)
  }

  test('returns true when DND is enabled regardless of schedule or current time', () => {
    const prefs = { quiet: { dnd: true, scheduleEnabled: false } }
    assert.equal(isQuietNow(prefs, localTime(12, 0)), true)
    assert.equal(isQuietNow(prefs, localTime(3, 0)), true)
    assert.equal(isQuietNow(prefs, localTime(22, 30)), true)
  })

  test('returns false when schedule is disabled and DND is false', () => {
    const prefs = {
      quiet: {
        dnd: false,
        scheduleEnabled: false,
        start: '22:00',
        end: '07:00',
      },
    }
    // Even during the quiet window hours, returns false when schedule is disabled
    assert.equal(isQuietNow(prefs, localTime(23, 0)), false)
    assert.equal(isQuietNow(prefs, localTime(3, 0)), false)
    assert.equal(isQuietNow(prefs, localTime(14, 0)), false)
  })

  test('returns false for null, undefined, or empty prefs', () => {
    assert.equal(isQuietNow(null, localTime(23, 0)), false)
    assert.equal(isQuietNow(undefined, localTime(3, 0)), false)
    assert.equal(isQuietNow({}, localTime(23, 0)), false)
  })

  describe('overnight window crossing midnight (22:00 to 07:00)', () => {
    const prefs = {
      quiet: {
        dnd: false,
        scheduleEnabled: true,
        start: '22:00',
        end: '07:00',
      },
    }

    test('is inactive before start time', () => {
      assert.equal(isQuietNow(prefs, localTime(21, 59)), false)
      assert.equal(isQuietNow(prefs, localTime(12, 0)), false)
      assert.equal(isQuietNow(prefs, localTime(18, 30)), false)
    })

    test('is active at exactly start time (inclusive start)', () => {
      assert.equal(isQuietNow(prefs, localTime(22, 0)), true)
    })

    test('is active during late night hours before midnight', () => {
      assert.equal(isQuietNow(prefs, localTime(22, 1)), true)
      assert.equal(isQuietNow(prefs, localTime(23, 30)), true)
      assert.equal(isQuietNow(prefs, localTime(23, 59)), true)
    })

    test('is active at midnight', () => {
      assert.equal(isQuietNow(prefs, localTime(0, 0)), true)
    })

    test('is active during early morning hours after midnight', () => {
      assert.equal(isQuietNow(prefs, localTime(1, 30)), true)
      assert.equal(isQuietNow(prefs, localTime(4, 0)), true)
      assert.equal(isQuietNow(prefs, localTime(6, 59)), true)
    })

    test('is inactive at and after end time (exclusive end)', () => {
      assert.equal(isQuietNow(prefs, localTime(7, 0)), false)
      assert.equal(isQuietNow(prefs, localTime(7, 1)), false)
      assert.equal(isQuietNow(prefs, localTime(10, 0)), false)
    })
  })

  describe('daytime window not crossing midnight (08:00 to 17:00)', () => {
    const prefs = {
      quiet: {
        dnd: false,
        scheduleEnabled: true,
        start: '08:00',
        end: '17:00',
      },
    }

    test('is inactive before daytime start', () => {
      assert.equal(isQuietNow(prefs, localTime(7, 59)), false)
      assert.equal(isQuietNow(prefs, localTime(0, 0)), false)
    })

    test('is active at daytime start boundary (inclusive start)', () => {
      assert.equal(isQuietNow(prefs, localTime(8, 0)), true)
    })

    test('is active during midday', () => {
      assert.equal(isQuietNow(prefs, localTime(12, 0)), true)
      assert.equal(isQuietNow(prefs, localTime(16, 59)), true)
    })

    test('is inactive at and after daytime end (exclusive end)', () => {
      assert.equal(isQuietNow(prefs, localTime(17, 0)), false)
      assert.equal(isQuietNow(prefs, localTime(17, 1)), false)
      assert.equal(isQuietNow(prefs, localTime(22, 0)), false)
    })
  })

  describe('edge cases and malformed schedules', () => {
    test('treats equal start and end time as 24-hour quiet window', () => {
      const prefs = {
        quiet: {
          dnd: false,
          scheduleEnabled: true,
          start: '12:00',
          end: '12:00',
        },
      }
      // BUG?: start === end treats equal start and end times as a 24-hour quiet period rather than a 0-hour window
      assert.equal(isQuietNow(prefs, localTime(12, 0)), true)
      assert.equal(isQuietNow(prefs, localTime(0, 0)), true)
      assert.equal(isQuietNow(prefs, localTime(6, 0)), true)
      assert.equal(isQuietNow(prefs, localTime(18, 0)), true)
    })

    test('falls back to default schedule when times are invalid', () => {
      const prefs = {
        quiet: {
          dnd: false,
          scheduleEnabled: true,
          start: 'invalid',
          end: 'corrupt',
        },
      }
      // Falls back to 22:00 - 07:00
      assert.equal(isQuietNow(prefs, localTime(23, 0)), true)
      assert.equal(isQuietNow(prefs, localTime(12, 0)), false)
    })

    test('uses current system time when now argument is omitted', () => {
      const prefsDnd = { quiet: { dnd: true } }
      assert.equal(isQuietNow(prefsDnd), true)

      const prefsDisabled = { quiet: { scheduleEnabled: false, dnd: false } }
      assert.equal(isQuietNow(prefsDisabled), false)
    })
  })
})
