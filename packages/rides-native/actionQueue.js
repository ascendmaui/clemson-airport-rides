/**
 * Offline action queue for driver trip taps.
 *
 * Status and stop taps made without signal are saved in order (persisted, so
 * they survive an app restart) and retried with backoff. Every action has a
 * stable idempotency key that is sent with each attempt, so the server applies
 * a tap once even if an earlier attempt reached it before the signal dropped.
 * A tap that the server rejects drops the rest of that trip's queue (they
 * depended on it) and is reported so the driver can retry by hand.
 */

// SecureStore keys allow only letters, digits, '.', '-' and '_'.
export const QUEUE_STORAGE_KEY = 'driver-action-queue.v1'
export const QUEUEABLE_STATUS_OPS = Object.freeze(['arriving', 'arrive', 'start', 'complete'])
export const QUEUEABLE_STOP_OPS = Object.freeze(['arrive', 'start', 'drop'])
const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000]
/** Server errors (5xx, 429, a key still in flight) are retried this many times before the tap is given up. */
export const MAX_SERVER_RETRIES = 10

export function isOfflineError(err) {
  if (!err) return false
  if (err.network === true) return true
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true
  const status = Number(err.status)
  if (status === 502 || status === 503 || status === 504) return true
  return /network request failed|failed to fetch|network error|offline|timed out/i.test(String(err.message || ''))
}

/** Server-side transient failure: keep the tap and retry (bounded). */
export function isServerRetryError(err) {
  if (!err) return false
  const status = Number(err.status)
  if (status === 429 || (status >= 500 && status <= 599)) return true
  return err.code === 'idempotency_in_progress'
}

export function retryDelayMs(attempts) {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, Number(attempts || 1) - 1))
  return RETRY_DELAYS_MS[index]
}

export function newIdempotencyKey(now = Date.now(), random = Math.random) {
  const rand = Array.from({ length: 3 }, () => Math.floor(random() * 0x100000000).toString(36)).join('')
  return `drv-${Number(now).toString(36)}-${rand}`.slice(0, 64)
}

export function isQueueableAction(action) {
  if (!action || typeof action.tripId !== 'string' || !action.tripId) return false
  if (action.kind === 'status') return QUEUEABLE_STATUS_OPS.includes(action.op)
  if (action.kind === 'stop') return QUEUEABLE_STOP_OPS.includes(action.op) && Number.isInteger(action.stopIndex) && action.stopIndex >= 0
  return false
}

const STATUS_AFTER_OP = { arriving: 'arriving', arrive: 'arrived', start: 'in_progress', complete: 'completed' }
export const TERMINAL_TRIP_STATUSES = Object.freeze(['completed', 'canceled', 'canceled_midride', 'cancelled_wait'])

/** Trip status as the driver will see it once the queued taps land. */
export function projectTripStatus(status, actions = [], tripId = null) {
  // The server's terminal state always wins over saved taps.
  if (TERMINAL_TRIP_STATUSES.includes(status)) return status
  let current = status
  for (const action of actions) {
    if (tripId && action.tripId !== tripId) continue
    if (action.kind === 'status' && STATUS_AFTER_OP[action.op]) current = STATUS_AFTER_OP[action.op]
  }
  return current
}

export function waitingForSignalLabel(count) {
  const n = Number(count) || 0
  if (n <= 0) return null
  return `Waiting for signal · ${n} ${n === 1 ? 'tap' : 'taps'} saved`
}

function sanitize(list) {
  return Array.isArray(list) ? list.filter((a) => isQueueableAction(a) && typeof a.id === 'string' && a.id) : []
}

/**
 * @param {{ storage?: { getItem(k: string): Promise<string|null>, setItem(k: string, v: string): Promise<void> },
 *   send: (action: object) => Promise<any>, onChange?: (state: object) => void, onEvent?: (event: object) => void,
 *   now?: () => number, random?: () => number, setTimer?: Function, clearTimer?: Function, storageKey?: string }} options
 */
