import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PASSWORD_RESET_REDIRECT,
  searchDelayMs,
  airportFareCents,
  applyStudentDiscount,
  campusOverlays,
  depositCents,
  nextPickupDate,
  parseRecoveryUrl,
} from './riderShell.js'

test('password reset redirect uses the rider scheme', () => {
  assert.equal(PASSWORD_RESET_REDIRECT, 'clemsonrides://set-password')
})

test('parseRecoveryUrl reads hash tokens and query codes', () => {
  const hash = parseRecoveryUrl('clemsonrides://set-password#access_token=abc&refresh_token=def&type=recovery')
  assert.equal(hash.accessToken, 'abc')
  assert.equal(hash.refreshToken, 'def')
  assert.equal(hash.type, 'recovery')

  const query = parseRecoveryUrl('clemsonrides://set-password?code=pkce-code&type=recovery')
  assert.equal(query.code, 'pkce-code')
  assert.equal(query.type, 'recovery')
  assert.equal(parseRecoveryUrl('clemsonrides://set-password'), null)
})

test('airport quotes stay unsurged and have no upfront deposit', () => {
  const gsp = airportFareCents('GSP')
  const clt = airportFareCents('CLT')
  assert.equal(gsp, 6846)
  assert.equal(clt, 17544)
  assert.equal(depositCents(gsp), 0)
  const student = applyStudentDiscount(gsp, true)
  assert.equal(student.discountCents, 685)
  assert.equal(student.fareCents, 6161)
})

test('home-game window is game-day pricing; weekends alone show no surge', () => {
  // Oct 17 2026 home game, kickoff 12:00 ET: window 08:00-15:00 ET.
  const game = campusOverlays(new Date('2026-10-17T13:00:00-04:00'))
  assert.equal(game.gameDay, true)
  assert.equal(game.surgeLabel, 'Game-day pricing')

  const after = campusOverlays(new Date('2026-10-17T15:30:00-04:00'))
  assert.equal(after.gameDay, false)
  assert.equal(after.surge, false)

  const friday = campusOverlays(new Date('2026-09-25T18:30:00-04:00'))
  assert.equal(friday.surge, false)
  assert.equal(friday.surgeLabel, null)

  const awaySaturday = campusOverlays(new Date('2026-10-31T14:00:00-04:00'))
  assert.equal(awaySaturday.gameDay, false)
})

test('choose-driver loader stays inside 2–4 seconds', () => {
  assert.equal(searchDelayMs(() => 0), 2000)
  assert.equal(searchDelayMs(() => 1), 4000)
  assert.equal(searchDelayMs(() => 0.5), 3000)
})

test('recurring pickup skips weekdays that are inside the 30 minute lead', () => {
  const now = new Date('2026-09-24T12:00:00')
  const soon = nextPickupDate({ time: '12:10', weekdays: ['thu'], now })
  assert.equal(soon?.getDay(), 4)
  assert.ok(soon.getTime() - now.getTime() > 6 * 24 * 60 * 60 * 1000)

  const friday = nextPickupDate({ time: '21:00', weekdays: ['fri'], now })
  assert.equal(friday.getDay(), 5)
  assert.equal(friday.getDate(), 25)
})
