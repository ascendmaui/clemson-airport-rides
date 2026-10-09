/** Native picker icons use the Ionicons font bundled by @expo/vector-icons. */
/** @type {Readonly<Record<string, 'car-outline' | 'time-outline' | 'sparkles-outline' | 'people-outline'>>} */
export const RIDE_TYPE_ICONS = Object.freeze({
  standard: 'car-outline',
  wait: 'time-outline',
  comfort: 'sparkles-outline',
  carpool: 'people-outline',
})

/** @param {string} id */
export function rideTypeIconName(id) {
  return RIDE_TYPE_ICONS[id] || RIDE_TYPE_ICONS.standard
}
