/** Ride-type glyphs from the shared Clemson RIDES icon set (packages/rides-native/icons). */
/** @type {Readonly<Record<string, 'standard' | 'waitSave' | 'comfort' | 'carpool'>>} */
export const RIDE_TYPE_ICONS = Object.freeze({
  standard: 'standard',
  wait: 'waitSave',
  comfort: 'comfort',
  carpool: 'carpool',
})

/** @param {string} id */
export function rideTypeIconName(id) {
  return RIDE_TYPE_ICONS[id] || RIDE_TYPE_ICONS.standard
}
