import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DRIVER_SOCIAL_PROVIDERS } from '../packages/rides-native/socialAuth.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

test('driver store name and version are Clemson Rides Driver 1.2.0', () => {
  const expo = JSON.parse(read('apps/driver/app.json')).expo
  assert.equal(expo.name, 'Clemson Rides Driver')
  assert.equal(expo.version, '1.2.0')
  assert.equal(expo.ios.buildNumber, '19')
  assert.equal(JSON.parse(read('apps/driver/package.json')).version, '1.2.0')
  assert.equal(read('apps/driver/components/BootScreen.tsx').includes('Clemson Rides Driver'), true)
  assert.doesNotMatch(expo.name, /Crimson|RIDES/)
})

test('driver purpose strings justify background location, camera, and photos', () => {
  const expo = JSON.parse(read('apps/driver/app.json')).expo
  const always = expo.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription
  const camera = expo.ios.infoPlist.NSCameraUsageDescription
  const photos = expo.ios.infoPlist.NSPhotoLibraryUsageDescription
  assert.match(always, /active trip/)
  assert.match(always, /phone is locked/)
  assert.match(always, /Location sharing stops when the trip ends/)
  assert.match(camera, /driver documents/)
  assert.match(photos, /license, insurance, and vehicle documents/)
  assert.doesNotMatch(`${always} ${camera} ${photos}`, /Crimson|Clemson RIDES/)
  assert.ok(expo.ios.infoPlist.UIBackgroundModes.includes('location'))
})

test('driver offers Sign in with Apple beside Google', () => {
  const expo = JSON.parse(read('apps/driver/app.json')).expo
  assert.equal(expo.ios.usesAppleSignIn, true)
  assert.ok(expo.plugins.includes('expo-apple-authentication'))
  assert.deepEqual(DRIVER_SOCIAL_PROVIDERS.map((provider) => provider.id), ['apple', 'google'])
  const signIn = read('apps/driver/lib/socialSignIn.ts')
  assert.match(signIn, /provider:\s*'apple'/)
  assert.match(signIn, /signInWithIdToken/)
  assert.match(signIn, /AppleAuthentication\.signInAsync/)
  for (const file of ['apps/driver/app/sign-in.tsx', 'apps/driver/app/sign-up.tsx']) {
    const source = read(file)
    assert.match(source, /DRIVER_SOCIAL_PROVIDERS/, file)
    assert.doesNotMatch(source, /id:\s*'apple'[\s\S]{0,120}hidden:\s*true/, file)
  }
})

test('driver Account confirms deletion and shows Admin only for the server admin', () => {
  const menu = read('apps/driver/app/(tabs)/menu.tsx')
  assert.match(menu, /AdminAccountRow/)
  assert.match(menu, /router\.push\('\/delete-account'\)/)
  assert.match(read('packages/rides-native/AdminAccountRow.jsx'), /access\?\.isAdmin !== true\) return null/)
  assert.doesNotMatch(read('apps/rider/app/(tabs)/account.tsx'), /AdminAccountRow/)
  const route = read('apps/driver/app/delete-account.tsx')
  assert.match(route, /Alert\.alert\(/)
  assert.match(route, /style:\s*'destructive'/)
  assert.match(route, /buildAccountDeletionTicket\(\{\s*email:\s*user\.email,\s*roleVariant:\s*'driver'/)
  assert.match(route, /\/api\/support-ticket/)
})

test('background location is a driver manifest permission, with no build-properties downgrade', () => {
  const driver = JSON.parse(read('apps/driver/app.json')).expo
  const rider = JSON.parse(read('apps/rider/app.json')).expo
  assert.equal(driver.android.package, 'com.ascendmaui.clemsonrides.driver')
  assert.equal(rider.android.package, 'com.ascendmaui.clemsonrides.rider')
  assert.equal(driver.android.versionCode, 19)
  assert.ok(driver.android.permissions.includes('ACCESS_BACKGROUND_LOCATION'))
  assert.equal(rider.android.permissions.includes('ACCESS_BACKGROUND_LOCATION'), false)
  for (const app of ['apps/driver', 'apps/rider']) {
    const pkg = JSON.parse(read(`${app}/package.json`))
    const expo = JSON.parse(read(`${app}/app.json`)).expo
    const plugins = expo.plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin))
    // React Native 0.86.3 pins compileSdk and targetSdk to 36 in gradle/libs.versions.toml.
    assert.equal(pkg.dependencies['react-native'], '0.86.3', app)
    assert.equal(plugins.includes('expo-build-properties'), false, app)
  }
})
