import * as Location from 'expo-location'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { authStorage } from '@/lib/storage'
import { paletteFor, type Palette, type Scheme } from '@/lib/palette'
import { CLEMSON_LAT, CLEMSON_LNG, isDaylight } from '@/lib/solar'
import { isNavApp as isKnownNavApp, type NavApp as SharedNavApp } from 'rides-native/mapsLink'

export type DisplayMode = 'auto' | 'light' | 'dark'
export type NavApp = SharedNavApp
export type RideAlertTier = 'standard' | 'wait' | 'comfort' | 'carpool'
export type RideAlertMode = 'chime_vibrate' | 'chime' | 'vibrate' | 'silent'

export type FavoriteRider = { id: string; name: string }

export type AutoAcceptPrefs = {
  distanceEnabled: boolean
  maxPickupMiles: number
  hourlyEnabled: boolean
  minHourlyCents: number
  favoritesEnabled: boolean
  favoriteRiders: FavoriteRider[]
}

type RideAlerts = Record<RideAlertTier, RideAlertMode>

type Prefs = {
  displayMode: DisplayMode
  earningsPrivate: boolean
  sounds: boolean
  navApp: NavApp
  autoNavigate: boolean
  rideAlerts: RideAlerts
  autoAccept: AutoAcceptPrefs
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
  autoNavigate: boolean
  setAutoNavigate: (value: boolean) => void
  rideAlerts: RideAlerts
  setRideAlert: (tier: RideAlertTier, mode: RideAlertMode) => void
  autoAccept: AutoAcceptPrefs
  setAutoAccept: (patch: Partial<AutoAcceptPrefs>) => void
  solarPlace: string
}

const PREFS_KEY = 'driver.ui.prefs'
const DEFAULT_ALERTS: RideAlerts = { standard: 'chime_vibrate', wait: 'chime_vibrate', comfort: 'chime_vibrate', carpool: 'chime_vibrate' }
const DEFAULT_AUTO: AutoAcceptPrefs = {
  distanceEnabled: false,
  maxPickupMiles: 3,
  hourlyEnabled: false,
  minHourlyCents: 2000,
  favoritesEnabled: false,
  favoriteRiders: [],
}
const DEFAULT_PREFS: Prefs = {
  displayMode: 'auto',
  earningsPrivate: false,
  sounds: true,
  navApp: 'apple',
  autoNavigate: true,
  rideAlerts: DEFAULT_ALERTS,
  autoAccept: DEFAULT_AUTO,
}

function isRideMode(value: unknown): value is RideAlertMode {
  return value === 'chime_vibrate' || value === 'chime' || value === 'vibrate' || value === 'silent'
}

function readAlerts(raw: unknown): RideAlerts {
  const source = raw && typeof raw === 'object' ? raw as Partial<Record<RideAlertTier, unknown>> : {}
  return {
    standard: isRideMode(source.standard) ? source.standard : DEFAULT_ALERTS.standard,
    wait: isRideMode(source.wait) ? source.wait : DEFAULT_ALERTS.wait,
    comfort: isRideMode(source.comfort) ? source.comfort : DEFAULT_ALERTS.comfort,
    carpool: isRideMode(source.carpool) ? source.carpool : DEFAULT_ALERTS.carpool,
  }
}

function readAuto(raw: unknown): AutoAcceptPrefs {
  const source = raw && typeof raw === 'object' ? raw as Partial<AutoAcceptPrefs> : {}
  const miles = Number(source.maxPickupMiles)
  const hourly = Number(source.minHourlyCents)
  const riders = Array.isArray(source.favoriteRiders)
    ? source.favoriteRiders.flatMap((row) => {
      const id = typeof row?.id === 'string' ? row.id.trim() : ''
      if (!id) return []
      const name = typeof row?.name === 'string' && row.name.trim() ? row.name.trim() : 'Rider'
      return [{ id, name }]
    }).slice(0, 50)
    : []
  return {
    distanceEnabled: Boolean(source.distanceEnabled),
    maxPickupMiles: Number.isFinite(miles) ? Math.min(50, Math.max(0.5, miles)) : DEFAULT_AUTO.maxPickupMiles,
    hourlyEnabled: Boolean(source.hourlyEnabled),
    minHourlyCents: Number.isFinite(hourly) ? Math.min(50000, Math.max(0, Math.round(hourly))) : DEFAULT_AUTO.minHourlyCents,
    favoritesEnabled: Boolean(source.favoritesEnabled),
    favoriteRiders: riders,
  }
}

const ThemeContext = createContext<ThemeValue | null>(null)

function isDisplayMode(value: unknown): value is DisplayMode {
  return value === 'auto' || value === 'light' || value === 'dark'
}

function isNavApp(value: unknown): value is NavApp {
  return isKnownNavApp(value)
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
      autoNavigate: parsed.autoNavigate === false ? false : true,
      rideAlerts: readAlerts(parsed.rideAlerts),
      autoAccept: readAuto(parsed.autoAccept),
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
    Location.getLastKnownPositionAsync().then((pos: { coords: { latitude: number; longitude: number } } | null) => {
      if (!alive || !pos) return
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  function update(patch: Partial<Prefs>) {
    setPrefs((current: Prefs) => {
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
    setDisplayMode: (displayMode: Prefs['displayMode']) => update({ displayMode }),
    earningsPrivate: prefs.earningsPrivate,
    setEarningsPrivate: (earningsPrivate: boolean) => update({ earningsPrivate }),
    sounds: prefs.sounds,
    setSounds: (sounds: boolean) => update({ sounds }),
    navApp: prefs.navApp,
    setNavApp: (navApp: Prefs['navApp']) => update({ navApp }),
    autoNavigate: prefs.autoNavigate,
    setAutoNavigate: (autoNavigate: boolean) => update({ autoNavigate }),
    rideAlerts: prefs.rideAlerts,
    setRideAlert: (tier: RideAlertTier, mode: RideAlertMode) => update({
      rideAlerts: { ...prefs.rideAlerts, [tier]: mode },
    }),
    autoAccept: prefs.autoAccept,
    setAutoAccept: (patch: Partial<AutoAcceptPrefs>) => update({
      autoAccept: { ...prefs.autoAccept, ...patch },
    }),
    solarPlace: coords ? 'Last known location' : 'Clemson, SC',
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
