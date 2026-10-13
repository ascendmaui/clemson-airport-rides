/**
 * One driver presence heartbeat per app, no matter how many Home screens are mounted.
 *
 * Only this heartbeat writes driver_status.online = true, and only while the driver's
 * intent is "online" (set by GO, or adopted from the server on first load). END flips the
 * intent, bumps a generation, and stops the publisher; any write that started before END
 * sees the generation change and drops its online flag. Trip location keeps flowing during
 * an active trip, but those writes never set online.
 */

export const HEARTBEAT_SOURCE = 'heartbeat'
export const GO_SOURCE = 'go'

export function createPresenceHeartbeat({ startPublisher, write }) {
  let driverId = null
  let intent = null // 'online' | 'offline' | null (unknown until the first server read)
  let trip = null
  let generation = 0
  let stop = null
  const fixListeners = new Set()
  const stateListeners = new Set()

  const wanted = () => Boolean(driverId) && (intent === 'online' || Boolean(trip))
  const emit = () => { for (const listener of stateListeners) listener(snapshot()) }

  function snapshot() {
    return { driverId, intent, running: Boolean(stop), trip, generation }
  }

  function sync() {
    if (wanted() && !stop) {
      stop = startPublisher(handleFix) || (() => {})
    } else if (!wanted() && stop) {
      const halt = stop
      stop = null
      halt()
    }
    emit()
  }

  async function handleFix(fix) {
    const id = driverId
    const gen = generation
    if (!id) return
    for (const listener of fixListeners) listener(fix)
    const online = intent === 'online'
    if (!online && !trip) return
    const isCurrent = () => gen === generation && id === driverId && (intent === 'online' || Boolean(trip))
    await write(id, {
      ...fix,
      // Omitted (not false) when offline: location-only writes never touch presence.
      online: online ? true : undefined,
      onlineSource: online ? HEARTBEAT_SOURCE : undefined,
      tripId: trip?.id ?? null,
      tripStatus: trip?.status ?? null,
    }, { isCurrent, onlineIsCurrent: () => gen === generation && intent === 'online' })
  }

  return {
    setDriver(id) {
      const next = id || null
      if (next !== driverId) {
        driverId = next
        intent = null
        trip = null
        generation += 1
      }
      sync()
    },
    /** Server says offline: always stop. Server says online: only adopted before any local GO/END. */
    adoptServerOnline(online) {
      if (!online) {
        if (intent !== 'offline') { intent = 'offline'; generation += 1 }
      } else if (intent == null) {
        intent = 'online'
      }
      sync()
    },
    goOnline() {
      intent = 'online'
      generation += 1
      sync()
    },
    goOffline() {
      intent = 'offline'
      generation += 1
      sync()
    },
    setTrip(next) {
      const value = next?.id ? { id: next.id, status: next.status || null } : null
      if (value?.id === trip?.id && value?.status === trip?.status) return
      trip = value
      sync()
    },
    onFix(listener) { fixListeners.add(listener); return () => fixListeners.delete(listener) },
    subscribe(listener) { stateListeners.add(listener); listener(snapshot()); return () => stateListeners.delete(listener) },
    restart() {
      if (stop) { const halt = stop; stop = null; halt() }
      sync()
    },
    snapshot,
  }
}
