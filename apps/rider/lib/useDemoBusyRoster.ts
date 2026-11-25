import { useEffect, useState } from 'react'
import { logCaught } from '@/lib/caught'
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
    }).catch((err: unknown) => {
      logCaught('demo-busy-roster', err)
    })
    return () => { active = false }
  }, [])
  return resolveDemoBusyRoster({ buildFlag: process.env.EXPO_PUBLIC_DEMO_BUSY_ROSTER, serverFlag, isDev: __DEV__ })
}
