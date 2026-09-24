import assert from 'node:assert/strict'
import test from 'node:test'
import { GAME_DAY_LIVE_COPY, GAME_DAY_OFF_COPY, gameDayNotice } from './gameDayNotice.js'

test('a missing server row is the off state', () => {
  const notice = gameDayNotice(null)
  assert.equal(notice.live, false)
  assert.equal(notice.headline, 'Game day off')
  assert.equal(notice.zone, null)
  assert.equal(notice.multiplierLabel, null)
  assert.equal(notice.body, GAME_DAY_OFF_COPY)
  assert.match(notice.body, /No game day is live/)
  assert.match(notice.body, /pickup zone/)
  assert.match(notice.body, /rider fare multiplier/)
})

test('a live row shows the pickup zone and rider fare multiplier', () => {
  const notice = gameDayNotice({
    title: 'Clemson vs. Wake Forest',
    pickup_zone_label: 'Memorial Stadium',
    surge_multiplier: 1.8,
  })
  assert.equal(notice.live, true)
  assert.equal(notice.zone, 'Memorial Stadium')
  assert.equal(notice.multiplier, 1.8)
  assert.equal(notice.multiplierLabel, '1.8×')
  assert.equal(notice.headline, 'Clemson vs. Wake Forest · Memorial Stadium · 1.8×')
  assert.equal(notice.detail, 'Pickup zone · Memorial Stadium · Rider fare 1.8×')
  assert.equal(notice.body, GAME_DAY_LIVE_COPY)
  assert.match(notice.body, /Discover and the home map show the pickup zone and the rider fare multiplier from the server/)
})

test('a live row without a multiplier does not invent one', () => {
  const notice = gameDayNotice({ title: 'Game day', pickup_zone_label: 'Lot 5', surge_multiplier: null })
  assert.equal(notice.live, true)
  assert.equal(notice.multiplierLabel, null)
  assert.equal(notice.headline, 'Game day · Lot 5')
  assert.equal(notice.detail, 'Pickup zone · Lot 5')
})
