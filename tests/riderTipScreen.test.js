import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { shouldPromptRiderTip } from '../src/lib/riderTip.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

test('the rider is prompted only after their own completed trip has no tip choice', () => {
  const trip = { status: 'completed', rider_id: 'rider-1', metadata: {} }
  assert.equal(shouldPromptRiderTip(trip, 'rider-1'), true)
  assert.equal(shouldPromptRiderTip({ ...trip, status: 'in_progress' }, 'rider-1'), false)
  assert.equal(shouldPromptRiderTip(trip, 'driver-1'), false)
  assert.equal(shouldPromptRiderTip({
    ...trip,
    metadata: { rider_tip_choice: { id: 'skip', skipped: true } },
  }, 'rider-1'), false)
  assert.equal(shouldPromptRiderTip(null, 'rider-1'), false)
})

test('the website tip step asks the server and does not charge from the browser', () => {
  const screen = read('src/screens/TipRide.jsx')
  const client = read('src/lib/riderTip.js')
  const app = read('src/App.jsx')
  const requested = read('src/screens/Requested.jsx')
  const driver = read('api/driver.js')

  assert.match(app, /case 'tip':/)
  assert.match(requested, /shouldPromptRiderTip/)
  assert.match(requested, /navigate\('tip'/)
  assert.match(driver, /'tip-choice': handleRiderTipChoice/)
  assert.match(client, /mode: 'offer', tripId/)
  assert.match(client, /mode: 'record', tripId, choiceId/)
  assert.match(client, /customDollars/)
  assert.match(screen, /No tip/)
  assert.match(screen, /Custom amount/)
  assert.match(screen, /data-testid="tip-custom-input"/)
  assert.match(screen, /selectedId === 'custom'/)
  assert.match(screen, /save\('custom', customText\)/)
  assert.match(screen, /A saved card is charged after you add the tip/)
  assert.match(screen, /No card on file means nothing is charged/)
  assert.match(screen, /No card was charged/)
  assert.doesNotMatch(screen, /Charging that tip is not available yet/)
  assert.match(screen, /data-testid="tip-screen"/)
  assert.match(screen, /tip-option-/)
  assert.doesNotMatch(screen, /collectTripPayment|stripe|paymentIntents|amountCents|isStudent/)
  assert.doesNotMatch(client, /tipCents|amountCents|collectTripPayment|isStudent|deposit|fareCents|\bamount\b|\btotal\b/)
})
