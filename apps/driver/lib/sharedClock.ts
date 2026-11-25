/**
 * One shared 1s clock for every countdown on screen (offer cards, wait timer, trip countdowns, dashcam).
 * A single interval runs only while something is subscribed, so N cards cost one timer, not N.
 * Pure: no React import, so node tests can drive it with a fake timer.
 */
export type SecondClock = {
  now: () => number
  subscribe: (listener: () => void) => () => void
  listenerCount: () => number
}

type TimerApi = {
  intervalMs?: number
  read?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export function createSecondClock({
  intervalMs = 1000,
  read = Date.now,
  setTimer = (fn, ms) => setInterval(fn, ms),
  clearTimer = (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}: TimerApi = {}): SecondClock {
  const listeners = new Set<() => void>()
  let current = read()
  let handle: unknown = null
  const tick = () => {
    current = read()
    for (const listener of [...listeners]) {
      try { listener() } catch (err) { console.warn('[driver] shared clock listener', err) }
    }
  }
  return {
    now: () => current,
    subscribe(listener) {
      listeners.add(listener)
      if (handle == null) {
        current = read()
        handle = setTimer(tick, intervalMs)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && handle != null) {
          clearTimer(handle)
          handle = null
        }
      }
    },
    listenerCount: () => listeners.size,
  }
}

export const secondClock = createSecondClock()
