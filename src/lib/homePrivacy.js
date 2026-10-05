import { displayFirstName } from '../../packages/rides-native/authErrors.js'

/** Greeting for the signed-in rider. Empty names stay neutral. */
export function welcomeHeading(...names) {
  for (const name of names) {
    if (typeof name !== 'string') continue
    const first = displayFirstName(name, '')
    if (first) return `Welcome, ${first}`
  }
  return 'Welcome'
}

/** Saved places for one account. Rows for any other user id are dropped. */
export function ownerSavedPlaces(rows, userId) {
  if (!userId) return []
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.user_id === userId && row.label && row.subtitle)
    .map((row) => ({
      id: String(row.id),
      label: String(row.label),
      sub: String(row.subtitle),
      icon: '📍',
    }))
}
