import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path) {
  return readFileSync(path, 'utf8')
}

test('web billing shows credits first and confirms before a prepaid charge', () => {
  const account = source('src/screens/AccountScreenImpl.jsx')
  const credits = source('src/components/CreditsBalance.jsx')
  const prepaid = source('src/components/PrepaidCreditsPanel.jsx')
  const picker = source('src/components/BillingPanel.jsx')
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
  const billing = source('apps/rider/app/billing.tsx')
  assert.match(billing, />credits</)
  assert.doesNotMatch(billing, /account balance|account credits/i)
  assert.ok(billing.indexOf('>credits<') < billing.indexOf('PAYMENT METHODS'))
  assert.match(billing, /onPress=\{\(\) => setPending\(tier\)\}/)
  assert.match(billing, /onConfirmPurchase/)
  assert.match(billing, /ADD_ANOTHER_PAYMENT_METHOD_LABEL/)
  assert.match(billing, /RIDE_PAYMENT_METHODS/)
  assert.doesNotMatch(billing, /onPress=\{\(\) => buyPrepaidCredits/)
})
