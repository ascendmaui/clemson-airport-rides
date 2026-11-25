/** Minimum distance home clutter travels when the driver goes online. */
export const HOME_CLUTTER_SHIFT = 720

export const HOME_CLUTTER_SPRING = { damping: 18, stiffness: 160, mass: 0.85 }

/**
 * Online slides clutter off the map. A fixed 720pt shift leaves the earnings
 * pill and Busy areas on a tall phone, over GO. Use the window height when
 * it is taller than that floor. Offline springs clutter back to rest.
 */
export function homeClutterTranslateY(online: boolean, viewportHeight = HOME_CLUTTER_SHIFT): number {
  if (!online) return 0
  const height = Number(viewportHeight)
  if (!Number.isFinite(height) || height <= 0) return HOME_CLUTTER_SHIFT
  return Math.max(HOME_CLUTTER_SHIFT, height)
}
