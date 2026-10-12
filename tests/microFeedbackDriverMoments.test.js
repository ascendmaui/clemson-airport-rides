import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('DriverMoments primes first, then toasts tip, hold failed, chat, and back online', () => {
  const src = read('apps/driver/components/DriverMoments.tsx')
  assert.match(src, /if \(!primed \|\| !prev\) return/)
  assert.match(src, /driverTipMoment\(prev\.tip, row\)/)
  assert.match(src, /paymentFailedMoment\(prev\.hold, row, 'driver'\)/)
  assert.match(src, /if \(AppState\.currentState !== 'active'\) return\s*const moment = chatMessageMoment\(payload\.new, user\.id\)/)
  assert.match(src, /backOnlineMoment\(sentInBurst\.current\)/)
  assert.match(src, /case 'tip':\s*pulse\('accept'\)/)
  assert.match(src, /case 'error':\s*pulse\('decline'\)/)
  assert.match(read('apps/driver/app/_layout.tsx'), /<DriverMoments \/>/)
})

test('success notices use the shared toast instead of an OS alert', () => {
  assert.match(read('apps/driver/components/DriverCancelSheet.tsx'), /showToast\(\{ key: 'driver-canceled-self'/)
  const thread = read('packages/rides-native/TripThread.jsx')
  assert.match(thread, /showToast\(\{ key: `chat-\$\{action\}:\$\{tripId\}`/)
  // Confirmation dialogs stay as confirmations.
  assert.match(thread, /Alert\.alert\('Report trip chat\?'/)
})
