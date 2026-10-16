import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { agreeButtonDisabled, mayCreateDriverAccount } from '../shared/driverClickwrap.js'
import {
  clickwrapPhaseAfterRace,
  raceWithTimeout,
  STARTUP_TIMEOUT_MS,
} from '../apps/driver/lib/startupGate.ts'

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
  assert.match(layout, /<ThemedStack \/>\s*<ActiveTripResume \/>\s*<PickupBeaconHost \/>\s*<\/DriverAgreementPrompt>/)
  assert.match(prompt, /resolveDriverClickwrap/)
  assert.match(prompt, /raceWithTimeout\(resolveDriverClickwrap\(supabase, authStorage\), STARTUP_TIMEOUT_MS\)/)
  assert.match(prompt, /clickwrapPhaseAfterRace\(result\)/)
  assert.match(prompt, /setPhase\('required'\)/)
  assert.match(prompt, /submitDriverClickwrap/)
  assert.match(prompt, /if \(phase === 'required'\)/)
  assert.match(prompt, /<DriverClickwrap/)
  assert.match(prompt, /saved\.acceptance\?\.agreementVersion !== DRIVER_CLICKWRAP_VERSION/)
})

test('a hung or failed clickwrap check shows the agreement instead of the spinner', async () => {
  assert.equal(STARTUP_TIMEOUT_MS, 8000)
  const hung = raceWithTimeout(new Promise(() => {}), 20)
  const rejected = raceWithTimeout(Promise.reject(new Error('storage')), 1000)
  const accepted = raceWithTimeout(Promise.resolve('ok'), 1000)
  const missing = raceWithTimeout(Promise.resolve('required'), 1000)
  assert.equal(clickwrapPhaseAfterRace(await hung), 'required')
  assert.equal((await hung).reason, 'timeout')
  assert.equal(clickwrapPhaseAfterRace(await rejected), 'required')
  assert.equal(clickwrapPhaseAfterRace(await accepted), 'ok')
  assert.equal(clickwrapPhaseAfterRace(await missing), 'required')
})

test('driver startup gates time out instead of holding the first screen', () => {
  const theme = read('apps/driver/lib/theme.tsx')
  const layout = read('apps/driver/app/_layout.tsx')
  const home = read('apps/driver/app/(tabs)/index.tsx')
  const auth = read('packages/rides-native/createAuth.jsx')
  assert.match(theme, /raceWithTimeout\(authStorage\.getItem\(PREFS_KEY\), STARTUP_TIMEOUT_MS\)/)
  assert.match(theme, /if \(!alive \|\| !result\.ok\) return/)
  assert.match(theme, /raceWithTimeout\(Location\.getLastKnownPositionAsync\(\), STARTUP_TIMEOUT_MS\)/)
  assert.match(layout, /if \(!loading\) hideDriverSplash\(\)/)
  assert.match(layout, /raceWithTimeout\(registerDriverPush\(supabase, user\.id\), STARTUP_TIMEOUT_MS\)/)
  assert.match(home, /DRIVER_STATUS_TIMEOUT_COPY/)
  assert.match(home, /STARTUP_TIMEOUT_MS/)
  assert.match(auth, /sessionTimeoutMs = 0/)
  assert.match(auth, /\.catch\(\(\) => \{\s*if \(!alive\) return/)
})
