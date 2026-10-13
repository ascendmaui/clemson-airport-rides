import { useEffect, useState } from 'react'
import { resolveDemoBusyRoster } from '../../shared/demoBusyRoster.js'
import { createAppConfigLoader, readWebDemoBusyRosterOverride } from '../../shared/demoBusyRosterClient.js'

const loadAppConfig = createAppConfigLoader()

function browserOverride() {
  let storage
  try { storage = window.localStorage } catch { /* blocked storage */ }
  try { return readWebDemoBusyRosterOverride(window.location, storage) } catch { return undefined }
}

// Capture an initial hash override before navigating from another screen to the picker.
browserOverride()

export function useDemoBusyRoster() {
  const [override, setOverride] = useState(browserOverride)
  const [serverFlag, setServerFlag] = useState(undefined)
  useEffect(() => {
    let active = true
    void loadAppConfig('/api/driver?action=app-config').then((flag) => { if (active) setServerFlag(flag) })
    const refresh = () => setOverride(browserOverride())
    window.addEventListener('hashchange', refresh)
    window.addEventListener('popstate', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      active = false
      window.removeEventListener('hashchange', refresh)
      window.removeEventListener('popstate', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  return resolveDemoBusyRoster({ override, buildFlag: import.meta.env.VITE_DEMO_BUSY_ROSTER, serverFlag, isDev: import.meta.env.DEV })
}
