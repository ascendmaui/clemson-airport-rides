import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

test('the website confirm and checkout steps show how the ride is paid', () => {
  const confirm = read('src/screens/ConfirmPickup.jsx')
  const checkout = read('src/screens/ScheduleAirport.jsx')
  const planner = read('src/components/ScheduledRidePlanner.jsx')
  const picker = read('src/components/BillingPicker.jsx')
  const client = read('src/lib/rideBilling.js')
  const app = read('src/App.jsx')

  assert.match(confirm, /BillingPicker/)
  assert.match(confirm, /fetchBillingQuote/)
  assert.match(checkout, /BillingPicker/)
  assert.match(checkout, /recordBillingChoice/)
  assert.match(checkout, /createCheckoutSession/)
  assert.match(checkout, /window\.location\.href = session\.url/)
  assert.match(checkout, /25% deposit/)
  assert.match(checkout, /Request \$\{formatUsdFromCents\(deposit\)\} deposit/)
  assert.match(checkout, /Pay the 25% deposit now in Stripe Checkout/)
  assert.match(planner, /BillingPicker/)
  assert.match(picker, /No card/)
  assert.match(picker, /Ride credits/)
  assert.match(picker, /data-testid="billing-picker"/)
  assert.match(picker, /A card is not charged here/)
  assert.match(picker, /The balance is not spent/)
  assert.match(client, /mode: 'quote'/)
  assert.match(client, /mode: 'record'/)
  assert.match(app, /billing=\{params\.billing/)
  assert.doesNotMatch(checkout, /paymentIntents|stripe\.checkout/)
  const checkoutCall = checkout.slice(checkout.indexOf('createCheckoutSession({'), checkout.indexOf('if (session.url)'))
  assert.doesNotMatch(checkoutCall, /fareCents|depositCents|deposit_cents|amount|total|isStudent/)
  assert.match(client, /CLIENT_MONEY_KEYS/)
  assert.doesNotMatch(client, /paymentIntents|stripe\.checkout|Stripe\(/)
  assert.doesNotMatch(picker, /paymentIntents|stripe\.checkout|Stripe\(/)
})
