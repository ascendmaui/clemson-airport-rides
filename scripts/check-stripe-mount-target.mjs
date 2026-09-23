import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripeMountNode, waitForStripeMountNode } from '../src/lib/stripeMountTarget.js'

assert.equal(stripeMountNode(null), null)
assert.equal(stripeMountNode(undefined), null)
assert.equal(stripeMountNode(''), null)
assert.equal(stripeMountNode('#card'), null)
assert.equal(stripeMountNode({ nodeType: 1, isConnected: false }), null)
assert.equal(stripeMountNode({ nodeType: 3, isConnected: true }), null)

const attached = { nodeType: 1, isConnected: true }
assert.equal(stripeMountNode(attached), attached)

const immediate = (cb) => cb()
const appeared = { nodeType: 1, isConnected: false }
let frames = 0
const found = await waitForStripeMountNode(
  () => {
    frames += 1
    if (frames > 1) appeared.isConnected = true
    return appeared
  },
  () => false,
  { timeoutMs: 1000, requestFrame: immediate },
)
assert.equal(found, appeared)

const cancelled = await waitForStripeMountNode(() => null, () => true, { requestFrame: immediate })
assert.equal(cancelled, null)

const timedOut = await waitForStripeMountNode(
  () => ({ nodeType: 1, isConnected: false }),
  () => false,
  { timeoutMs: 0, requestFrame: immediate },
)
assert.equal(timedOut, null)

const panel = fs.readFileSync(new URL('../src/components/BillingPanel.jsx', import.meta.url), 'utf8')
const mountCalls = panel.match(/\.mount\(/g) || []
assert.equal(mountCalls.length, 1, 'Payment Element mount must happen in one place')
assert.match(panel, /const mountRef = useRef\(null\)/)
assert.match(panel, /ref=\{mountRef\}/)
assert.match(panel, /setShowForm\(true\)/)
assert.match(panel, /waitForStripeMountNode\(\s*\(\) => mountRef\.current/)
assert.doesNotMatch(panel, /innerHTML/)
const mountAt = panel.indexOf('paymentElement.mount')
const waitAt = panel.lastIndexOf('waitForStripeMountNode', mountAt)
assert.ok(waitAt !== -1 && waitAt < mountAt, 'mount runs only after the container ref is attached')
assert.match(panel, /pe\.unmount\(\)/)

console.log('stripe mount target checks passed')
