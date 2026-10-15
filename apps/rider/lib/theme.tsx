import * as Location from 'expo-location'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated'
import { readDisplayMode, resolveScheme, type DisplayMode } from '@/lib/appearance'
import { logCaught } from '@/lib/caught'
import { authStorage } from '@/lib/storage'
import { paletteFor, type Palette, type Scheme } from '@/lib/palette'

export type { DisplayMode }

type Prefs = {
  displayMode: DisplayMode
}

type ThemeValue = {
  colors: Palette
  scheme: Scheme
  displayMode: DisplayMode
  setDisplayMode: (mode: DisplayMode) => void
  solarPlace: string
}

const PREFS_KEY = 'rider.ui.prefs'
const DEFAULT_PREFS: Prefs = {
  displayMode: 'auto',
}

const ThemeContext = createContext<ThemeValue | null>(null)

function readPrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS
  try {
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      displayMode: readDisplayMode(parsed.displayMode),
    }
  } catch (err) {
    logCaught('theme-prefs-parse', err)
    return DEFAULT_PREFS
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme()
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    authStorage.getItem(PREFS_KEY).then((raw) => {
      setPrefs(readPrefs(raw))
    }).catch((err: unknown) => {
      logCaught('theme-prefs', err)
    })
  }, [])

  useEffect(() => {
    let alive = true
    Location.getLastKnownPositionAsync().then((pos: { coords: { latitude: number; longitude: number } } | null) => {
      if (!alive || !pos) return
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    }).catch((err: unknown) => {
      logCaught('theme-location', err)
    })
    return () => {
      alive = false
    }
  }, [])

  function update(patch: Partial<Prefs>) {
    setPrefs((current: Prefs) => {
      const next = { ...current, ...patch }
      authStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch((err: unknown) => {
        logCaught('theme-prefs-save', err)
      })
      return next
    })
  }

  const scheme = resolveScheme(prefs.displayMode, systemScheme)
  const colors = paletteFor(scheme)

  const value: ThemeValue = {
    colors,
    scheme,
    displayMode: prefs.displayMode,
    setDisplayMode: (displayMode: Prefs['displayMode']) => update({ displayMode }),
    solarPlace: coords ? 'Last known location' : 'Clemson, SC',
  }

  return (
    <ThemeContext.Provider value={value}>
      <SchemeFade scheme={scheme}>{children}</SchemeFade>
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}

/** Soft UI-thread cross-fade when Night mode flips, so the swap never pops. */
function SchemeFade({ scheme, children }: { scheme: Scheme; children: ReactNode }) {
  const fade = useSharedValue(1)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    fade.value = withSequence(withTiming(0.82, { duration: 90 }), withTiming(1, { duration: 200 }))
  }, [scheme, fade])
  const style = useAnimatedStyle(() => ({ opacity: fade.value }))
  return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>
}
