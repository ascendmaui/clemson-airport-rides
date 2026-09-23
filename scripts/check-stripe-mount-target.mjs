import assert from 'node:assert/strict'
import { stripeMountNode } from '../src/lib/stripeMountTarget.js'

assert.equal(stripeMountNode(null), null)
assert.equal(stripeMountNode(undefined), null)
assert.equal(stripeMountNode(''), null)
assert.equal(stripeMountNode('#card'), null)
assert.equal(stripeMountNode({ nodeType: 1, isConnected: false }), null)
assert.equal(stripeMountNode({ nodeType: 3, isConnected: true }), null)

const attached = { nodeType: 1, isConnected: true }
assert.equal(stripeMountNode(attached), attached)

const panel = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../src/components/BillingPanel.jsx', import.meta.url), 'utf8'),
)
const mountCalls = panel.match(/\.mount\(/g) || []
assert.equal(mountCalls.length, 1, 'Payment Element mount must happen in one place')
assert.match(panel, /stripeMountNode\(mountNode\)/)
assert.doesNotMatch(panel, /paymentElement\.mount\(mountRef/)
assert.match(panel, /pe\.unmount\(\)/)

console.log('stripe mount target checks passed')
