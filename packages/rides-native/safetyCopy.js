/**
 * Standardized Safety & SOS emergency copy, disclaimers, and action labels across mobile & web.
 */

export const EMERGENCY_SOS_HEADING = 'Emergency SOS'

export const SOS_DISCLAIMERS = Object.freeze({
  CONFIRM: (party = 'driver') =>
    `This does not call anyone yet. Slide or press and hold to alert your ${party} in the app, then choose 911 or Clemson Police. Your GPS and trip id go with the alert.`,
  ACTIVE: (party = 'driver') =>
    `Your ${party} sees an in-app SOS banner. Pick a way to reach help. Each choice is logged.`,
  LOG_ERROR: (err = 'network error') =>
    `Could not save the SOS log (${err}). You can still call 911.`,
})

export const SOS_ACTION_LABELS = Object.freeze({
  SLIDE_TO_ACTIVATE: 'Slide to activate SOS',
  HOLD_TO_ACTIVATE: 'Hold to activate SOS',
  HOLDING: 'Hold…',
  ACTIVATING: 'Activating SOS…',
  CANCEL: 'Cancel',
  CLOSE: 'Close',
  LOCATING: 'Getting your location…',
  GPS_UNAVAILABLE: 'GPS unavailable',
  OPENING: 'Opening…',
})

export const SAFETY_PAGE_COPY = Object.freeze({
  TITLE: 'Safety & support',
  SUBTITLE: 'Emergency tools, contacts, and campus safety services.',
  EMERGENCY_CONTACTS_TITLE: 'Emergency contacts',
  EMERGENCY_CONTACTS_SUBTITLE:
    'Up to 5 trusted contacts who can receive ride tracking updates.',
  SHARE_LOCATION_TITLE: 'Share trip location',
  SHARE_LOCATION_HINT:
    'Send live tracking link to friends, roommates, or family.',
  CUPD_INFO_TITLE: 'Clemson Police (CUPD)',
  CUPD_INFO_HINT:
    'Campus safety line open 24/7 for rides, escorts, and emergencies.',
})

/**
 * Resolves the counterpart party label for a viewer role.
 * @param {'rider' | 'driver' | string} viewerRole
 * @returns {'rider' | 'driver'}
 */
export function resolveCounterpartParty(viewerRole) {
  return String(viewerRole).toLowerCase() === 'driver' ? 'rider' : 'driver'
}

/**
 * Formats SOS confirmation disclaimer based on viewer role.
 * @param {'rider' | 'driver' | string} [viewerRole]
 * @returns {string}
 */
export function formatSosConfirmCopy(viewerRole = 'rider') {
  const party = resolveCounterpartParty(viewerRole)
  return SOS_DISCLAIMERS.CONFIRM(party)
}

/**
 * Formats SOS active disclaimer based on viewer role.
 * @param {'rider' | 'driver' | string} [viewerRole]
 * @returns {string}
 */
export function formatSosActiveCopy(viewerRole = 'rider') {
  const party = resolveCounterpartParty(viewerRole)
  return SOS_DISCLAIMERS.ACTIVE(party)
}

/**
 * Formats user-facing SOS incoming banner title.
 * @param {'rider' | 'driver' | string} [counterpartRole]
 * @param {string} [channelPhrase]
 * @returns {string}
 */
export function formatSosBannerTitle(counterpartRole = 'driver', channelPhrase = 'activated SOS') {
  const role = String(counterpartRole || 'driver').toLowerCase()
  const phrase = String(channelPhrase || 'activated SOS')
  return `Your ${role} ${phrase}`
}

/**
 * Formats readable coordinates line.
 * @param {number|null} [lat]
 * @param {number|null} [lng]
 * @returns {string}
 */
export function formatLocationLine(lat, lng) {
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `GPS: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
  }
  return SOS_ACTION_LABELS.GPS_UNAVAILABLE
}
