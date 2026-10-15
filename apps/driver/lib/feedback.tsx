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

function releasePlayer(player: AudioPlayer | null) {
  if (!player) return
  try {
    player.release()
  } catch {
    /* already released, or the native player never came up */
  }
}

function createCuePlayer(source: number, volume: number): AudioPlayer | null {
  let player: AudioPlayer | null = null
  try {
    player = createAudioPlayer(source)
    player.volume = volume
    return player
  } catch {
    releasePlayer(player)
    return null
  }
}

function asThenable(value: unknown): Promise<unknown> | null {
  if (value && typeof (value as { then?: unknown }).then === 'function') return value as Promise<unknown>
  return null
}

/** seekTo/play can throw or reject when an asset fails to bind. Swallow both. */
function safeSeekAndPlay(player: AudioPlayer) {
  let pending: unknown
  try {
    pending = player.seekTo(0)
  } catch {
    return
  }
  const start = () => {
    try {
      const playing = player.play() as unknown
      const task = asThenable(playing)
      if (task) void task.then(() => {}, () => {})
    } catch {
      /* play() can throw on a broken native player */
    }
  }
  try {
    const task = asThenable(pending)
    if (task) void task.then(start, () => {})
    else start()
  } catch {
    /* attaching a handler to a broken thenable must not escape */
  }
}

function fireNotification(kind: Pulse) {
  try {
    void Haptics.notificationAsync(hapticFor(kind)).catch(() => {})
  } catch {
    /* simulators can omit the motor */
  }
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { sounds, rideAlerts } = useTheme()
  const soundsRef = useRef(sounds)
  const alertsRef = useRef(rideAlerts)
  soundsRef.current = sounds
  alertsRef.current = rideAlerts
  const playerRef = useRef<AudioPlayer | null>(null)
  // Accept and complete are created on first play. A bad asset must not crash startup or Start trip.
  const acceptRef = useRef<AudioPlayer | null>(null)
  const completeRef = useRef<AudioPlayer | null>(null)
  const goRef = useRef<AudioPlayer | null>(null)
  const endRef = useRef<AudioPlayer | null>(null)
  const pulseTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let alive = true
    try {
      void setAudioModeAsync({
        playsInSilentMode: false,
        interruptionMode: 'mixWithOthers',
      }).catch((err: unknown) => console.warn('[driver] audio mode', err instanceof Error ? err.message : err))
    } catch {
      /* audio session setup can fail closed */
    }
    const player = createCuePlayer(requestSound, 0.35)
    const go = createCuePlayer(goSound, 1)
    const end = createCuePlayer(endSound, 1)
    if (alive) {
      playerRef.current = player
      goRef.current = go
      endRef.current = end
    }
    return () => {
      alive = false
      if (pulseTimer.current) clearInterval(pulseTimer.current)
      const requestPlayer = playerRef.current
      const acceptPlayer = acceptRef.current
      const completePlayer = completeRef.current
      const goPlayer = goRef.current
      const endPlayer = endRef.current
      playerRef.current = null
      acceptRef.current = null
      completeRef.current = null
      goRef.current = null
      endRef.current = null
      releasePlayer(requestPlayer)
      if (acceptPlayer !== requestPlayer) releasePlayer(acceptPlayer)
      if (completePlayer !== requestPlayer) releasePlayer(completePlayer)
      releasePlayer(goPlayer)
      releasePlayer(endPlayer)
    }
  }, [])

  const api = useMemo<FeedbackApi>(() => {
    function play(kind: Pulse = 'request') {
      try {
        if (kind === 'accept' || kind === 'complete') {
          const ref = kind === 'accept' ? acceptRef : completeRef
          const source = kind === 'accept' ? acceptSound : completeSound
          if (!ref.current) ref.current = createCuePlayer(source, 0.3) ?? playerRef.current
        }
        const player = kind === 'accept' ? acceptRef.current : kind === 'complete' ? completeRef.current : playerRef.current
        if (!player) return
        safeSeekAndPlay(player)
      } catch {
        /* creation or playback must not escape pulse() */
      }
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
          safeSeekAndPlay(player)
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
        try {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        } catch {
          /* simulators can omit the motor */
        }
        if (soundsRef.current) play()
        return
      }
      const requestPlay = kind === 'request' ? playbackForTier(alertsRef.current, options?.tier) : null
      const vibrate = requestPlay ? requestPlay.vibrate : true
      const sound = requestPlay ? requestPlay.sound && soundsRef.current : soundsRef.current && (kind === 'accept' || kind === 'complete')
      if (vibrate) fireNotification(kind)
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
