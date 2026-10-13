import type { ReactNode } from 'react'

type ClickwrapColors = {
  background?: string
  title?: string
  ink?: string
  inkSecondary?: string
  orange?: string
  card?: string
  border?: string
  link?: string
}

export function DriverClickwrap(props: {
  onAgree?: () => void
  busy?: boolean
  colors?: ClickwrapColors
  error?: string | null
  onBack?: () => void
}): ReactNode
