/**
 * Parallel C. Driver queue filters and empty copy.
 * Does not edit tripTags.js and does not assert fare cents.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  matchesQueueFilter,
  queueEmptyCopy,
  queueFilters,
  scheduledQueueTitle,
} from '../packages/rides-native/tripTags.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const queue = fs.readFileSync(path.join(root, 'apps/driver/app/queue.tsx'), 'utf8')

test('queueFilters is a fresh copy of the four chips', () => {
  const first = queueFilters()
  assert.deepEqual(first, ['all', 'student', 'game_day', 'weekend_party'])
  first.push('extra')
  assert.deepEqual(queueFilters(), ['all', 'student', 'game_day', 'weekend_party'])
  assert.notEqual(queueFilters(), first)
})

test('a missing card is hidden, including an unknown filter', () => {
  for (const filter of queueFilters()) {
    assert.equal(matchesQueueFilter(null, filter), false)
    assert.equal(matchesQueueFilter(undefined, filter), false)
  }
  assert.equal(matchesQueueFilter(null, 'nope'), false)
})

test('tag filters match one tag and All matches every card', () => {
  const student = { tags: ['student'] }
  const game = { tags: ['game_day', 'direct'] }
  const weekend = { tags: ['weekend_party'] }
  const plain = { tags: [] }

  assert.equal(matchesQueueFilter(student, 'all'), true)
  assert.equal(matchesQueueFilter(student, 'student'), true)
  assert.equal(matchesQueueFilter(student, 'game_day'), false)
  assert.equal(matchesQueueFilter(student, 'weekend_party'), false)

  assert.equal(matchesQueueFilter(game, 'game_day'), true)
  assert.equal(matchesQueueFilter(game, 'student'), false)
  assert.equal(matchesQueueFilter(weekend, 'weekend_party'), true)
  assert.equal(matchesQueueFilter(plain, 'all'), true)
  assert.equal(matchesQueueFilter(plain, 'student'), false)
  assert.equal(matchesQueueFilter(plain, 'game_day'), false)
  assert.equal(matchesQueueFilter(plain, 'weekend_party'), false)
})

test('a card without a tags array throws when a tag filter reads it', () => {
  assert.equal(matchesQueueFilter({}, 'all'), true)
  assert.throws(() => matchesQueueFilter({}, 'student'), TypeError)
  assert.throws(() => matchesQueueFilter({ tags: null }, 'game_day'), TypeError)
  assert.throws(() => matchesQueueFilter({ tags: ['student'] }, 'airport'), /Unknown queue filter: airport/)
})

test('empty copy and the scheduled heading stay on the four filters', () => {
  assert.deepEqual(queueEmptyCopy('all'), {
    title: 'Queue is clear',
    body: 'Open requests and scheduled pickups show up here. Go online so riders can choose you.',
  })
  assert.deepEqual(queueEmptyCopy('student'), {
    title: 'No student rides',
    body: 'Clemson student discounts show up in this filter. Other requests stay on All.',
  })
  assert.deepEqual(queueEmptyCopy('game_day'), {
    title: 'No game-day rides',
    body: 'Stadium and tailgate rides show up here when the trip is marked game day.',
  })
  assert.equal(queueEmptyCopy('weekend_party').title, 'No weekend or party rides')
  assert.equal(scheduledQueueTitle('weekend_party'), 'Scheduled weekend and party rides')
  assert.equal(scheduledQueueTitle('game_day'), 'Scheduled')
  assert.equal(scheduledQueueTitle(''), 'Scheduled')
})

test('the queue screen filters with these helpers and shows the empty copy', () => {
  assert.match(queue, /matchesQueueFilter\(card, filter\)/)
  assert.match(queue, /const empty = queueEmptyCopy\(filter\)/)
  assert.match(queue, /\{empty\.title\}/)
  assert.match(queue, /\{empty\.body\}/)
  assert.match(queue, /scheduledQueueTitle\(filter\)/)
  assert.match(queue, /queueFilters\(\)\.includes\(requested as QueueFilter\)/)
})
