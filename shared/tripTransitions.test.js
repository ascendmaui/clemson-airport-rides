import test from 'node:test'
import assert from 'node:assert/strict'
import { DRIVER_TRANSITIONS, resolveDriverTransition } from './tripTransitions.js'

test('driver action table permits only the listed transitions and idempotent targets', () => {
  const expected = {
    accept: [['searching', 'offered'], 'accepted', 'update'],
    arriving: [['accepted'], 'arriving', 'update'],
    arrive: [['accepted', 'arriving'], 'arrived', 'wait'],
    start: [['arrived'], 'in_progress', 'wait'],
    complete: [['in_progress'], 'completed', 'settle'],
    cancel: [['arrived'], 'cancelled_wait', 'wait'],
  }
  const statuses = ['searching', 'offered', 'accepted', 'arriving', 'in_progress', 'completed', 'canceled', 'scheduled', 'canceled_midride', 'arrived', 'cancelled_wait']
  assert.deepEqual(Object.keys(DRIVER_TRANSITIONS), Object.keys(expected))
  for (const [op, [from, to, via]] of Object.entries(expected)) {
    for (const status of statuses) {
      const result = resolveDriverTransition({ status, op })
      if (status === to) assert.deepEqual(result, { to, via, idempotent: true })
      else if (from.includes(status)) assert.deepEqual(result, { to, via })
      else assert.deepEqual(result, { error: op === 'cancel' && ['accepted', 'arriving'].includes(status) ? 'not_supported_yet' : 'invalid_transition' })
    }
  }
  for (const op of ['unknown', '__proto__', 'toString', null]) {
    assert.deepEqual(resolveDriverTransition({ status: 'accepted', op }), { error: 'invalid_op' })
  }
})
