import * as Location from 'expo-location'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { authStorage } from '@/lib/storage'
import { paletteFor, type Palette, type Scheme } from '@/lib/palette'
import { CLEMSON_LAT, CLEMSON_LNG, isDaylight } from '@/lib/solar'

export type DisplayMode = 'auto' | 'light' | 'dark'
export type NavApp = 'apple' | 'google'

type Prefs = {
  displayMode: DisplayMode
  earningsPrivate: boolean
  sounds: boolean
  navApp: NavApp
}

type ThemeValue = {
  colors: Palette
  scheme: Scheme
  displayMode: DisplayMode
  setDisplayMode: (mode: DisplayMode) => void
  earningsPrivate: boolean
  setEarningsPrivate: (value: boolean) => void
  sounds: boolean
  setSounds: (value: boolean) => void
  navApp: NavApp
  setNavApp: (value: NavApp) => void
  solarPlace: string
}

const PREFS_KEY = 'driver.ui.prefs'
const DEFAULT_PREFS: Prefs = {
  displayMode: 'auto',
  earningsPrivate: false,
  sounds: true,
  navApp: 'apple',
}

const ThemeContext = createContext<ThemeValue | null>(null)

function isDisplayMode(value: unknown): value is DisplayMode {
  return value === 'auto' || value === 'light' || value === 'dark'
}

function isNavApp(value: unknown): value is NavApp {
  return value === 'apple' || value === 'google'
}

function readPrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS
  try {
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      displayMode: isDisplayMode(parsed.displayMode) ? parsed.displayMode : DEFAULT_PREFS.displayMode,
      earningsPrivate: Boolean(parsed.earningsPrivate),
      sounds: parsed.sounds === false ? false : true,
      navApp: isNavApp(parsed.navApp) ? parsed.navApp : DEFAULT_PREFS.navApp,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function resolveScheme(mode: DisplayMode, daylight: boolean): Scheme {
  switch (mode) {
    case 'light':
      return 'light'
    case 'dark':
      return 'dark'
    case 'auto':
      return daylight ? 'light' : 'dark'
    default: {
      const unknown: never = mode
      return unknown
    }
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    authStorage.getItem(PREFS_KEY).then((raw) => {
      setPrefs(readPrefs(raw))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let alive = true
    Location.getLastKnownPositionAsync().then((pos) => {
      if (!alive || !pos) return
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  function update(patch: Partial<Prefs>) {
    setPrefs((current) => {
      const next = { ...current, ...patch }
      authStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }

  const daylight = isDaylight(now, coords?.lat ?? CLEMSON_LAT, coords?.lng ?? CLEMSON_LNG)
  const scheme = resolveScheme(prefs.displayMode, daylight)
  const colors = paletteFor(scheme)

  const value: ThemeValue = {
    colors,
    scheme,
    displayMode: prefs.displayMode,
    setDisplayMode: (displayMode) => update({ displayMode }),
    earningsPrivate: prefs.earningsPrivate,
    setEarningsPrivate: (earningsPrivate) => update({ earningsPrivate }),
    sounds: prefs.sounds,
    setSounds: (sounds) => update({ sounds }),
    navApp: prefs.navApp,
    setNavApp: (navApp) => update({ navApp }),
    solarPlace: coords ? 'Last known location' : 'Clemson, SC',
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
