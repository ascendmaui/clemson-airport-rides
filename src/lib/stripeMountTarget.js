/**
 * Stripe Payment Element / Card Element mount() throws
 * "missing argument, make sure to call mount with valid DOM element or selector"
 * when the argument is null, undefined, or a node that is not in the document.
 * Call this immediately before mount(); only mount the returned node.
 */
export function stripeMountNode(node) {
  if (node == null || node === '') return null
  if (typeof node === 'string') {
    if (typeof document === 'undefined') return null
    const found = document.querySelector(node)
    if (!found || found.nodeType !== 1 || found.isConnected !== true) return null
    return found
  }
  if (typeof node !== 'object' || node.nodeType !== 1 || node.isConnected !== true) return null
  return node
}

function nextFrame(cb) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(cb)
    return
  }
  setTimeout(cb, 16)
}

/**
 * Resolve after at least one frame, and only when getNode() is an attached element.
 * Returns null if cancelled or the container never attaches.
 */
export function waitForStripeMountNode(getNode, isCancelled, { timeoutMs = 2000, requestFrame = nextFrame } = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (isCancelled()) {
        resolve(null)
        return
      }
      const raw = typeof getNode === 'function' ? getNode() : getNode
      const node = stripeMountNode(raw)
      if (node) {
        resolve(node)
        return
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(null)
        return
      }
      requestFrame(tick)
    }
    requestFrame(tick)
  })
}
