import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { agreeButtonDisabled, mayCreateDriverAccount } from '../shared/driverClickwrap.js'

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('the I Agree button is gated by an unchecked checkbox', () => {
  const source = read('packages/rides-native/DriverClickwrap.jsx')
  assert.match(source, /useState\(false\)/)
  assert.match(source, /accessibilityRole="checkbox"/)
  assert.match(source, /const disabled = agreeButtonDisabled\(checked\) \|\| busy/)
  assert.match(source, /if \(agreeButtonDisabled\(checked\) \|\| busy\) return/)
  assert.match(source, /disabled=\{disabled\}/)
  assert.match(source, /accessibilityLabel="I Agree"/)
  assert.match(source, /Driver Agreement/)
  assert.match(source, /setDoc\('terms'\)/)
  assert.match(source, /setDoc\('privacy'\)/)
  assert.equal(agreeButtonDisabled(false), true)
  assert.equal(agreeButtonDisabled(true), false)
})

test('driver signup cannot create an account until I Agree', () => {
  const source = read('apps/driver/app/sign-up.tsx')
  assert.match(source, /useState\(false\)/)
  assert.match(source, /if \(!mayCreateDriverAccount\(agreed\)\)/)
  assert.match(source, /<DriverClickwrap/)
  assert.match(source, /Agree to the Driver Agreement before creating an account/)
  const clickwrapAt = source.indexOf('<DriverClickwrap')
  const formAt = source.indexOf('<SignUpScreen')
  assert.ok(clickwrapAt > 0 && formAt > clickwrapAt)
  assert.equal(mayCreateDriverAccount(false), false)
})

test('onboarding and the next launch both stop until this version is accepted', () => {
  const onboarding = read('apps/driver/app/onboarding.tsx')
  const layout = read('apps/driver/app/_layout.tsx')
  const prompt = read('apps/driver/components/DriverAgreementPrompt.tsx')
  assert.match(onboarding, /<DriverAgreementPrompt/)
  assert.match(layout, /<DriverAgreementPrompt>/)
  assert.match(prompt, /resolveDriverClickwrap/)
  assert.match(prompt, /submitDriverClickwrap/)
  assert.match(prompt, /if \(phase === 'required'\)/)
  assert.match(prompt, /<DriverClickwrap/)
  assert.match(prompt, /saved\.acceptance\?\.agreementVersion !== DRIVER_CLICKWRAP_VERSION/)
})
