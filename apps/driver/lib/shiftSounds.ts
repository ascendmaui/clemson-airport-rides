import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
import startSound from '@/assets/sounds/start_rides.wav'
import stopSound from '@/assets/sounds/stop_rides.wav'

const players = new Map<string, AudioPlayer>()

function player(kind: 'start' | 'stop') {
  let current = players.get(kind)
  if (!current) {
    current = createAudioPlayer(kind === 'stop' ? stopSound : startSound)
    current.volume = 0.4
    players.set(kind, current)
  }
  return current
}

/** Subtle start or stop tone. Does not use the ride-offer request player. */
export function playShiftSound(kind: 'start' | 'stop') {
  try {
    const clip = player(kind)
    clip.seekTo(0).then(() => clip.play()).catch(() => {})
  } catch {
    /* a missing asset should not block the shift */
  }
}
