/** Pure flag resolution. Invalid/unset values defer to the next source. */
export function parseDemoBusyRosterFlag(value) {
  if (value === true || value === '1' || value === 'true') return true
  if (value === false || value === '0' || value === 'false') return false
  return undefined
}

export function resolveDemoBusyRoster({ override, buildFlag, serverFlag, isDev } = {}) {
  for (const value of [override, buildFlag, serverFlag, isDev]) {
    const flag = parseDemoBusyRosterFlag(value)
    if (flag !== undefined) return flag
  }
  return false
}
