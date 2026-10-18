/** Years of driving experience a driver reports. Riders see "7 yrs experience". */

export const MAX_YEARS_EXPERIENCE = 70

/** Whole years 1..70, or null. Zero and junk hide the line. */
export function normalizeYearsExperience(raw) {
  if (raw == null || raw === '' || typeof raw === 'boolean') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null
  if (n < 1 || n > MAX_YEARS_EXPERIENCE) return null
  return n
}

export function yearsExperienceLabel(raw) {
  const n = normalizeYearsExperience(raw)
  if (n == null) return null
  return `${n} ${n === 1 ? 'yr' : 'yrs'} experience`
}
