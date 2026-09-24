export const GAME_DAY_LIVE_COPY: string
export const GAME_DAY_OFF_COPY: string

export type GameDayEvent = {
  title?: string | null
  surge_multiplier?: number | null
  pickup_zone_label?: string | null
}

export type GameDayNotice = {
  live: boolean
  title: string
  zone: string | null
  multiplier: number | null
  multiplierLabel: string | null
  headline: string
  detail: string | null
  body: string
}

export function gameDayNotice(event: GameDayEvent | null | undefined): GameDayNotice
