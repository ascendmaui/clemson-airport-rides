import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RIDER_CUE_VIBRATION, riderStatusCue } from '../src/lib/riderStatusCue.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('rider arrived/complete cue vibrates when allowed and stays silent otherwise', async () => {
  const calls = []
  const prev = globalThis.navigator
  Object.defineProperty(globalThis, 'navigator', { value: { vibrate: (p) => calls.push(p) }, configurable: true })
  try {
    assert.equal(await riderStatusCue('arrived', {}), true)
    assert.deepEqual(calls.at(-1), RIDER_CUE_VIBRATION.arrived)
    assert.equal(await riderStatusCue('completed', null), true)
    assert.equal(await riderStatusCue('arrived', { ride: false }), false)
    assert.equal(await riderStatusCue('arrived', { quiet: { dnd: true } }), false)
    assert.equal(await riderStatusCue('accepted', {}), false)
    assert.equal(calls.length, 2)
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: prev, configurable: true })
  }
})

test('RideToastWatcher plays the rider cue only for the rider, on arrived/completed', () => {
  const src = read('src/components/RideToastWatcher.jsx')
  assert.match(src, /if \(row\.rider_id === user\.id && \(row\.status === 'arrived' \|\| row\.status === 'completed'\)\) \{\s*riderStatusCue\(row\.status, prefsRef\.current\)/)
})

test('chat report/block use the styled dialog, not window.confirm', () => {
  const chat = read('src/components/RideChat.jsx')
  assert.doesNotMatch(chat, /window\.confirm/)
  assert.match(chat, /await confirm\(\{ title: 'Report trip chat\?'/)
  assert.match(chat, /title: 'Block this person\?'/)
  assert.match(chat, /\{confirmDialog\}/)
  const dialog = read('src/components/ConfirmDialog.jsx')
  assert.match(dialog, /role="alertdialog"/)
  assert.match(dialog, /useModalA11y\(\{ isOpen: open, onClose: onCancel/)
  assert.match(dialog, /backdropFilter/)
  assert.match(dialog, /prefers-reduced-motion/)
})
