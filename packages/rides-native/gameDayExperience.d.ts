export const GAME_DAY_ORANGE: string
export const GAME_DAY_PURPLE: string

export type GameDayPhase = 'off' | 'countdown' | 'live' | 'postgame'

export type GameDayExperience = {
  palette: { orange: string; purple: string }
  phase: GameDayPhase
  eventId: string | null
  eventTitle: string
  banner: {
    phase: GameDayPhase
    kicker: string
    title: string
    countdownLabel: string | null
    countdownCaption: string
    kickoffLabel: string | null
    live: boolean
  }
  zones: {
    headline: string
    body: string
    pickups: Array<{ id: string; kind: 'pickup'; name: string; instructions: string; walkMinutes: number | null }>
    dropoffs: Array<{ id: string; kind: 'dropoff'; name: string; instructions: string; walkMinutes: number | null }>
  }
  queue: {
    visible: boolean
    status: 'forming' | 'open' | 'busy' | 'paused' | 'closed'
    headline: string
    detail: string
    waitLabel: string | null
    ridersWaiting: number
    driversStaged: number
  }
  surge: {
    source: 'none' | 'event' | 'saturday'
    multiplier: number
    multiplierLabel: string
    upcomingLabel: string | null
    headline: string
    reasons: string[]
    riderLine: string
    driverLine: string
    disclosed: boolean
    driverBonusLabel: string | null
    calendarBonusLabel: string | null
  }
  prep: {
    headline: string
    progressLabel: string
    done: number
    total: number
    items: Array<{ id: string; title: string; detail: string; checked: boolean }>
  }
  timeline: {
    headline: string
    body: string
    windows: Array<{ id: string; label: string; heat: string; heatLabel: string; note: string; whenLabel: string; state: string }>
  }
}

export function buildGameDayExperience(input?: {
  now?: Date
  events?: unknown[]
  calendarEvents?: unknown[]
  zones?: unknown[] | null
  windows?: unknown[] | null
  prepItems?: unknown[] | null
  checkedIds?: string[]
  queue?: unknown
  surgeConfig?: unknown
}): GameDayExperience

export function loadGameDaySources(
  supabase: unknown,
  options?: { driverId?: string | null; now?: Date },
): Promise<Record<string, unknown>>

export function loadGameDayExperience(
  supabase: unknown,
  options?: { driverId?: string | null; now?: Date },
): Promise<{ sources: Record<string, unknown>; model: GameDayExperience }>

export function setGameDayPrepCheck(
  supabase: unknown,
  input: { driverId: string; eventId: string; itemId: string; checked: boolean },
): Promise<{ ok: boolean; persisted: boolean; error: string | null }>
