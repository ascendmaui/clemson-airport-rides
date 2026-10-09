/**
 * What the driver sees while taps wait for signal: the server trip card with
 * the queued status and stop taps applied in order. Pure; never persisted.
 */
import { applyStopOp, tripOpForStop } from '../../shared/carpoolStops.js'
import { projectTripStatus, waitingForSignalLabel } from './actionQueue.js'

const STATUS_AFTER_TRIP_OP = { arrive: 'arrived', start: 'in_progress' }

export function projectQueuedTrip(card, actions = []) {
  if (!card) return card
  const mine = (Array.isArray(actions) ? actions : []).filter((a) => a?.tripId === card.id)
  if (!mine.length) return card
  let status = card.status
  let stops = Array.isArray(card.stops) ? card.stops : []
  for (const action of mine) {
    if (action.kind === 'status') {
      status = projectTripStatus(status, [action])
      continue
    }
    if (action.kind === 'stop' && stops.length) {
      const stop = stops[action.stopIndex]
      const tripOp = tripOpForStop(stop, action.op, status)
      const applied = applyStopOp(stops, { index: action.stopIndex, op: action.op, at: action.queuedAt })
      if (applied.error) continue
      stops = applied.stops
      if (tripOp) status = STATUS_AFTER_TRIP_OP[tripOp] || status
    }
  }
  return { ...card, status, stops, queuedTaps: mine.length, waitingForSignal: waitingForSignalLabel(mine.length) }
}
