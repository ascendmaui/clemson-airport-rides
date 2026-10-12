import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { currentToast, dismissToast, resetToasts, showToast, subscribeToasts } from './toastStore.js'

test('shows one toast at a time and promotes the next on dismiss', () => {
  resetToasts()
  showToast({ title: 'A' })
  showToast({ title: 'B', tone: 'error' })
  assert.equal(currentToast().title, 'A')
  dismissToast()
  assert.equal(currentToast().title, 'B')
  assert.equal(currentToast().tone, 'error')
  dismissToast()
  assert.equal(currentToast(), null)
})

test('same key merges instead of stacking, so bursts cannot spam', () => {
  resetToasts()
  const seen = []
  const off = subscribeToasts((t) => seen.push(t?.title))
  const a = showToast({ title: 'Back online', key: 'q' })
  const b = showToast({ title: 'Back online · 2 taps sent', key: 'q' })
  assert.equal(a, b)
  assert.equal(currentToast().title, 'Back online · 2 taps sent')
  dismissToast()
  assert.equal(currentToast(), null)
  off()
  assert.ok(seen.length >= 2)
})

test('empty titles are ignored and the queue is capped', () => {
  resetToasts()
  assert.equal(showToast({ title: '  ' }), null)
  for (let i = 0; i < 10; i++) showToast({ title: `t${i}` })
  let n = 0
  while (currentToast()) { n += 1; dismissToast() }
  assert.equal(n, 4)
})

test('host is glass, springs in, auto-dismisses, swipes up to dismiss, and is mounted in both apps', () => {
  const host = readFileSync(new URL('./ToastHost.jsx', import.meta.url), 'utf8')
  assert.match(host, /BlurView/)
  assert.match(host, /Animated\.spring\(y/)
  assert.match(host, /setTimeout\(\(\) => hide\(toast\.id\), toast\.durationMs\)/)
  assert.match(host, /g\.dy < -24 \|\| g\.vy < -0\.6/)
  assert.match(host, /accessibilityRole="alert"/)
  for (const app of ['rider', 'driver']) {
    const layout = readFileSync(new URL(`../../apps/${app}/app/_layout.tsx`, import.meta.url), 'utf8')
    assert.match(layout, /<ToastMount \/>/)
  }
})
