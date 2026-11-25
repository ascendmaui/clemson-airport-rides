import { useEffect, useState, type ReactNode } from 'react'
import { DriverClickwrap } from 'rides-native/DriverClickwrap'
import {
  DRIVER_CLICKWRAP_VERSION,
  CLICKWRAP_STORAGE_KEY,
  resolveDriverClickwrap,
  submitDriverClickwrap,
} from 'rides-native/driverClickwrapClient'
import Constants from 'expo-constants'
import { useAuth } from '@/lib/auth'
import { authStorage } from '@/lib/storage'
import { clickwrapPhaseAfterRace, raceWithTimeout, STARTUP_TIMEOUT_MS } from '@/lib/startupGate'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { BootScreen } from '@/components/BootScreen'

function appVersion() {
  return Constants.expoConfig?.version || '1.1.0'
}

export function DriverAgreementPrompt({ children, onBack }: { children: ReactNode; onBack?: () => void }) {
  const { loading, user } = useAuth()
  const { colors } = useTheme()
  const [phase, setPhase] = useState<'unknown' | 'required' | 'ok'>('unknown')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return undefined
    if (!user?.id) {
      setPhase('ok')
      return undefined
    }
    let alive = true
    setPhase('unknown')
    raceWithTimeout(resolveDriverClickwrap(supabase, authStorage), STARTUP_TIMEOUT_MS)
      .then((result) => {
        if (alive) setPhase(clickwrapPhaseAfterRace(result))
      })
      .catch(() => {
        if (alive) setPhase('required')
      })
    return () => {
      alive = false
    }
  }, [loading, user?.id])

  async function accept() {
    if (!supabase || busy) return
    setBusy(true)
    setError(null)
    try {
      const saved = await submitDriverClickwrap(supabase, { appVersion: appVersion() })
      if (!saved?.accepted || saved.acceptance?.agreementVersion !== DRIVER_CLICKWRAP_VERSION) {
        throw new Error('Acceptance was not recorded.')
      }
      await authStorage.setItem(CLICKWRAP_STORAGE_KEY, DRIVER_CLICKWRAP_VERSION)
      setPhase('ok')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your agreement')
    } finally {
      setBusy(false)
    }
  }

  if (loading || (user && phase === 'unknown')) return <BootScreen />
  if (phase === 'required') {
    return (
      <DriverClickwrap
        onAgree={() => { void accept() }}
        busy={busy}
        colors={colors}
        error={error}
        onBack={onBack}
      />
    )
  }
  return children
}
