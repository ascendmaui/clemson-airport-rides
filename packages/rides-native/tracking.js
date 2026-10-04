export const LOCATION_STALE_MS = 30000
export function trackingIssue(status, timestamp, now = Date.now()) {
  if (!['accepted', 'arriving', 'arrived', 'in_progress'].includes(status)) return null
  const time = Date.parse(timestamp || '')
  if (!Number.isFinite(time)) return 'Waiting for driver location. Retrying automatically.'
  if (now - time > LOCATION_STALE_MS || time > now + LOCATION_STALE_MS) {
    return 'Location updates stalled. Last known pin shown; ETA unavailable. Retrying automatically.'
  }
  return null
}

/** One fresh fix and acknowledged write at a time; never resend a cached fix as fresh. */
export function startLocationPublisher({ locate, publish, onFix, onError, intervalMs = 5000, timeoutMs = 15000 }) {
  let stopped = false
  let timer
  let deadline
  let running = false
  async function tick() {
    if (stopped || running) return
    running = true
    try {
      const fix = await Promise.race([
        locate(),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Location timed out')), timeoutMs) }),
      ])
      clearTimeout(deadline)
      if (stopped) return
      await Promise.race([
        publish(fix),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Location upload timed out')), timeoutMs) }),
      ])
      if (!stopped) { onFix(fix); onError(null) }
    } catch {
      if (!stopped) onError('Location sharing interrupted. Check location permission and connection. Retrying automatically.')
    } finally {
      clearTimeout(deadline)
      running = false
      if (!stopped) timer = setTimeout(tick, intervalMs)
    }
  }
  void tick()
  return () => { stopped = true; clearTimeout(timer); clearTimeout(deadline) }
}

/** Bound reads so an unresponsive connection cannot lock the retry button. */
export async function withTrackingTimeout(promise, timeoutMs = 15000) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tracking refresh timed out. Retrying automatically.')), timeoutMs)
      }),
    ])
  } finally { clearTimeout(timer) }
}
