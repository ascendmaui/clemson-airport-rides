/**
 * Auto-resume the driver's live trip on app relaunch.
 * Pure helpers: pick the trip to reopen and decide whether it is safe to jump there.
 */
import { isDueNow } from './tripTags.js'

export const RESUMABLE_STATUSES = Object.freeze(['accepted', 'arriving', 'arrived', 'in_progress'])
const RANK = { in_progress: 0, arrived: 1, arriving: 2, accepted: 3 }
const STALE_MS = 12 * 60 * 60 * 1000

function acceptedMs(row) {
  const at = Date.parse(row?.accepted_at || row?.acceptedAt || '')
  return Number.isFinite(at) ? at : 0
}

/**
 * The live trip to reopen, or null. Scheduled trips not yet due stay on Home,
 * and an accepted-but-never-started trip older than 12 hours is left alone.
 */
export function pickResumableTrip(rows, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const live = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!row?.id || !RESUMABLE_STATUSES.includes(row.status)) return false
    if (!isDueNow(row, new Date(nowMs))) return false
    const accepted = acceptedMs(row)
    if (row.status === 'accepted' && accepted && nowMs - accepted > STALE_MS) return false
    return true
  })
  live.sort((a, b) => (RANK[a.status] - RANK[b.status]) || (acceptedMs(b) - acceptedMs(a)))
  return live[0] || null
}

/** Only jump from Home (where a cold launch lands), once per trip per launch. */
export function shouldAutoResume({ tripId, pathname, handled }) {
  if (!tripId) return false
  if (handled && typeof handled.has === 'function' && handled.has(tripId)) return false
  const path = String(pathname ?? '/')
  return path === '/' || path === '' || path === '/index' || path === '/(tabs)'
}

export function resumeAnnouncement(status) {
  return status === 'in_progress' ? 'Resuming your trip to drop-off' : 'Resuming your live trip'
}
