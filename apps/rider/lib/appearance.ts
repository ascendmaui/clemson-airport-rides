export type DisplayMode = 'auto' | 'light' | 'dark'

/** Missing or unknown prefs follow the phone. Light and Dark are explicit overrides. */
export function readDisplayMode(value: unknown): DisplayMode {
  switch (value) {
    case 'auto':
    case 'light':
    case 'dark':
      return value
    default:
      return 'auto'
  }
}

/**
 * Build 44 saved Night mode as `displayMode: 'dark'` with no migration flag.
 * The first launch of the System/Light/Dark control resets that once.
 * A later explicit choice sets `appearanceMigrated` and is left alone.
 */
export function migrateAppearance(parsed: { displayMode?: unknown; appearanceMigrated?: unknown } | null | undefined): {
  displayMode: DisplayMode
  appearanceMigrated: true
} {
  if (parsed?.appearanceMigrated === true) {
    return { displayMode: readDisplayMode(parsed.displayMode), appearanceMigrated: true }
  }
  return { displayMode: 'auto', appearanceMigrated: true }
}

/** `auto` uses the iOS/Android color scheme. A null scheme opens light. */
export function resolveScheme(mode: DisplayMode, systemScheme: 'light' | 'dark' | null | undefined): 'light' | 'dark' {
  switch (mode) {
    case 'light':
      return 'light'
    case 'dark':
      return 'dark'
    case 'auto':
      return systemScheme === 'dark' ? 'dark' : 'light'
    default: {
      const unknown: never = mode
      return unknown
    }
  }
}
