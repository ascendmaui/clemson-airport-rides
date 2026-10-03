const SOURCES = {
  start: '/sounds/start_rides.wav',
  stop: '/sounds/stop_rides.wav',
}

const clips = new Map()

function clip(kind) {
  if (typeof Audio === 'undefined') return null
  let audio = clips.get(kind)
  if (!audio) {
    audio = new Audio(SOURCES[kind])
    audio.preload = 'auto'
    audio.volume = 0.4
    clips.set(kind, audio)
  }
  return audio
}

/** Subtle start or stop tone. Separate from the ride-offer chime. */
export function playShiftSound(kind) {
  const audio = clip(kind === 'stop' ? 'stop' : 'start')
  if (!audio) return
  try {
    audio.currentTime = 0
    const played = audio.play()
    if (played && typeof played.catch === 'function') played.catch(() => {})
  } catch {
    /* autoplay or a missing file should not block the shift */
  }
}
