import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LOBBY_ACTIONS,
  LOBBY_STATUSES,
  PARTICIPANT_ROLES,
  PARTICIPANT_STATUSES,
  SPLIT_MODES,
  LOBBY_BANNER_COPY,
  formatLobbyStatus,
  formatParticipantRole,
  formatParticipantStatus,
  formatSplitMode,
  isLobbyFull,
  formatCapacityBadge,
  formatSeatCount,
  formatWaypointLabel,
  formatHopSummary,
} from '../packages/rides-native/carpoolCopy.js'

test('LOBBY_ACTIONS provides standard action verbs and button labels', () => {
  assert.equal(LOBBY_ACTIONS.CREATE_LOBBY, 'Create lobby')
  assert.equal(LOBBY_ACTIONS.JOIN_LOBBY, 'Join lobby')
  assert.equal(LOBBY_ACTIONS.INVITE_FRIENDS, 'Invite friends')
  assert.equal(LOBBY_ACTIONS.COPY_INVITE, 'Copy lobby link')
  assert.equal(LOBBY_ACTIONS.LINK_COPIED, 'Lobby link copied!')
  assert.equal(LOBBY_ACTIONS.UPDATE_STOPS, 'Update stops')
  assert.equal(LOBBY_ACTIONS.ADD_STOPS, 'Add your stops')
  assert.equal(LOBBY_ACTIONS.SAVE_STOPS, 'Save stops')
  assert.equal(LOBBY_ACTIONS.OPTIMIZE_ROUTE, 'Optimize route & fares')
  assert.equal(LOBBY_ACTIONS.CALCULATING_FARES, 'Calculating fares…')
  assert.equal(LOBBY_ACTIONS.LOCK_SEATS, 'Lock seats')
  assert.equal(LOBBY_ACTIONS.CONFIRM_CHARGES, 'Confirm & charge')
  assert.equal(LOBBY_ACTIONS.SETTLE_FARES, 'Settle fares')
  assert.equal(LOBBY_ACTIONS.LEAVE_LOBBY, 'Leave lobby')
  assert.equal(LOBBY_ACTIONS.CANCEL_LOBBY, 'Cancel lobby')
})

test('formatLobbyStatus formats lifecycle states cleanly', () => {
  assert.deepEqual(formatLobbyStatus('open'), {
    label: 'Open',
    hint: 'Inviting riders and adding stops',
    tone: 'info',
  })

  assert.deepEqual(formatLobbyStatus('locked'), {
    label: 'Seats Locked',
    hint: 'Stops finalized, calculating route',
    tone: 'warning',
  })

  assert.deepEqual(formatLobbyStatus('confirmed'), {
    label: 'Confirmed',
    hint: 'All riders confirmed fares',
    tone: 'success',
  })

  assert.deepEqual(formatLobbyStatus('booked'), {
    label: 'Booked',
    hint: 'Driver assigned and dispatched',
    tone: 'brand',
  })

  assert.deepEqual(formatLobbyStatus('canceled'), {
    label: 'Canceled',
    hint: 'Lobby canceled',
    tone: 'muted',
  })

  // Handles trim and case
  assert.equal(formatLobbyStatus('  LOCKED  ').label, 'Seats Locked')

  // Graceful fallback
  const fallback = formatLobbyStatus('custom_state')
  assert.equal(fallback.label, 'Custom_state')
  assert.equal(fallback.tone, 'info')
})

test('formatParticipantRole and formatParticipantStatus resolve participant taxonomy', () => {
  assert.equal(formatParticipantRole('organizer'), 'Organizer')
  assert.equal(formatParticipantRole('rider', true), 'Organizer')
  assert.equal(formatParticipantRole('rider'), 'Rider')
  assert.equal(formatParticipantRole(null), 'Rider')

  assert.equal(formatParticipantStatus('joined').label, 'Joined')
  assert.equal(formatParticipantStatus('ready').label, 'Ready')
  assert.equal(formatParticipantStatus('confirmed').label, 'Confirmed')
  assert.equal(formatParticipantStatus('pending').label, 'Invited')
  assert.equal(formatParticipantStatus('declined').label, 'Declined')
})

test('formatSplitMode displays standardized split terminology', () => {
  assert.equal(formatSplitMode('even'), 'Even split')
  assert.equal(formatSplitMode('by_distance'), 'By distance')
  assert.equal(formatSplitMode('unknown'), 'Even split')
  assert.equal(formatSplitMode(null), 'Even split')
})

test('Seat capacity calculations and badge formatting', () => {
  assert.equal(isLobbyFull(4, 4), true)
  assert.equal(isLobbyFull(5, 4), true)
  assert.equal(isLobbyFull(3, 4), false)

  assert.deepEqual(formatCapacityBadge(4, 4), {
    label: 'Lobby full',
    available: 0,
    full: true,
    tone: 'warning',
  })

  assert.deepEqual(formatCapacityBadge(3, 4), {
    label: '1 seat left',
    available: 1,
    full: false,
    tone: 'accent',
  })

  assert.deepEqual(formatCapacityBadge(1, 4), {
    label: '3 seats available',
    available: 3,
    full: false,
    tone: 'info',
  })

  assert.equal(formatSeatCount(2, 4), '2/4 seats')
})

test('Waypoint and hop summary formatting', () => {
  assert.equal(formatWaypointLabel('pickup', 0), 'Stop 1: Pickup')
  assert.equal(formatWaypointLabel('dropoff', 1), 'Stop 2: Dropoff')
  assert.equal(formatHopSummary('GrandMarc', 'College Ave'), 'GrandMarc → College Ave')
  assert.equal(formatHopSummary(null, null), 'Pickup → Dropoff')
})

test('LOBBY_BANNER_COPY provides standard notices and tags', () => {
  assert.equal(LOBBY_BANNER_COPY.BEFORE_CONFIRM, 'BEFORE YOU CONFIRM')
  assert.equal(LOBBY_BANNER_COPY.SPLIT_PREVIEW_TITLE, 'Fare split preview')
  assert.equal(LOBBY_BANNER_COPY.FIRST_RIDE_FREE_BADGE, 'First ride free')
  assert.equal(LOBBY_BANNER_COPY.CLEMSON_STUDENT_BADGE, 'Clemson student')
  assert.ok(LOBBY_BANNER_COPY.SHARE_SAVINGS_EXPLAINER.includes('Apple Pay'))
})
