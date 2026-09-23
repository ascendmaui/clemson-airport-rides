import { Platform, Vibration } from 'react-native'

/**
 * New-ride alert for the Expo shell.
 * Web: navigator.vibrate pattern (no-op where unsupported) plus a short cha-ching if Audio exists.
 * iOS: two Vibration pulses so the Taptic Engine fires twice.
 * Android: Vibration pattern 70ms, 40ms pause, 120ms.
 * Web / PWA: navigator.vibrate([70, 40, 120]) — no-op on browsers without the API.
 * Quiet hours / DND must be checked by the caller; this function does not play when quiet is true.
 */
export async function alertNewRide(quiet: boolean) {
  if (quiet) return
  pulseVibration()
  await playTone()
}

function pulseVibration() {
  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : null
    nav?.vibrate?.([70, 40, 120])
    return
  }
  if (Platform.OS === 'android') {
    Vibration.vibrate([0, 70, 40, 120])
    return
  }
  Vibration.vibrate(70)
  setTimeout(() => Vibration.vibrate(120), 110)
}

async function playTone() {
  if (Platform.OS !== 'web') return
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    || (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  try {
    const ctx = new Ctx()
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1568, now)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.3)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(2093, now + 0.16)
    gain2.gain.setValueAtTime(0.0001, now + 0.16)
    gain2.gain.exponentialRampToValueAtTime(0.1, now + 0.18)
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.42)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.16)
    osc2.stop(now + 0.45)
    setTimeout(() => ctx.close(), 700)
  } catch {
    /* autoplay blocked */
  }
}

export function isQuietPrefs(prefs: { ride?: boolean; quiet?: { dnd?: boolean; scheduleEnabled?: boolean; start?: string; end?: string } } | null, now = new Date()) {
  if (prefs && prefs.ride === false) return true
  const q = prefs?.quiet
  if (!q) return false
  if (q.dnd) return true
  if (!q.scheduleEnabled) return false
  const mins = now.getHours() * 60 + now.getMinutes()
  const toMin = (value?: string) => {
    const [h, m] = String(value || '0:0').split(':').map((n) => Number(n))
    return (h || 0) * 60 + (m || 0)
  }
  const start = toMin(q.start || '22:00')
  const end = toMin(q.end || '07:00')
  if (start === end) return true
  if (start < end) return mins >= start && mins < end
  return mins >= start || mins < end
}
