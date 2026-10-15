import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = new URL('..', import.meta.url).pathname
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const rel = join(dir, name)
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out)
    else if (/\.(tsx?|jsx?|mjs)$/.test(name)) out.push(rel)
  }
  return out
}

test('the promo admin never ships in the rider app', () => {
  for (const file of walk('apps/rider')) {
    const src = read(file)
    assert.doesNotMatch(src, /PromoAdminPanel/, file)
    assert.doesNotMatch(src, /promo-(create|update|export|codes)\b/, file)
    assert.doesNotMatch(src, /(createPromoCodes|updatePromoCode|exportPromoCodes|loadPromoAdmin|promoAdminClient)/, file)
  }
  const shared = read('packages/rides-native/promoCodesClient.js')
  assert.doesNotMatch(shared, /promo-(create|update|export|codes)\b/, 'rider-facing client has no admin calls')
})

test('the driver admin screen mounts the promo admin panel', () => {
  const admin = read('apps/driver/app/admin.tsx')
  assert.match(admin, /import \{ PromoAdminPanel \} from 'rides-native\/PromoAdminPanel\.jsx'/)
  assert.match(admin, /<PromoAdminPanel supabase=\{supabase\}/)
  const panel = read('packages/rides-native/PromoAdminPanel.jsx')
  assert.match(panel, /err\?\.status === 403 \|\| err\?\.status === 401\) setHidden\(true\)/)
  assert.match(panel, /if \(hidden \|\| !data\?\.admin\) return null/)
})

test('driver sign-up has a promo box that claims driver codes only', () => {
  const signUp = read('apps/driver/app/sign-up.tsx')
  assert.doesNotMatch(signUp, /showPromo=\{false\}/)
  assert.match(signUp, /promoPlaceholder="Driver promo code"/)
  assert.match(read('apps/driver/lib/auth.tsx'), /promoSide: 'driver'/)
  const auth = read('packages/rides-native/createAuth.jsx')
  assert.match(auth, /if \(side === 'driver'\)/, 'a driver code never falls back to the rider friend program')
})

test('rider booking sends the code and a device id to the server', () => {
  const pick = read('apps/rider/app/pick-driver.tsx')
  assert.match(pick, /<PromoCodeField code=\{promoCode\} onChange=\{setPromoCode\} \/>/)
  assert.match(pick, /\.\.\.\(promoCode \? \{ promoCode \} : \{\}\)/)
  assert.match(pick, /deviceId: await promoDeviceId\(authStorage\)/)
  const drivers = read('packages/rides-native/drivers.js')
  assert.match(drivers, /promoCode \? \{ promoCode: String\(promoCode\) \}/)
})

// Retired fleet words are covered repo-wide by tests/retiredCopy.test.js.
test('promo copy does not bring back the retired deposit', () => {
  const files = [
    'apps/rider/components/PromoCodeField.tsx',
    'packages/rides-native/PromoAdminPanel.jsx',
    'packages/rides-native/promoCodesClient.js',
    'shared/promoCodes.js',
    'server/promoCodes.js',
    'server/endpoints/promoCodes.js',
    'server/endpoints/promoAdmin.js',
  ]
  for (const file of files) {
    const src = read(file)
    assert.doesNotMatch(src, /25% deposit|deposit of 25/i, file)
  }
})