export function createActionQueue(options) {
  const {
    storage = null,
    send,
    onChange = () => {},
    onEvent = () => {},
    now = () => Date.now(),
    random = Math.random,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (t) => clearTimeout(t),
    storageKey = QUEUE_STORAGE_KEY,
  } = options || {}
  if (typeof send !== 'function') throw new Error('createActionQueue needs send')

  let actions = []
  let loaded = null
  let flushing = null
  let timer = null
  let offline = false
  let lastError = null
  const waiters = new Map()

  const state = () => ({ actions: actions.slice(), offline, pending: actions.length, lastError })
  const emit = () => { try { onChange(state()) } catch { /* listener errors never break the queue */ } }

  // Writes are serialized and each writes the queue as it is when it runs,
  // so an older snapshot can never land after a newer one.
  let writing = Promise.resolve()
  function persist() {
    if (!storage) return Promise.resolve()
    writing = writing.then(async () => {
      try {
        if (actions.length) await storage.setItem(storageKey, JSON.stringify(actions))
        else if (typeof storage.removeItem === 'function') await storage.removeItem(storageKey)
        else await storage.setItem(storageKey, '[]')
      } catch { /* keep the in-memory queue */ }
    })
    return writing
  }

  function load() {
    if (!loaded) {
      loaded = (async () => {
        if (!storage) return
        try {
          const raw = await storage.getItem(storageKey)
          const saved = sanitize(raw ? JSON.parse(raw) : [])
          const known = new Set(actions.map((a) => a.id))
          actions = [...saved.filter((a) => !known.has(a.id)), ...actions]
        } catch { /* corrupt storage starts empty */ }
        emit()
      })()
    }
    return loaded
  }

  function settle(id, outcome) {
    const waiter = waiters.get(id)
    if (!waiter) return
    waiters.delete(id)
    waiter(outcome)
  }

  function schedule(attempts) {
    if (timer) return
    timer = setTimer(() => { timer = null; void flush() }, retryDelayMs(attempts))
  }

  async function runFlush() {
    await load()
    while (actions.length) {
      const head = actions[0]
      try {
        const result = await send(head)
        actions = actions.slice(1)
        offline = false
        if (lastError?.action?.tripId === head.tripId) lastError = null
        // The event first, so the screen adopts the returned trip before the projection drops.
        try { onEvent({ type: 'sent', action: head, result }) } catch { /* listener errors never break the queue */ }
        emit()
        await persist()
        settle(head.id, { status: 'sent', result })
      } catch (err) {
        const serverRetry = isServerRetryError(err) && (head.attempts || 0) + 1 < MAX_SERVER_RETRIES
        if (isOfflineError(err) || serverRetry) {
          offline = isOfflineError(err)
          actions = actions.map((a) => (a.id === head.id ? { ...a, attempts: (a.attempts || 0) + 1 } : a))
          await persist()
          emit()
          for (const a of actions) settle(a.id, { status: 'queued' })
          schedule(actions[0]?.attempts || 1)
          return
        }
        // Rejected: later taps for this trip depended on this one.
        const dropped = actions.filter((a) => a.tripId === head.tripId)
        actions = actions.filter((a) => a.tripId !== head.tripId)
        offline = false
        lastError = { action: head, message: err?.message || 'Could not update this trip', code: err?.code || null }
        await persist()
        emit()
        try { onEvent({ type: 'failed', action: head, error: err, dropped }) } catch { /* ignore */ }
        settle(head.id, { status: 'failed', error: err })
        for (const a of dropped) if (a.id !== head.id) settle(a.id, { status: 'dropped', error: err })
      }
    }
  }

  function flush() {
    if (!flushing) {
      if (timer) { clearTimer(timer); timer = null }
      flushing = runFlush().finally(() => { flushing = null })
    }
    return flushing
  }

  /**
   * Queue a tap and try to send it now. Resolves with
   * { status: 'sent', result } | { status: 'queued' } | { status: 'failed', error } | { status: 'dropped', error }.
   */
  async function submit(input) {
    const action = {
      ...input,
      id: input?.id || newIdempotencyKey(now(), random),
      queuedAt: input?.queuedAt || new Date(now()).toISOString(),
      attempts: 0,
    }
    if (!isQueueableAction(action)) throw new Error('This action cannot be queued')
    await load()
    const outcome = new Promise((resolve) => waiters.set(action.id, resolve))
    actions = [...actions, action]
    await persist()
    emit()
    if (flushing) {
      // A running flush that is parked offline already returned; otherwise it will pick this up.
      await flushing
      if (actions.some((a) => a.id === action.id) && !flushing) void flush()
    } else {
      void flush()
    }
    return outcome
  }

  function forTrip(tripId) {
    return actions.filter((a) => a.tripId === tripId)
  }

  function clearError() {
    lastError = null
    emit()
  }

  function dispose() {
    if (timer) { clearTimer(timer); timer = null }
    for (const id of [...waiters.keys()]) settle(id, { status: 'queued' })
  }

  return { load, submit, flush, forTrip, state, clearError, dispose }
}
