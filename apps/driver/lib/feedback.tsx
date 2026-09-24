import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Haptics from 'expo-haptics'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import requestSound from '@/assets/sounds/request.wav'
import { useTheme } from '@/lib/theme'

export type Pulse = 'request' | 'accept' | 'decline' | 'online' | 'complete'

type FeedbackApi = { pulse: (kind: Pulse) => void }

const FeedbackContext = createContext<FeedbackApi>({ pulse: () => {} })

function hapticFor(kind: Pulse) {
  switch (kind) {
    case 'request':
      return Haptics.NotificationFeedbackType.Warning
    case 'accept':
    case 'complete':
    case 'online':
      return Haptics.NotificationFeedbackType.Success
    case 'decline':
      return Haptics.NotificationFeedbackType.Error
    default: {
      const unknown: never = kind
      return unknown
    }
  }
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { sounds } = useTheme()
  const soundsRef = useRef(sounds)
  soundsRef.current = sounds
  const playerRef = useRef<AudioPlayer | null>(null)

  useEffect(() => {
    let alive = true
    setAudioModeAsync({
      playsInSilentMode: false,
      interruptionMode: 'mixWithOthers',
    }).catch(() => {})
    const player = createAudioPlayer(requestSound)
    player.volume = 0.35
    if (alive) playerRef.current = player
    return () => {
      alive = false
      playerRef.current = null
      player.release()
    }
  }, [])

  const api = useMemo<FeedbackApi>(() => ({
    pulse(kind) {
      Haptics.notificationAsync(hapticFor(kind)).catch(() => {})
      if (!soundsRef.current) return
      if (kind !== 'request' && kind !== 'accept' && kind !== 'complete') return
      const player = playerRef.current
      if (!player) return
      player.seekTo(0).then(() => player.play()).catch(() => {})
    },
  }), [])

  return <FeedbackContext.Provider value={api}>{children}</FeedbackContext.Provider>
}

export function useFeedback() {
  return useContext(FeedbackContext)
}
