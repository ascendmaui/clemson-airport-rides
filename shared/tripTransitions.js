/** Server-side driver actions. Timers and payments belong to the indicated service. */
export const DRIVER_TRANSITIONS = Object.freeze({
  accept: Object.freeze({ from: Object.freeze(['searching', 'offered']), to: 'accepted', via: 'update' }),
  arriving: Object.freeze({ from: Object.freeze(['accepted']), to: 'arriving', via: 'update' }),
  arrive: Object.freeze({ from: Object.freeze(['accepted', 'arriving']), to: 'arrived', via: 'wait' }),
  start: Object.freeze({ from: Object.freeze(['arrived']), to: 'in_progress', via: 'wait' }),
  complete: Object.freeze({ from: Object.freeze(['in_progress']), to: 'completed', via: 'settle' }),
  'driver-cancel': Object.freeze({ from: Object.freeze(['accepted', 'arriving']), to: 'searching', via: 'driver_cancel' }),
  cancel: Object.freeze({ from: Object.freeze(['arrived']), to: 'cancelled_wait', via: 'wait' }),
})

export function resolveDriverTransition({ status, op }) {
  const transition = Object.hasOwn(DRIVER_TRANSITIONS, op) ? DRIVER_TRANSITIONS[op] : null
  if (!transition) return { error: 'invalid_op' }
  const { to, via, from } = transition
  if (status === to && op !== 'driver-cancel') return { to, via, idempotent: true }
  if (op === 'cancel' && ['accepted', 'arriving'].includes(status)) return { error: 'invalid_transition', hint: 'Use driver-cancel to cancel before pickup.' }
  if (!from.includes(status)) return { error: 'invalid_transition' }
  return { to, via }
}
