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
  assert.match(checkout, /Book ride/)
  assert.doesNotMatch(checkout, /25% deposit/)
  assert.doesNotMatch(checkout, /Pay the 25% deposit/)
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

test('web billing shows credits first and confirms before a prepaid charge', () => {
  const account = read('src/screens/AccountScreenImpl.jsx')
  const credits = read('src/components/CreditsBalance.jsx')
  const prepaid = read('src/components/PrepaidCreditsPanel.jsx')
  const picker = read('src/components/BillingPanel.jsx')
  assert.match(account, /<CreditsBalance/)
  assert.ok(account.indexOf('<CreditsBalance') < account.indexOf('<BillingPanel'))
  assert.match(credits, /data-testid="credits-label"[\s\S]*\n\s*credits\n/)
  assert.doesNotMatch(credits, /account balance|account credits/i)
  assert.match(prepaid, /onClick=\{\(\) => setPending\(tier\)\}/)
  assert.match(prepaid, /onConfirmPurchase/)
  assert.doesNotMatch(prepaid, /onClick=\{\(\) => onBuy/)
  assert.match(picker, /RIDE_PAYMENT_METHODS\.map/)
  assert.match(picker, /pay-method-\$\{method\.id\}/)
  assert.match(picker, /data-testid="add-another-payment-method"/)
  assert.match(picker, /ADD_ANOTHER_PAYMENT_METHOD_LABEL/)
})

test('iOS and Android billing share the credits label, picker, and confirm step', () => {
  const billing = read('apps/rider/app/billing.tsx')
  assert.match(billing, />credits</)
  assert.doesNotMatch(billing, /account balance|account credits/i)
  assert.ok(billing.indexOf('>credits<') < billing.indexOf('PAYMENT METHODS'))
  assert.match(billing, /onPress=\{\(\) => setPending\(tier\)\}/)
  assert.match(billing, /onConfirmPurchase/)
  assert.match(billing, /ADD_ANOTHER_PAYMENT_METHOD_LABEL/)
  assert.match(billing, /RIDE_PAYMENT_METHODS/)
  assert.match(billing, /presentNativeSetupSheet/)
  assert.match(billing, /native: true/)
  assert.match(billing, /saveSetupPaymentMethod/)
  assert.match(billing, /listSavedPaymentMethods/)
  assert.match(billing, /Use this method/)
  assert.doesNotMatch(billing, /onPress=\{\(\) => buyPrepaidCredits/)
  assert.doesNotMatch(billing, /25% deposit/)
  assert.doesNotMatch(billing, /Stripe Checkout/)
})
