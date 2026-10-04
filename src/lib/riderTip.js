import { api } from './payments.js'

/** True when the signed-in rider still needs the post-trip tip step. */
export function shouldPromptRiderTip(trip, userId) {
  if (!trip || trip.status !== 'completed') return false
  if (!userId || trip.rider_id !== userId) return false
  const meta = trip.metadata
  if (meta && typeof meta === 'object' && !Array.isArray(meta) && meta.rider_tip_choice) return false
  return true
}

export function fetchTipOffer(tripId) {
  return api('/api/driver?action=tip-choice', { mode: 'offer', tripId })
}

export function recordTipChoice(tripId, choiceId) {
  return api('/api/driver?action=tip-choice', { mode: 'record', tripId, choiceId })
}
