import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// tests/homeShell.test.js is not in the npm test list; run it through this file
// (the tests/no*.test.js glob) so CI pins the shell copy and wiring too.
import './homeShell.test.js'

const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')

test('home shell requests the bundle only after a hero photo is presented', () => {
  assert.match(vite, /\.observe\(\{ type: 'largest-contentful-paint', buffered: true \}\)/)
  assert.match(vite, /list\.getEntries\(\)\.some\(\(e\) => e\.url\)/)
  assert.match(vite, /photo\.addEventListener\('error', later\)/)
})

test('home shell keeps a decode + frame fallback and a 2.5 s cap', () => {
  assert.match(vite, /photo\.decode\(\)\.catch\(\(\) => \{\}\)/)
  assert.match(vite, /requestAnimationFrame\(later\)/)
  assert.match(vite, /setTimeout\(go, 2500\)/)
  // Every other route loads the bundle at once.
  assert.match(vite, /\} else go\(\)/)
})
