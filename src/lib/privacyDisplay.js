/**
 * First name only. Chat headers and other matched-ride surfaces must not show a last name.
 * @param {unknown} fullName
 * @param {string} [fallback]
 */
export function displayFirstName(fullName, fallback = 'Rider') {
  if (typeof fullName !== 'string') return fallback
  const token = fullName.trim().split(/\s+/)[0] || ''
  const cleaned = token.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}.'’-]+$/u, '')
  return cleaned || fallback
}
