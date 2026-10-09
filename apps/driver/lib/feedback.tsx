import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Haptics from 'expo-haptics'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import requestSound from '@/assets/sounds/request.wav'
import { playbackForTier } from 'rides-native/offerLadder.js'
import { useTheme } from '@/lib/theme'

export type Pulse = 'request' | 'accept' | 'decline' | 'online' | 'complete'

type PulseOptions = { tier?: string | null }

type FeedbackApi = {
  pulse: (kind: Pulse, options?: PulseOptions) => void
  startRequestPulse: (tier?: string | null) => void
  stopRequestPulse: () => void
}

const FeedbackContext = createContext<FeedbackApi>({
  pulse: () => {},
  startRequestPulse: () => {},
  stopRequestPulse: () => {},
})

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
  const { sounds, rideAlerts } = useTheme()
  const soundsRef = useRef(sounds)
  const alertsRef = useRef(rideAlerts)
  soundsRef.current = sounds
  alertsRef.current = rideAlerts
  const playerRef = useRef<AudioPlayer | null>(null)
  const pulseTimer = useRef<ReturnType<typeof setInterval> | null>(null)

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
      if (pulseTimer.current) clearInterval(pulseTimer.current)
      playerRef.current = null
      player.release()
    }
  }, [])

  const api = useMemo<FeedbackApi>(() => {
    function play() {
      const player = playerRef.current
      if (!player) return
      player.seekTo(0).then(() => player.play()).catch(() => {})
    }
    function pulse(kind: Pulse, options?: PulseOptions) {
      if (kind === 'online') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        if (soundsRef.current) play()
        return
      }
      const requestPlay = kind === 'request' ? playbackForTier(alertsRef.current, options?.tier) : null
      const vibrate = requestPlay ? requestPlay.vibrate : true
      const sound = requestPlay ? requestPlay.sound && soundsRef.current : soundsRef.current && (kind === 'accept' || kind === 'complete')
      if (vibrate) Haptics.notificationAsync(hapticFor(kind)).catch(() => {})
      if (sound) play()
    }
    return {
      pulse,
      startRequestPulse(tier?: string | null) {
        if (pulseTimer.current) clearInterval(pulseTimer.current)
        pulse('request', { tier })
        pulseTimer.current = setInterval(() => pulse('request', { tier }), 1500)
      },
      stopRequestPulse() {
        if (!pulseTimer.current) return
        clearInterval(pulseTimer.current)
        pulseTimer.current = null
      },
    }
  }, [])

  return <FeedbackContext.Provider value={api}>{children}</FeedbackContext.Provider>
}

export function useFeedback() {
  return useContext(FeedbackContext)
}
