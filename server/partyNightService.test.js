import assert from 'node:assert/strict'
import test from 'node:test'
import handler from '../api/party-night.js'
import { createMemoryPartyRepo } from './partyNightRepo.js'
import {
  cancelPartyNight,
  createPartyNight,
  joinPartyNight,
  joinReturnQueue,
  leavePartyNight,
  partyReminders,
} from './partyNightService.js'

const LIBRARY = { label: 'Cooper Library', lat: 34.6757, lng: -82.8365 }
const DOWNTOWN = { label: 'Downtown Clemson', lat: 34.6834, lng: -82.8374 }
const NOW = new Date('2026-10-16T22:00:00Z')
const FRIDAY_NIGHT = new Date('2026-10-17T03:00:00Z')

function user(id, name) {
  return { id, email: `${name}@clemson.edu`, user_metadata: { full_name: name } }
}

function plan(overrides = {}) {
  return {
    pickup: LIBRARY,
    dropoff: DOWNTOWN,
    date: '2026-10-16',
    time: '21:00',
    now: NOW,
    ...overrides,
  }
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
    },
    end(payload) {
      this.body = payload == null ? '' : String(payload)
    },
  }
}

async function call(req) {
  const res = mockRes()
  await handler({ headers: {}, ...req }, res)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

test('create, invite join, and leave keep an even pre-auth split', async () => {
  const repo = createMemoryPartyRepo()
  const created = await createPartyNight(repo, {
    ...plan(),
    user: user('org', 'Ava Stone'),
    returnOptIn: true,
    token: 'night1',
  })
  assert.equal(created.ok, true)
  assert.equal(created.night.depositCents, 0)
  assert.equal(created.night.members[0].holdKind, 'preauth')
  assert.ok(created.night.members[0].holdCents > created.night.members[0].shareCents)
  assert.equal(created.night.invitePath, '/party-night/night1')

  const joined = await joinPartyNight(repo, {
    user: user('pal', 'Miles Ortega'),
    token: 'night1',
    now: new Date(NOW.getTime() + 60_000),
  })
  assert.equal(joined.night.memberCount, 2)
  assert.equal(joined.night.members.reduce((sum, member) => sum + member.shareCents, 0), joined.night.estimatedFareCents)
  assert.equal(joined.night.members.every((member) => member.depositCents === 0), true)
  assert.ok(joined.night.members[0].shareCents >= joined.night.members[1].shareCents)

  const again = await joinPartyNight(repo, { user: user('pal', 'Miles'), token: 'night1', now: NOW })
  assert.equal(again.alreadyJoined, true)
  assert.equal(again.night.memberCount, 2)

  const left = await leavePartyNight(repo, { user: user('pal', 'Miles'), token: 'night1', now: NOW })
  assert.equal(left.night.memberCount, 1)
  assert.equal(left.night.members[0].shareCents, left.night.estimatedFareCents)
})

test('a party night stops at six people and only the organizer can cancel', async () => {
  const repo = createMemoryPartyRepo()
  await createPartyNight(repo, { ...plan(), user: user('org', 'Ava'), token: 'full' })
  for (let i = 0; i < 5; i += 1) {
    const joined = await joinPartyNight(repo, {
      user: user(`p${i}`, `Pal${i}`),
      token: 'full',
      now: new Date(NOW.getTime() + (i + 1) * 1000),
    })
    assert.equal(joined.ok, true, joined.error)
  }
  const overflow = await joinPartyNight(repo, { user: user('late', 'Late'), token: 'full', now: NOW })
  assert.equal(overflow.ok, false)
  assert.equal(overflow.code, 'full')
  const denied = await cancelPartyNight(repo, { user: user('p0', 'Pal0'), token: 'full', now: NOW })
  assert.equal(denied.status, 403)
  const canceled = await cancelPartyNight(repo, { user: user('org', 'Ava'), token: 'full', now: NOW })
  assert.equal(canceled.night.status, 'canceled')
  const after = await joinPartyNight(repo, { user: user('next', 'Next'), token: 'full', now: NOW })
  assert.equal(after.code, 'canceled')
})

test('pickup reminder and late-night return queue', async () => {
  const repo = createMemoryPartyRepo()
  const pickupMoment = new Date('2026-10-17T01:10:00Z')
  await createPartyNight(repo, {
    user: user('org', 'Ava'),
    pickup: LIBRARY,
    dropoff: DOWNTOWN,
    date: '2026-10-16',
    time: '21:10',
    now: new Date('2026-10-16T22:00:00Z'),
    token: 'soon',
  })
  const reminders = await partyReminders(repo, {
    user: user('org', 'Ava'),
    now: new Date(pickupMoment.getTime() - 10 * 60 * 1000),
  })
  assert.equal(reminders.reminders.length, 1)
  assert.equal(reminders.reminders[0].label, 'Pickup in about 15 minutes')
  assert.equal(reminders.reminders[0].pickupLabel, 'Cooper Library')

  const closed = await joinReturnQueue(repo, {
    user: user('org', 'Ava'),
    pickup: DOWNTOWN,
    dropoff: LIBRARY,
    now: NOW,
  })
  assert.equal(closed.code, 'return_closed')

  const first = await joinReturnQueue(repo, {
    user: user('org', 'Ava'),
    pickup: DOWNTOWN,
    dropoff: LIBRARY,
    partyNightId: null,
    now: FRIDAY_NIGHT,
  })
  assert.equal(first.ok, true)
  assert.equal(first.queue.position, 1)
  assert.equal(first.queue.open, true)

  const second = await joinReturnQueue(repo, {
    user: user('pal', 'Miles'),
    pickup: DOWNTOWN,
    dropoff: LIBRARY,
    now: new Date(FRIDAY_NIGHT.getTime() + 60_000),
  })
  assert.equal(second.queue.position, 2)
  assert.equal(second.queue.size, 2)

  const stayed = await joinReturnQueue(repo, {
    user: user('org', 'Ava'),
    pickup: DOWNTOWN,
    dropoff: { label: 'Core Campus', lat: 34.6784, lng: -82.8397 },
    now: new Date(FRIDAY_NIGHT.getTime() + 120_000),
  })
  assert.equal(stayed.queue.position, 1, 'updating a drop-off keeps the earlier queue place')

  const away = await joinReturnQueue(repo, {
    user: user('far', 'Far'),
    pickup: LIBRARY,
    dropoff: DOWNTOWN,
    now: FRIDAY_NIGHT,
  })
  assert.equal(away.code, 'outside_zone')
})

test('http explain and quote do not require a database, and holds are not deposits', async () => {
  const explained = await call({ method: 'GET', url: '/api/party-night?action=explain' })
  assert.equal(explained.status, 200)
  assert.match(explained.json.explainer.lede, /captured only when the trip ends/)
  assert.equal(explained.json.explainer.sections.some((section) => section.id === 'return'), true)

  const quoted = await call({
    method: 'POST',
    url: '/api/party-night?action=quote',
    body: { pickup: LIBRARY, dropoff: DOWNTOWN, partySize: 3 },
  })
  assert.equal(quoted.status, 200)
  assert.equal(quoted.json.depositCents, 0)
  assert.equal(quoted.json.people.every((person) => person.holdKind === 'preauth' && person.depositCents === 0), true)

  const denied = await call({ method: 'POST', url: '/api/party-night?action=create', body: {} })
  assert.equal(denied.status, 401)

  const offline = await call({
    method: 'POST',
    url: '/api/party-night?action=create',
    body: plan(),
  })
  assert.equal(offline.status, 401)
})

test('http create uses the signed-in rider and hides pins from guests', async () => {
  const repo = createMemoryPartyRepo()
  const res = mockRes()
  await handler({
    method: 'POST',
    url: '/api/party-night?action=create',
    headers: {},
    body: { ...plan(), displayName: 'Ava Stone', user: { id: 'spoof' } },
  }, res, { repo, user: user('org', 'Ava Stone'), now: NOW })
  const created = JSON.parse(res.body)
  assert.equal(res.statusCode, 200)
  assert.equal(created.night.members[0].firstName, 'Ava')
  assert.equal(created.night.members[0].isSelf, true)

  const guest = mockRes()
  await handler({
    method: 'GET',
    url: `/api/party-night?action=get&token=${encodeURIComponent(created.night.token)}`,
    headers: {},
  }, guest, { repo, user: null, now: NOW })
  const viewed = JSON.parse(guest.body)
  assert.equal(guest.statusCode, 200)
  assert.equal(viewed.night.pickup, undefined)
  assert.equal(viewed.night.pickupLabel, 'Cooper Library')
})
