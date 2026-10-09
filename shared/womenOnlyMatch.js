/**
 * Optional women-only comfort matching.
 * Self-identified gender is used only for this preference and is not a public card field.
 * A preference that is on requires the other person to be a self-identified woman.
 */

export const GENDER_IDENTITIES = ['woman', 'man', 'nonbinary', 'unspecified']

export const GENDER_OPTIONS = [
  { id: 'woman', label: 'Woman' },
  { id: 'man', label: 'Man' },
  { id: 'nonbinary', label: 'Nonbinary' },
  { id: 'unspecified', label: 'Prefer not to say' },
]

export const WOMEN_ONLY_ACCEPT_ERROR = 'This ride uses a women-only comfort preference that does not match.'

export function normalizeGenderIdentity(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return GENDER_IDENTITIES.includes(text) ? text : 'unspecified'
}

export function sanitizeWomenOnlyPreference({ genderIdentity, womenOnly } = {}) {
  const gender = normalizeGenderIdentity(genderIdentity)
  const wants = womenOnly === true
  if (wants && gender !== 'woman') {
    return { genderIdentity: gender, womenOnlyMatching: false, rejected: true }
  }
  return { genderIdentity: gender, womenOnlyMatching: wants, rejected: false }
}

export function womenOnlyPreferenceAllowed(genderIdentity) {
  return normalizeGenderIdentity(genderIdentity) === 'woman'
}

export function asComfortSide(row) {
  if (!row) return { genderIdentity: 'unspecified', womenOnlyMatching: false }
  const clean = sanitizeWomenOnlyPreference({
    genderIdentity: row.genderIdentity ?? row.gender_identity,
    womenOnly: row.womenOnlyMatching ?? row.women_only_matching,
  })
  return { genderIdentity: clean.genderIdentity, womenOnlyMatching: clean.womenOnlyMatching }
}

/** Both sides of a match must satisfy the preference that is actually on. */
export function womenOnlyPairAllowed(rider, driver) {
  const riderSide = asComfortSide(rider)
  const driverSide = asComfortSide(driver)
  if (riderSide.womenOnlyMatching && driverSide.genderIdentity !== 'woman') return false
  if (driverSide.womenOnlyMatching && riderSide.genderIdentity !== 'woman') return false
  return true
}

export function womenOnlyMismatchMessage(rider, driver) {
  if (womenOnlyPairAllowed(rider, driver)) return null
  const riderSide = asComfortSide(rider)
  const driverSide = asComfortSide(driver)
  if (riderSide.womenOnlyMatching && driverSide.genderIdentity !== 'woman') {
    return 'That driver is not included in the women-driver comfort preference on your profile.'
  }
  if (driverSide.womenOnlyMatching && riderSide.genderIdentity !== 'woman') {
    return 'This driver is taking women passengers for their comfort preference.'
  }
  return WOMEN_ONLY_ACCEPT_ERROR
}

export function noComfortMatchMessage({ riderWants = false } = {}) {
  if (riderWants) {
    return 'No women drivers are online for this comfort preference. You can leave it on and try again, or turn it off in Profile.'
  }
  return 'Drivers online right now are taking women passengers for their comfort preference. Try again in a few minutes.'
}

export function comfortPreferenceCopy(role) {
  const driving = role === 'driver' || role === 'both'
  const riding = role !== 'driver'
  const locked = 'Choose Woman to turn this on. It stays off for every other selection, and it is not shown on your public card.'
  if (driving && riding) {
    return {
      kicker: 'COMFORT',
      title: 'Women-only matching',
      body: 'An extra comfort and safety step you can turn on for yourself. Ride requests go to women drivers, and driving requests come from women passengers. You can turn it off before the next ride.',
      locked,
    }
  }
  if (driving) {
    return {
      kicker: 'COMFORT',
      title: 'Women passengers',
      body: 'An extra comfort and safety step while you drive. When this is on, ride requests come from women passengers. You can turn it off before the next ride.',
      locked,
    }
  }
  return {
    kicker: 'COMFORT',
    title: 'Women drivers',
    body: 'An extra comfort and safety step on your trips. When this is on, your request goes to women drivers. You can turn it off before the next ride.',
    locked,
  }
}
