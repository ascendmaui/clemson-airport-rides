import assert from 'node:assert/strict'
import test from 'node:test'
import { webBottomTabLabels } from '../src/lib/webTabOrder.js'
import {
  PRODUCT_BRIEF,
  action,
  sanitizeActions,
} from './productKnowledge.js'

test('action helper returns structured object', () => {
  const act = action('Go to Account', 'account', { tab: 'billing' })
  assert.deepEqual(act, {
    label: 'Go to Account',
    route: 'account',
    params: { tab: 'billing' },
  })
})

test('sanitizeActions filters invalid routes, non-string labels, and malformed inputs', () => {
  const dirty = [
    null,
    undefined,
    'not an object',
    { label: 123, route: 'account' },
    { label: 'Unknown route', route: 'super-admin-portal' },
    { label: 'Valid Schedule', route: 'schedule' },
  ]

  const clean = sanitizeActions(dirty)
  assert.equal(clean.length, 1)
  assert.equal(clean[0].label, 'Valid Schedule')
  assert.equal(clean[0].route, 'schedule')
})

test('sanitizeActions validates tab parameters for account route', () => {
  const actions = [
    { label: 'Valid Billing', route: 'account', params: { tab: 'billing' } },
    { label: 'Valid Student', route: 'account', params: { tab: 'student' } },
    { label: 'Invalid Tab', route: 'account', params: { tab: 'secret-admin' } },
  ]

  const clean = sanitizeActions(actions)
  assert.equal(clean.length, 3)
  assert.equal(clean[0].params.tab, 'billing')
  assert.equal(clean[1].params.tab, 'student')
  assert.equal(clean[2].params.tab, undefined, 'Invalid tab is stripped from params')
})

test('sanitizeActions limits dest parameter to eligible booking routes', () => {
  const actions = [
    { label: 'Tiers', route: 'tiers', params: { dest: 'GSP Airport' } },
    { label: 'Schedule', route: 'schedule', params: { dest: 'GSP Airport' } },
  ]

  const clean = sanitizeActions(actions)
  assert.equal(clean[0].params.dest, 'GSP Airport', 'dest preserved on tiers')
  assert.equal(clean[1].params.dest, undefined, 'dest stripped on schedule route')
})

test('sanitizeActions limits output to 3 actions, truncates lengths, and deduplicates', () => {
  const actions = [
    { label: 'A very long label '.repeat(5), route: 'home' },
    { label: 'Home', route: 'home' },
    { label: 'Home', route: 'home' }, // Duplicate
    { label: 'Friends', route: 'friends' },
    { label: 'Carpool', route: 'carpool' },
    { label: 'Rate', route: 'rate' }, // Exceeds cap of 3
  ]

  const clean = sanitizeActions(actions)
  assert.equal(clean.length, 3, 'Capped at 3 actions')
  assert.ok(clean[0].label.length <= 60, 'Label capped at 60 chars')
})

test('PRODUCT_BRIEF contains authoritative Clemson discount rules', () => {
  assert.ok(PRODUCT_BRIEF.includes('@clemson.edu'))
  assert.ok(PRODUCT_BRIEF.includes('@g.clemson.edu'))
  assert.ok(PRODUCT_BRIEF.includes('10% off Standard only'))
  assert.ok(PRODUCT_BRIEF.includes('25% deposit'))
})

test('PRODUCT_BRIEF lists web bottom tabs in the same order as the web bar', () => {
  const order = webBottomTabLabels().join(', ')
  assert.equal(order, 'Rides, Schedule, Friends, Account')
  assert.ok(
    PRODUCT_BRIEF.includes(`Bottom tabs: ${order} (Rides opens the rider home, route "home").`),
    'support brief must follow the web bar, left to right',
  )
})
