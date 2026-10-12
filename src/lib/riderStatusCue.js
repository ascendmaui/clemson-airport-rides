/**
 * Web rider cues for "driver arrived" and "trip complete".
 * Same gate as the driver offer chime: ride alerts off or quiet hours / DND
 * silence both the tone and the vibration.
 */
import { shouldAlertForRide } from './rideAlert.js'

let ctx = null

export const RIDER_CUE_VIBRATION = {
  arrived: [90, 60, 90],
  completed: [60],
}

function note(audio, when, freq, dur, peak) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, when)
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(peak, when + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur)
  osc.connect(gain)
  gain.connect(audio.destination)
  osc.start(when)
  osc.stop(when + dur + 0.02)
}

/** Soft tones: arrived = two-note rise, completed = gentle three-note arpeggio. */
export async function playRiderTone(kind) {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!Ctx) return false
  try {
    if (!ctx || ctx.state === 'closed') ctx = new Ctx()
    if (ctx.state === 'suspended') await ctx.resume()
    if (ctx.state !== 'running') return false
    const t = ctx.currentTime + 0.01
    if (kind === 'arrived') {
      note(ctx, t, 880, 0.16, 0.08)
      note(ctx, t + 0.13, 1318.5, 0.26, 0.08)
    } else {
      note(ctx, t, 659.25, 0.16, 0.06)
      note(ctx, t + 0.12, 783.99, 0.16, 0.06)
      note(ctx, t + 0.24, 1046.5, 0.36, 0.06)
    }
    return true
  } catch {
    return false
  }
}

export function vibrateRiderCue(kind) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(RIDER_CUE_VIBRATION[kind] || [60])
    }
  } catch {
    /* unsupported */
  }
}

/** Returns false when settings silenced the cue. */
export async function riderStatusCue(kind, prefs) {
  if (kind !== 'arrived' && kind !== 'completed') return false
  if (!shouldAlertForRide(prefs)) return false
  vibrateRiderCue(kind)
  await playRiderTone(kind)
  return true
}
