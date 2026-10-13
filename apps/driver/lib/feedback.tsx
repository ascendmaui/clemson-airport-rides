import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Haptics from 'expo-haptics'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import requestSound from '@/assets/sounds/request.wav'
import acceptSound from '@/assets/sounds/accept.wav'
import completeSound from '@/assets/sounds/complete.wav'
import goSound from '@/assets/sounds/go.wav'
import endSound from '@/assets/sounds/end.wav'
import { playbackForTier } from 'rides-native/offerLadder.js'
import { playShiftCue, type ShiftControl, type ShiftSound } from '@/lib/shiftCue'
import { useTheme } from '@/lib/theme'

export type Pulse = 'request' | 'accept' | 'decline' | 'online' | 'complete' | 'cancel'

type PulseOptions = { tier?: string | null }

type FeedbackApi = {
  pulse: (kind: Pulse, options?: PulseOptions) => void
  pulseShift: (control: ShiftControl) => void
  startRequestPulse: (tier?: string | null) => void
  stopRequestPulse: () => void
}

const FeedbackContext = createContext<FeedbackApi>({
  pulse: () => {},
  pulseShift: () => {},
  startRequestPulse: () => {},
  stopRequestPulse: () => {},
})

function impactStyle(style: 'heavy' | 'light') {
  switch (style) {
    case 'heavy':
      return Haptics.ImpactFeedbackStyle.Heavy
    case 'light':
      return Haptics.ImpactFeedbackStyle.Light
    default: {
      const unknown: never = style
      return unknown
    }
  }
}

function hapticFor(kind: Pulse) {
  switch (kind) {
    case 'request':
      return Haptics.NotificationFeedbackType.Warning
    case 'accept':
    case 'complete':
    case 'online':
      return Haptics.NotificationFeedbackType.Success
    case 'decline':
    case 'cancel':
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
  // Distinct, quieter cues so accept and trip-complete never sound like a new offer.
  const acceptRef = useRef<AudioPlayer | null>(null)
  const completeRef = useRef<AudioPlayer | null>(null)
  const goRef = useRef<AudioPlayer | null>(null)
  const endRef = useRef<AudioPlayer | null>(null)
  const pulseTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let alive = true
    setAudioModeAsync({
      playsInSilentMode: false,
      interruptionMode: 'mixWithOthers',
    }).catch(() => {})
    const player = createAudioPlayer(requestSound)
    player.volume = 0.35
    const accept = createAudioPlayer(acceptSound)
    accept.volume = 0.3
    const complete = createAudioPlayer(completeSound)
    complete.volume = 0.3
    const go = createAudioPlayer(goSound)
    go.volume = 0.7
    const end = createAudioPlayer(endSound)
    end.volume = 0.35
    if (alive) {
      playerRef.current = player
      acceptRef.current = accept
      completeRef.current = complete
      goRef.current = go
      endRef.current = end
    }
    return () => {
      alive = false
      if (pulseTimer.current) clearInterval(pulseTimer.current)
      playerRef.current = null
      acceptRef.current = null
      completeRef.current = null
      goRef.current = null
      endRef.current = null
      player.release()
      accept.release()
      complete.release()
      go.release()
      end.release()
    }
  }, [])

  const api = useMemo<FeedbackApi>(() => {
    function play(kind: Pulse = 'request') {
      const player = kind === 'accept' ? acceptRef.current : kind === 'complete' ? completeRef.current : playerRef.current
      if (!player) return
      player.seekTo(0).then(() => player.play()).catch(() => {})
    }
    function playerFor(sound: ShiftSound) {
      switch (sound) {
        case 'go':
          return goRef.current
        case 'end':
          return endRef.current
        default: {
          const unknown: never = sound
          return unknown
        }
      }
    }
    function pulseShift(control: ShiftControl) {
      void playShiftCue(control, {
        sounds: soundsRef.current,
        play: (sound) => {
          const player = playerFor(sound)
          if (!player) return
          player.seekTo(0).then(() => player.play()).catch(() => {})
        },
        impact: (style) => {
          Haptics.impactAsync(impactStyle(style)).catch(() => {})
        },
        success: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        },
        delay: (ms) => new Promise((resolve) => {
          setTimeout(resolve, ms)
        }),
      })
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
      if (sound) play(kind)
    }
    return {
      pulse,
      pulseShift,
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
