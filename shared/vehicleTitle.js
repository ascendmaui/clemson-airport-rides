/** Vehicle title status collected on driver sign-up. Clean and rebuilt may be stored. Salvage is blocked. */

export const REBUILT_TITLE_HELPER = 'Unlike Uber and Lyft, we accept rebuilt titles.'

export const SALVAGE_TITLE_MESSAGE = "We can't accept a salvage title. A salvage brand means an insurer declared the vehicle a total loss, so it isn't eligible to drive with Clemson Rides. Clean titles are welcome, and unlike Uber and Lyft, we accept rebuilt titles."

export const TITLE_STATUS_OPTIONS = [
  { id: 'clean', label: 'Clean', allowed: true },
  { id: 'rebuilt', label: 'Rebuilt', allowed: true },
  { id: 'salvage', label: 'Salvage', allowed: false },
]

const TITLE_STATUS_IDS = new Set(TITLE_STATUS_OPTIONS.map((option) => option.id))

/** 'clean' | 'rebuilt' | 'salvage', or null when the value is blank or unknown. */
export function normalizeTitleStatus(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!TITLE_STATUS_IDS.has(text)) return null
  return text
}

export function allowedTitleStatus(value) {
  const status = normalizeTitleStatus(value)
  if (status === 'clean' || status === 'rebuilt') return status
  return null
}

export function titleStatusError(value) {
  if (!String(value ?? '').trim()) return 'Select a vehicle title status.'
  const status = normalizeTitleStatus(value)
  if (!status) return 'Select Clean, Rebuilt, or Salvage.'
  if (status === 'salvage') return SALVAGE_TITLE_MESSAGE
  return null
}

export function titleStatusCode(value) {
  if (!String(value ?? '').trim()) return 'title_status_required'
  const status = normalizeTitleStatus(value)
  if (!status) return 'title_status_invalid'
  if (status === 'salvage') return 'salvage_title_blocked'
  return null
}

/** Server sign-up rejection. Null means clean or rebuilt can be saved. */
export function titleStatusRejection(body) {
  const raw = body?.titleStatus ?? body?.title_status
  const error = titleStatusError(raw)
  if (!error) return null
  return { error, code: titleStatusCode(raw) }
}

export function missingTitleStatusColumn(error) {
  const message = String(error?.message || error || '')
  return /title_status/i.test(message) && /schema cache|column|does not exist/i.test(message)
}

export function withoutTitleStatus(fields) {
  if (!fields || !Object.prototype.hasOwnProperty.call(fields, 'title_status')) return fields
  const next = { ...fields }
  delete next.title_status
  return next
}

/** Adds title_status only for clean or rebuilt. Salvage is never written. */
export function withTitleStatus(fields, value) {
  const status = allowedTitleStatus(value)
  if (!status) return { ...fields }
  return { ...fields, title_status: status }
}

/**
 * Writes vehicle fields. If title_status is not a column yet, retries without it.
 * Salvage never reaches this helper: callers reject it first.
 */
export async function writeVehicleWithTitleFallback(run, fields) {
  const first = await run(fields)
  if (!first?.error || !missingTitleStatusColumn(first.error)) return first
  if (!Object.prototype.hasOwnProperty.call(fields, 'title_status')) return first
  return run(withoutTitleStatus(fields))
}
