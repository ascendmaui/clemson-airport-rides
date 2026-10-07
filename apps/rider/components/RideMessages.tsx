import { TripThread } from 'rides-native/TripThread.jsx'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

export function RideMessages({ tripId, userId, promptLostItem = false }: { tripId: string; userId: string | null; promptLostItem?: boolean }) {
  const { colors } = useTheme()
  if (!userId) return null
  return (
    <TripThread
      supabase={supabase}
      tripId={tripId}
      userId={userId}
      colors={colors}
      promptLostItem={promptLostItem}
    />
  )
}
