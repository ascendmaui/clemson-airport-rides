/** How far home clutter travels when the driver goes online. */
export const HOME_CLUTTER_SHIFT = 720

export const HOME_CLUTTER_SPRING = { damping: 18, stiffness: 160, mass: 0.85 }

/** Online slides clutter off the map. Offline springs it back to rest. */
export function homeClutterTranslateY(online: boolean): number {
  return online ? HOME_CLUTTER_SHIFT : 0
}
