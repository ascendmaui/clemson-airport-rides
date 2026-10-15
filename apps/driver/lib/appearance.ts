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
