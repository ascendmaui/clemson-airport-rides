import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LOST_FOUND_HEADINGS,
  LOST_FOUND_EMPTY_STATE,
  LOST_FOUND_ACTIONS,
  LOST_FOUND_ERRORS,
  LOST_FOUND_STATUS_DETAILS,
  formatLostFoundStatus,
  formatLostFoundResolution,
  formatItemSummary,
} from '../packages/rides-native/lostFoundCopy.js'

test('LOST_FOUND_HEADINGS, ACTIONS, and EMPTY_STATE define canonical copy', () => {
  assert.equal(LOST_FOUND_HEADINGS.TITLE, 'Lost & found')
  assert.equal(LOST_FOUND_HEADINGS.REPORT_ITEM, 'Report an item')
  assert.equal(LOST_FOUND_HEADINGS.DESCRIBE_TITLE, 'What was left behind?')
  assert.equal(LOST_FOUND_HEADINGS.MATCH_RIDE_TITLE, 'Which ride was it?')
  assert.ok(LOST_FOUND_HEADINGS.SUBTITLE.includes('leave exact addresses off'))
  assert.ok(LOST_FOUND_HEADINGS.PRIVACY_NOTICE.includes('First names only'))

  assert.equal(LOST_FOUND_EMPTY_STATE.TITLE, 'No reports yet')
  assert.equal(
    LOST_FOUND_EMPTY_STATE.BODY,
    'After a completed ride, describe the item and we’ll notify the other person.'
  )

  assert.equal(LOST_FOUND_ACTIONS.REPORT_ITEM, 'Report an item')
  assert.equal(LOST_FOUND_ACTIONS.CONFIRM_FOUND, 'I found this item')
  assert.equal(LOST_FOUND_ACTIONS.CONFIRM_NOT_FOUND, 'Not found in vehicle')
  assert.equal(LOST_FOUND_ACTIONS.MARK_RETURNED, 'Mark as returned')
  assert.equal(LOST_FOUND_ACTIONS.CLOSE_REPORT, 'Close report')
  assert.equal(LOST_FOUND_ACTIONS.SEND_MESSAGE, 'Send message')
})

test('LOST_FOUND_ERRORS provides user-friendly error messages', () => {
  assert.equal(
    LOST_FOUND_ERRORS.MISSING_DESCRIPTION,
    'Enter a description of the item left behind.'
  )
  assert.equal(
    LOST_FOUND_ERRORS.SELECT_COMPLETED_RIDE,
    'Pick a completed ride that has a driver.'
  )
  assert.ok(LOST_FOUND_ERRORS.IMMUTABLE_REPORT.includes('cannot be changed'))
  assert.ok(LOST_FOUND_ERRORS.NOT_PARTY.includes('own completed rides'))
})

test('formatLostFoundStatus formats report status lifecycle', () => {
  assert.deepEqual(formatLostFoundStatus('open'), {
    label: 'Open',
    hint: 'Waiting for counterpart response',
    tone: 'orange',
  })

  assert.deepEqual(formatLostFoundStatus('claimed'), {
    label: 'Claimed',
    hint: 'Item located, coordinate return',
    tone: 'purple',
  })

  assert.deepEqual(formatLostFoundStatus('returned'), {
    label: 'Returned',
    hint: 'Item successfully returned',
    tone: 'success',
  })

  assert.deepEqual(formatLostFoundStatus('closed'), {
    label: 'Closed',
    hint: 'Report closed',
    tone: 'muted',
  })

  assert.equal(formatLostFoundStatus('  CLAIMED  ').label, 'Claimed')
  assert.equal(formatLostFoundStatus('unknown').label, 'Unknown')
  assert.equal(formatLostFoundStatus(null).label, 'Open')
})

test('formatLostFoundResolution formats resolution strings', () => {
  assert.equal(formatLostFoundResolution('found'), 'Found')
  assert.equal(formatLostFoundResolution('not_found'), 'Not found')
  assert.equal(formatLostFoundResolution('FOUND'), 'Found')
  assert.equal(formatLostFoundResolution(null), '')
  assert.equal(formatLostFoundResolution(''), '')
})

test('formatItemSummary formats and truncates item descriptions', () => {
  assert.equal(formatItemSummary('Car keys on orange lanyard'), 'Car keys on orange lanyard')
  assert.equal(
    formatItemSummary('Apple AirPods Pro inside a black silicone protective case with small clip', 30),
    'Apple AirPods Pro inside a bl…'
  )
  assert.equal(formatItemSummary(null), 'Unspecified item')
  assert.equal(formatItemSummary('   '), 'Unspecified item')
})
