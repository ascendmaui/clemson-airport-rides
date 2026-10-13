import { parseDemoBusyRosterFlag } from './demoBusyRoster.js'

/** One request per JS session, including failed requests. No auth needed. */
export function createAppConfigLoader() {
  let pending
  return function loadAppConfig(url, fetcher = globalThis.fetch) {
    if (!pending) {
      pending = (async () => {
        let timeout
        try {
          const controller = new AbortController()
          timeout = setTimeout(() => controller.abort(), 5000)
          const response = await fetcher(url, { signal: controller.signal })
          if (!response.ok) return undefined
          const config = await response.json()
          return typeof config?.demoBusyRoster === 'boolean' ? config.demoBusyRoster : undefined
        } catch {
          return undefined
        } finally {
          clearTimeout(timeout)
        }
      })()
    }
    return pending
  }
}

/** Query takes precedence over hash; storage failures still allow a URL override. */
export function readWebDemoBusyRosterOverride(location, storage) {
  let value
  try {
    const hash = location.hash || ''
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash.replace(/^#/, '')
    value = new URLSearchParams(location.search || '').get('demoBusyRoster')
      ?? new URLSearchParams(hashQuery).get('demoBusyRoster')
  } catch { /* unavailable location */ }
  if (value === 'clear') {
    try { storage.removeItem('crDemoBusyRoster') } catch { /* private mode */ }
    return undefined
  }
  const flag = value === '1' ? true : value === '0' ? false : undefined
  if (flag !== undefined) {
    try { storage.setItem('crDemoBusyRoster', flag ? '1' : '0') } catch { /* private mode */ }
    return flag
  }
  try { return parseDemoBusyRosterFlag(storage.getItem('crDemoBusyRoster')) } catch { return undefined }
}
