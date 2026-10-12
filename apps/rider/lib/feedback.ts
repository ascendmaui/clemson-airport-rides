import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Haptics from 'expo-haptics'
import pingSource from '../assets/sounds/ping.wav'
import tigerSource from '../assets/sounds/tiger.wav'
import { authStorage } from '@/lib/storage'

const SOUNDS_KEY = 'rider.sounds.enabled'
const HAPTICS_KEY = 'rider.haptics.enabled'
let hapticsCache: boolean | null = null

let player: AudioPlayer | null = null
let pingPlayer: AudioPlayer | null = null
let modeReady = false

export async function soundsEnabled() {
  const raw = await authStorage.getItem(SOUNDS_KEY)
  if (raw == null) return true
  return raw !== '0'
}

export async function setSoundsEnabled(on: boolean) {
  await authStorage.setItem(SOUNDS_KEY, on ? '1' : '0')
}

/** Rider haptics setting (Account → Haptics). Default on. Every rider buzz honors it. */
export async function hapticsEnabled() {
  if (hapticsCache != null) return hapticsCache
  const raw = await authStorage.getItem(HAPTICS_KEY)
  hapticsCache = raw == null ? true : raw !== '0'
  return hapticsCache
}

export async function setHapticsEnabled(on: boolean) {
  hapticsCache = on
  await authStorage.setItem(HAPTICS_KEY, on ? '1' : '0')
}

export async function tapHaptic() {
  if (!(await hapticsEnabled())) return
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  } catch {
    /* web and simulators can omit the motor */
  }
}

export async function successHaptic() {
  if (!(await hapticsEnabled())) return
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  } catch {
    /* web and simulators can omit the motor */
  }
}

export async function warningHaptic() {
  if (!(await hapticsEnabled())) return
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
  } catch {
    /* web and simulators can omit the motor */
  }
}

export type ApproachHapticLevel = 'light' | 'medium' | 'heavy'

/** Approach buzz uses the same try/catch motor path as tap and success haptics. */
export async function approachHaptic(level: ApproachHapticLevel) {
  if (!(await hapticsEnabled())) return
  try {
    switch (level) {
      case 'light':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        return
      case 'medium':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        return
      case 'heavy':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        return
      default: {
        const neverLevel: never = level
        return neverLevel
      }
    }
  } catch {
    /* web and simulators can omit the motor */
  }
}

/**
 * One strong "driver is here" cue when the driver first gets within the
 * here radius: success notification, a heavy follow-up tap, and one ping.
 * Each part honors its own setting (haptics / sounds + mute switch).
 */
export async function arrivalCue() {
  if (await hapticsEnabled()) {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setTimeout(() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}) }, 140)
    } catch {
      /* web and simulators can omit the motor */
    }
  }
  await playApproachPing()
}

/**
 * Clemson cue via expo-audio. playsInSilentMode is false so iOS mute and
 * Android silent/vibrate suppress the clip.
 */
/** Short locator ping for the crowd-find approach alert. Honors the mute switch. */
export async function playApproachPing() {
  if (!(await soundsEnabled())) return
  try {
    if (!modeReady) {
      await setAudioModeAsync({
        playsInSilentMode: false,
        interruptionMode: 'mixWithOthers',
        allowsRecording: false,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      })
      modeReady = true
    }
    if (!pingPlayer) pingPlayer = createAudioPlayer(pingSource)
    await pingPlayer.seekTo(0)
    pingPlayer.play()
  } catch {
    /* asset or platform audio can fail closed */
  }
}

export async function playTigerCue() {
  if (!(await soundsEnabled())) return
  try {
    if (!modeReady) {
      await setAudioModeAsync({
        playsInSilentMode: false,
        interruptionMode: 'mixWithOthers',
        allowsRecording: false,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      })
      modeReady = true
    }
    if (!player) player = createAudioPlayer(tigerSource)
    await player.seekTo(0)
    player.play()
  } catch {
    /* asset or platform audio can fail closed */
  }
}
