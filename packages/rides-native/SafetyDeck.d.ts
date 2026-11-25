import type { ReactNode } from 'react'

export function SafetyDeck(props: {
  colors: any
  activeId: string
  onChange?: (id: string) => void
  children?: ReactNode
  description?: string | null
}): ReactNode
