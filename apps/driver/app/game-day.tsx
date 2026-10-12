import { useRouter } from 'expo-router'
import { GameDayBoard } from 'rides-native/GameDayBoard.jsx'
import { useGameDayExperience } from 'rides-native/useGameDayExperience.js'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function DriverGameDayScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { model, ready, togglePrep } = useGameDayExperience(supabase, { driverId: user?.id || null })

  return (
    <StackPage title="Game day" onBack={() => router.back()}>
      {ready ? (
        <GameDayBoard model={model} audience="driver" onTogglePrep={togglePrep} />
      ) : null}
    </StackPage>
  )
}
