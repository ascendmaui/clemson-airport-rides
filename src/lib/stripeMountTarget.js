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
