import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HOLD_NOTE,
  MAX_PARTY_SIZE,
  PARTY_ZONE,
  applySplit,
  canJoinReturnQueue,
  formatPartyUsd,
  holdForShare,
  inPartyZone,
  partyNightExplainer,
  partyPickupReminder,
  partyWindowLabel,
  partyWindowOpen,
  presentPartyNight,
  presentReturnQueue,
  quotePartyNight,
  splitFareCents,
  suggestNightOut,
  validatePartySchedule,
} from './partyNight.js'

const DOWNTOWN = { label: 'Downtown Clemson', lat: 34.6834, lng: -82.8374 }
const LIBRARY = { label: 'Cooper Library', lat: 34.6757, lng: -82.8365 }
const STADIUM = { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 }
const FRIDAY_11PM = new Date('2026-10-17T03:00:00Z')
const SATURDAY_1AM = new Date('2026-10-17T05:00:00Z')
const SUNDAY_1AM = new Date('2026-10-18T05:00:00Z')
const SUNDAY_11PM = new Date('2026-10-19T03:00:00Z')
const THURSDAY_1AM = new Date('2026-10-15T05:00:00Z')
const THURSDAY_11PM = new Date('2026-10-16T03:00:00Z')
const MONDAY_NOON = new Date('2026-10-12T16:00:00Z')

test('party window matches the College Ave late-night queue', () => {
  assert.equal(partyWindowLabel(), 'Thursday, Friday, and Saturday, 10pm to 3am Eastern')
  assert.equal(partyWindowOpen(FRIDAY_11PM), true)
  assert.equal(partyWindowOpen(SATURDAY_1AM), true)
  assert.equal(partyWindowOpen(SUNDAY_1AM), true)
  assert.equal(partyWindowOpen(SUNDAY_11PM), false)
  assert.equal(partyWindowOpen(THURSDAY_1AM), false)
  assert.equal(partyWindowOpen(THURSDAY_11PM), true)
  assert.equal(partyWindowOpen(MONDAY_NOON), false)
  assert.equal(inPartyZone(DOWNTOWN), true)
  assert.equal(inPartyZone(LIBRARY), false)
  assert.equal(inPartyZone(STADIUM), false)
  assert.equal(PARTY_ZONE.radiusKm, 0.6)
})

test('fare split is even and the hold is a pre-authorization, not a deposit', () => {
  assert.deepEqual(splitFareCents(1000, 3), [334, 333, 333])
  const hold = holdForShare(1000)
  assert.equal(hold.depositCents, 0)
  assert.equal(hold.holdKind, 'preauth')
  assert.equal(hold.shareCents, 1000)
  assert.ok(hold.holdCents > hold.shareCents)
  assert.equal(hold.holdCents - hold.shareCents, hold.bufferCents)

  const quote = quotePartyNight({ pickup: LIBRARY, dropoff: DOWNTOWN, partySize: 4 })
  assert.equal(quote.ok, true)
  assert.equal(quote.depositCents, 0)
  assert.equal(quote.holdKind, 'preauth')
  assert.equal(quote.partySize, 4)
  assert.equal(quote.people.reduce((sum, person) => sum + person.shareCents, 0), quote.estimatedFareCents)
  for (const person of quote.people) {
    assert.equal(person.depositCents, 0)
    assert.equal(person.holdKind, 'preauth')
    assert.ok(person.holdCents >= person.shareCents)
  }
  assert.equal(quotePartyNight({ pickup: LIBRARY, dropoff: LIBRARY }).ok, false)
  assert.equal(quotePartyNight({ pickup: LIBRARY, dropoff: DOWNTOWN, partySize: 99 }).partySize, MAX_PARTY_SIZE)
})

test('schedule lead time and Friday night suggestion', () => {
  const now = new Date('2026-10-12T19:00:00Z')
  const suggestion = suggestNightOut(now)
  assert.equal(suggestion.date, '2026-10-16')
  assert.equal(suggestion.time, '21:00')
  const tooSoon = validatePartySchedule({
    pickup: LIBRARY,
    dropoff: DOWNTOWN,
    date: '2026-10-12',
    time: '15:20',
    now,
  })
  assert.equal(tooSoon.ok, false)
  assert.match(tooSoon.errors.join(' '), /30 minutes/)
  const ok = validatePartySchedule({
    pickup: LIBRARY,
    dropoff: DOWNTOWN,
    date: suggestion.date,
    time: suggestion.time,
    now,
  })
  assert.equal(ok.ok, true)
})

