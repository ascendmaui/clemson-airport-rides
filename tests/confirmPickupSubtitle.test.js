import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = ['apps/rider/app/confirm.tsx', 'src/screens/ConfirmPickup.jsx']

test('Confirm pickup spot subtitle is a clear instruction', () => {
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    assert.ok(!src.includes('The location icon on pickup'), `${f} still has garbled subtitle`)
    if (f.endsWith('confirm.tsx')) {
      assert.match(src, /Pickup uses your current location/, `${f} missing instruction`)
    } else {
      assert.match(src, /Drag the (map|pin) to/, `${f} missing instruction`)
    }
  }
})
