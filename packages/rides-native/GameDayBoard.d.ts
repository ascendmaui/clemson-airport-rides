import type { ReactNode } from 'react'

export function GameDayBanner(props: {
  model: any
  onPress?: () => void
}): ReactNode

export function GameDaySurgeLine(props: {
  model: any
  online?: boolean
  onPress?: () => void
  peak?: any
  colors?: any
}): ReactNode

export function GameDayBoard(props: {
  model: any
  audience?: string
  onTogglePrep?: (itemId: string) => void
}): ReactNode
