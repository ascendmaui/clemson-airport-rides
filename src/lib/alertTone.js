/**
 * Short in-app alert tone.
 * Do Not Disturb mutes new-request tones only. Mid-ride cancel always sounds.
 */

function dndMutesNewRequests(prefs) {
  return Boolean(prefs?.dndNewRequestTones)
}

export function shouldPlayAlertTone(kind, prefs) {
  if (kind === 'canceled_midride') return true
  if (kind === 'ride_requested') return !dndMutesNewRequests(prefs)
  return false
}

export function playAlertTone() {
  if (typeof window === 'undefined') return
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return
  try {
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const notes = [523.25, 659.25]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.16
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.15)
    })
    window.setTimeout(() => {
      ctx.close().catch(() => {})
    }, 700)
  } catch {
    /* autoplay or missing audio device */
  }
}
