import type { ReactNode } from 'react'

export function AdminInboxScreen(props: {
  supabase: unknown
  colors?: any
  onBack: () => void
  onOpenWeb?: (url?: string) => void
}): ReactNode
