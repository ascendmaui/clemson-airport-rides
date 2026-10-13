import { useEffect, useState } from 'react'
import { apiBase } from 'rides-native/apiClient'
import { resolveDemoBusyRoster } from '../../../shared/demoBusyRoster.js'
import { createAppConfigLoader } from '../../../shared/demoBusyRosterClient.js'

const loadAppConfig = createAppConfigLoader()

export function useDemoBusyRoster() {
  const [serverFlag, setServerFlag] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    let active = true
    void loadAppConfig(`${apiBase()}/api/driver?action=app-config`).then((flag) => {
      if (active) setServerFlag(flag)
    })
    return () => { active = false }
  }, [])
  return resolveDemoBusyRoster({ buildFlag: process.env.EXPO_PUBLIC_DEMO_BUSY_ROSTER, serverFlag, isDev: __DEV__ })
}
