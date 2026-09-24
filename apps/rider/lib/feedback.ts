import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Haptics from 'expo-haptics'
import tigerSource from '../assets/sounds/tiger.wav'
import { authStorage } from '@/lib/storage'

const SOUNDS_KEY = 'rider.sounds.enabled'

let player: AudioPlayer | null = null
let modeReady = false

export async function soundsEnabled() {
  const raw = await authStorage.getItem(SOUNDS_KEY)
  if (raw == null) return true
  return raw !== '0'
}

export async function setSoundsEnabled(on: boolean) {
  await authStorage.setItem(SOUNDS_KEY, on ? '1' : '0')
}

export async function tapHaptic() {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  } catch {
    /* web and simulators can omit the motor */
  }
}

export async function successHaptic() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  } catch {
    /* web and simulators can omit the motor */
  }
}

export async function warningHaptic() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
  } catch {
    /* web and simulators can omit the motor */
  }
}

export type ApproachHapticLevel = 'light' | 'medium' | 'heavy'

/** Approach buzz uses the same try/catch motor path as tap and success haptics. */
export async function approachHaptic(level: ApproachHapticLevel) {
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
 * Clemson cue via expo-audio. playsInSilentMode is false so iOS mute and
 * Android silent/vibrate suppress the clip.
 */
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
