import type { ReactNode } from 'react'
import type { CounterpartView } from './partyProfile'

export type PartyColors = {
  background: string
  card: string
  ink: string
  inkSecondary: string
  title: string
  orange: string
  purple: string
  onAccent: string
  border: string
  danger: string
}

export const LIGHT_PARTY: PartyColors

export function partyColorsFromPalette(colors: Partial<PartyColors> | null | undefined): PartyColors

export function ProfileRequiredGate(props: {
  user: { id: string } | null | undefined
  supabase: unknown
}): null

export function RideStyleChips(props: {
  value: string
  onChange: (style: string) => void
  colors?: PartyColors
}): ReactNode

export function CounterpartCard(props: {
  person: CounterpartView | null
  colors?: PartyColors
}): ReactNode

export function ProfileSetupScreen(props: {
  supabase: unknown
  user: { id: string; user_metadata?: { full_name?: string } } | null | undefined
  colors?: PartyColors
  mark?: string
  onDone?: () => void
  onSignOut?: () => void
}): ReactNode

export function RateTripPanel(props: {
  supabase: unknown
  userId: string
  tripId: string
  colors?: PartyColors
  onDone?: () => void
  onLater?: () => void
}): ReactNode

export function loadRatingSummary(
  supabase: unknown,
  userId: string,
): Promise<{ line: string; pending: { id?: string; pickup_label?: string | null; dropoff_label?: string | null } | null }>
