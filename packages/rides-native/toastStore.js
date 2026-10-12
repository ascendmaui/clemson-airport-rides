/**
 * App-wide toast queue shared by the Rider and Driver apps.
 * One toast shows at a time. A toast with the same `key` as the one on screen
 * (or one already waiting) is merged instead of stacked, so a burst of
 * identical events cannot spam the driver or rider.
 */

export const TOAST_TONES = ['info', 'success', 'warning', 'error']
export const DEFAULT_TOAST_MS = 3200
const MAX_QUEUE = 3

let current = null
let queue = []
let seq = 0
const listeners = new Set()

function emit() {
  for (const listener of listeners) listener(current)
}

function normalize(input) {
  const tone = TOAST_TONES.includes(input?.tone) ? input.tone : 'info'
  const title = String(input?.title || '').trim()
  const durationMs = Number.isFinite(input?.durationMs) && input.durationMs > 0 ? input.durationMs : DEFAULT_TOAST_MS
  seq += 1
  return {
    id: `toast-${seq}`,
    key: input?.key ? String(input.key) : `${tone}:${title}:${input?.body || ''}`,
    tone,
    title,
    body: input?.body ? String(input.body) : null,
    icon: input?.icon ? String(input.icon) : null,
    durationMs,
    onPress: typeof input?.onPress === 'function' ? input.onPress : null,
  }
}

/** Show a toast. Returns its id, or the id of the toast it merged into. */
export function showToast(input) {
  const next = normalize(input)
  if (!next.title) return null
  if (current && current.key === next.key) {
    current = { ...next, id: current.id }
    emit()
    return current.id
  }
  const waiting = queue.findIndex((t) => t.key === next.key)
  if (waiting >= 0) {
    queue[waiting] = { ...next, id: queue[waiting].id }
    return queue[waiting].id
  }
  if (!current) {
    current = next
    emit()
    return next.id
  }
  queue.push(next)
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)
  return next.id
}

/** Remove the toast on screen (or a specific id) and promote the next one. */
export function dismissToast(id) {
  if (id && current?.id !== id) {
    queue = queue.filter((t) => t.id !== id)
    return
  }
  current = queue.shift() || null
  emit()
}

export function currentToast() {
  return current
}

export function subscribeToasts(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test helper. */
export function resetToasts() {
  current = null
  queue = []
  emit()
}
