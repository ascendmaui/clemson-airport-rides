import type { ReactNode } from 'react'

type WomenOnlyColors = {
  orange?: string
  purple?: string
  purpleSoft?: string
  card?: string
  border?: string
  title?: string
  ink?: string
  inkSecondary?: string
  onAccent?: string
}

export function WomenOnlyCard(props: {
  role?: string
  genderIdentity?: string | null
  womenOnlyMatching?: boolean
  busy?: boolean
  available?: boolean
  note?: string | null
  colors?: WomenOnlyColors | null
  onGender?: (id: string) => void
  onToggle?: (next: boolean) => void
}): ReactNode
