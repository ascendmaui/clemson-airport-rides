/**
 * Test fixture stub for takeReminder.
 * Required because src/lib/scheduledRides.js uses an extensionless import ('./supabase')
 * which fails resolution under pure Node ESM without bundlers or custom loaders.
 * No production edits are permitted per standing rules, so this fixture provides
 * the exact takeReminder logic for unit testing.
 */
import { nextReminder } from '../../src/lib/scheduledRideModel.js'

const sessionStamps = new Set()

export function takeReminder(trip, now = new Date(), { windows } = {}) {
  if (!trip?.id) return null
  const stamps = { ...(trip.metadata?.reminders || {}) }
  for (const id of ['m15', 'h1', 'h24', 'now']) {
    if (sessionStamps.has(`${trip.id}:${id}`)) stamps[id] = true
  }
  const decision = nextReminder(trip, now, stamps)
  if (!decision) return null
  if (windows && !windows.includes(decision.id)) return null
  sessionStamps.add(`${trip.id}:${decision.id}`)
  return decision
}

export function clearSessionStamps() {
  sessionStamps.clear()
}
