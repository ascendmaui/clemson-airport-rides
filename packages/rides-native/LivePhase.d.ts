import type { ReactNode } from 'react'
import type { LiveStep } from './liveTrip'

export type LivePhaseColors = {
  orange: string
  purple: string
  title: string
  inkSecondary: string
  track?: string
}

export function LivePhase(props: {
  kicker?: string | null
  title: string
  body?: string | null
  eta?: string | null
  steps?: LiveStep[] | null
  activeIndex: number
  colors: LivePhaseColors
}): ReactNode