test('pickup reminder uses the day, hour, and 15-minute windows', () => {
  const pickupAt = new Date('2026-10-16T21:00:00Z').toISOString()
  const night = { status: 'scheduled', pickupAt }
  assert.equal(partyPickupReminder(night, new Date('2026-10-14T20:00:00Z')), null)
  assert.equal(partyPickupReminder(night, new Date('2026-10-16T01:30:00Z')).id, 'h24')
  assert.equal(partyPickupReminder(night, new Date('2026-10-16T20:20:00Z')).label, 'Pickup in about an hour')
  assert.equal(partyPickupReminder(night, new Date('2026-10-16T20:50:00Z')).label, 'Pickup in about 15 minutes')
  assert.equal(partyPickupReminder(night, new Date('2026-10-16T21:05:00Z')).label, 'Pickup time is now')
  assert.equal(partyPickupReminder({ ...night, status: 'canceled' }, new Date('2026-10-16T20:50:00Z')), null)
})

test('explainer states the hold, the link, the reminder, and the return queue', () => {
  const copy = partyNightExplainer()
  const text = `${copy.title} ${copy.lede} ${copy.sections.map((section) => `${section.title} ${section.body}`).join(' ')}`
  assert.match(copy.lede, /not a deposit/)
  assert.match(HOLD_NOTE, /not a deposit/)
  assert.match(HOLD_NOTE, /pre-authorization/)
  assert.equal(text.includes('25%'), false)
  assert.match(text, /Invite friends with a link/)
  assert.match(text, /Pickup reminder/)
  assert.match(text, /party-ride queue/)
  assert.match(text, /College Ave/)
  assert.equal(copy.sections.length, 6)
  assert.equal(formatPartyUsd(1050), '$10.50')
})

test('return queue is FIFO and closed outside the night window', () => {
  const closed = canJoinReturnQueue({ pickup: DOWNTOWN, at: MONDAY_NOON })
  assert.equal(closed.ok, false)
  assert.equal(closed.code, 'return_closed')
  const outside = canJoinReturnQueue({ pickup: LIBRARY, at: FRIDAY_11PM })
  assert.equal(outside.code, 'outside_zone')
  assert.equal(canJoinReturnQueue({ pickup: DOWNTOWN, at: FRIDAY_11PM }).ok, true)

  const queue = presentReturnQueue([
    { riderId: 'b', status: 'waiting', joinedAt: '2026-10-17T03:05:00Z', pickup: DOWNTOWN },
    { riderId: 'a', status: 'waiting', joinedAt: '2026-10-17T03:01:00Z', pickup: DOWNTOWN },
    { riderId: 'c', status: 'left', joinedAt: '2026-10-17T03:00:00Z', pickup: DOWNTOWN },
  ], { riderId: 'b', now: FRIDAY_11PM })
  assert.equal(queue.open, true)
  assert.equal(queue.size, 2)
  assert.equal(queue.position, 2)
  assert.equal(queue.joined, true)
})

test('a presented night hides pins from someone who has not joined', () => {
  const night = {
    id: 'n1',
    organizerId: 'org',
    token: 'abc',
    status: 'scheduled',
    pickup: LIBRARY,
    dropoff: DOWNTOWN,
    pickupAt: '2026-10-17T01:00:00Z',
    estimatedFareCents: 1000,
    returnOptIn: true,
  }
  const members = applySplit(1000, [
    { id: 'm1', userId: 'org', displayName: 'Ava Stone', joinedAt: '2026-10-16T12:00:00Z' },
    { id: 'm2', userId: 'pal', displayName: 'miles@clemson.edu', joinedAt: '2026-10-16T12:05:00Z' },
  ])
  const guest = presentPartyNight(night, members, { viewerId: null, now: MONDAY_NOON })
  assert.equal(guest.pickup, undefined)
  assert.equal(guest.depositCents, 0)
  assert.equal(guest.members[0].firstName, 'Ava')
  assert.equal(guest.members[1].firstName, 'Miles')
  assert.equal(guest.members.reduce((sum, member) => sum + member.shareCents, 0), 1000)
  assert.equal(guest.members.every((member) => member.depositCents === 0 && member.holdKind === 'preauth'), true)
  const host = presentPartyNight(night, members, { viewerId: 'org', now: MONDAY_NOON })
  assert.equal(host.pickup.label, 'Cooper Library')
  assert.equal(host.members[0].isSelf, true)
  assert.equal(host.members[0].isOrganizer, true)
})
