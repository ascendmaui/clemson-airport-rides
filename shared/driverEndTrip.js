/** Driver "End trip / Report problem". Ends the ride with no charge. */

export const DRIVER_END_LABEL = 'End trip / Report problem'
export const DRIVER_END_TITLE = 'End trip?'
export const DRIVER_END_NOTICE = 'This ends the ride and reports a problem. The rider is not charged. Use Complete when the trip finished normally.'
export const DRIVER_END_SUCCESS = 'Trip ended. The rider was not charged.'
export const DRIVER_END_CONFIRM = 'End trip and report problem'

export const DRIVER_END_STATUSES = Object.freeze(['accepted', 'arriving', 'arrived', 'in_progress'])

export const DRIVER_END_REASONS = Object.freeze([
  { id: 'rider_unresponsive', label: 'Rider app is not responding' },
  { id: 'rider_not_present', label: 'Rider is not in the car' },
  { id: 'safety', label: 'Safety problem' },
  { id: 'other', label: 'Other' },
])

export function canDriverEnd(status) {
  return DRIVER_END_STATUSES.includes(String(status || ''))
}

export function validateDriverEnd(reason, note) {
  if (!DRIVER_END_REASONS.some((row) => row.id === reason)) return 'Choose what went wrong.'
  if (note != null && typeof note !== 'string') return 'The note must be text.'
  if (typeof note === 'string' && note.length > 200) return 'Keep the note to 200 characters.'
  if (reason === 'other' && !String(note || '').trim()) return 'Add a short note for Other.'
  return null
}
