/**
 * New-ride alert: cha-ching tone + short haptic.
 * Quiet hours / DND and the ride notification toggle suppress both.
 */
import { isQuietNow } from './quietHours.js'

const CHIME_URL = '/sounds/ride-chime.wav'

let audioCtx = null
let chimeEl = null

export function shouldAlertForRide(prefs) {
  if (prefs && prefs.ride === false) return false
  if (isQuietNow(prefs)) return false
  return true
}

/** 70ms on, 40ms off, 120ms on. No-op when the device has no vibrate API. */
export function pulseRideHaptic() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([70, 40, 120])
    }
  } catch {
    /* unsupported */
  }
}

function tone(ctx, when, freq, dur, peak) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, when)
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(when)
  osc.stop(when + dur + 0.02)
}

function coinStrike(ctx, when) {
  const dur = 0.045
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const env = 1 - i / data.length
    data[i] = (Math.random() * 2 - 1) * env * env
  }
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 1800
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.08, when)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur)
  src.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)
  src.start(when)
  src.stop(when + dur)
}

/** Bright two-note cha-ching. Returns false when audio cannot start. */
export async function playRideChime() {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (Ctx) {
    try {
      if (!audioCtx || audioCtx.state === 'closed') audioCtx = new Ctx()
      if (audioCtx.state === 'suspended') await audioCtx.resume()
      if (audioCtx.state === 'running') {
        const now = audioCtx.currentTime + 0.01
        coinStrike(audioCtx, now)
        tone(audioCtx, now, 1568, 0.28, 0.11)
        tone(audioCtx, now, 2349, 0.22, 0.07)
        tone(audioCtx, now + 0.015, 523.25, 0.34, 0.035)
        coinStrike(audioCtx, now + 0.17)
        tone(audioCtx, now + 0.17, 2093, 0.26, 0.1)
        tone(audioCtx, now + 0.17, 3136, 0.2, 0.045)
        return true
      }
    } catch {
      /* fall through to the file */
    }
  }
  return playChimeFile()
}

function playChimeFile() {
  try {
    if (typeof Audio === 'undefined') return false
    if (!chimeEl) {
      chimeEl = new Audio(CHIME_URL)
      chimeEl.preload = 'auto'
    }
    chimeEl.currentTime = 0
    const pending = chimeEl.play()
    if (pending && typeof pending.catch === 'function') pending.catch(() => {})
    return true
  } catch {
    return false
  }
}

/** Tone and vibration together. Caller has already checked quiet hours. */
export async function playRideRequestAlert() {
  pulseRideHaptic()
  await playRideChime()
}
