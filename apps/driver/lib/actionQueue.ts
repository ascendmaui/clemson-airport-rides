import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { createActionQueue, type ActionQueue, type ActionQueueEvent, type ActionQueueState } from 'rides-native/actionQueue'
import { sendQueuedDriverAction } from 'rides-native/driverDesk'
import { authStorage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'

/**
 * One app-wide offline queue for driver trip taps. Taps made without signal
 * are saved in order and retried with backoff and whenever the app returns to
 * the foreground; each carries a stable idempotency key.
 */
let queue: ActionQueue | null = null
let latest: ActionQueueState = { actions: [], offline: false, pending: 0, lastError: null }
const stateListeners = new Set<(state: ActionQueueState) => void>()
const eventListeners = new Set<(event: ActionQueueEvent) => void>()

export function driverActionQueue(): ActionQueue | null {
  if (!supabase) return null
  if (!queue) {
    const client = supabase
    queue = createActionQueue({
      storage: authStorage,
      send: (action) => sendQueuedDriverAction(client, action),
      onChange: (state) => {
        latest = state
        for (const listener of stateListeners) listener(state)
      },
      onEvent: (event) => {
        for (const listener of eventListeners) listener(event)
      },
    })
    void queue.load().then(() => queue?.flush())
    AppState.addEventListener('change', (next) => {
      if (next === 'active') void queue?.flush()
    })
  }
  return queue
}

/** Queue state plus a listener for sent / failed taps (to refresh the trip). */
export function useDriverActionQueue(onEvent?: (event: ActionQueueEvent) => void) {
  const [state, setState] = useState<ActionQueueState>(latest)
  useEffect(() => {
    driverActionQueue()
    setState(latest)
    stateListeners.add(setState)
    return () => { stateListeners.delete(setState) }
  }, [])
  useEffect(() => {
    if (!onEvent) return undefined
    eventListeners.add(onEvent)
    return () => { eventListeners.delete(onEvent) }
  }, [onEvent])
  return state
}
