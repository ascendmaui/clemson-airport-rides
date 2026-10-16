import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { RIDER_SOCIAL_PROVIDERS } from '../packages/rides-native/socialAuth.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

test('rider store name and version are Clemson Rides 1.2.0', () => {
  const expo = JSON.parse(read('apps/rider/app.json')).expo
  assert.equal(expo.name, 'Clemson Rides')
  assert.equal(expo.version, '1.2.0')
  assert.equal(JSON.parse(read('apps/rider/package.json')).version, '1.2.0')
  assert.doesNotMatch(expo.name, /Crimson|RIDES/)
  const home = read('apps/rider/app/(tabs)/index.tsx')
  assert.match(home, /Clemson <Text style=\{styles\.brandSoft\}>Rides<\/Text>/)
  assert.doesNotMatch(home, /brandSoft\}>RIDES</)
  assert.doesNotMatch(home, /Busy Areas/)
  assert.match(home, /Game day…/)
  assert.match(home, /Surge · On/)
})

test('rider android manifest has a versionCode and no background location', () => {
  const expo = JSON.parse(read('apps/rider/app.json')).expo
  assert.equal(expo.android.package, 'com.ascendmaui.clemsonrides.rider')
  assert.equal(expo.android.versionCode, 19)
  assert.equal(expo.ios.buildNumber, '19')
  assert.equal(expo.android.permissions.includes('ACCESS_BACKGROUND_LOCATION'), false)
  assert.deepEqual(expo.android.permissions, [
    'ACCESS_COARSE_LOCATION',
    'ACCESS_FINE_LOCATION',
    'CAMERA',
    'RECORD_AUDIO',
  ])
  const plugins = expo.plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin))
  // React Native 0.86.3 pins compileSdk and targetSdk to 36. Do not add a plugin that lowers them.
  assert.equal(plugins.includes('expo-build-properties'), false)
  assert.equal(JSON.parse(read('apps/rider/package.json')).dependencies['react-native'], '0.86.3')
})

test('rider purpose strings cover location, camera, and photos', () => {
  const expo = JSON.parse(read('apps/rider/app.json')).expo
  const location = expo.ios.infoPlist.NSLocationWhenInUseUsageDescription
  const camera = expo.ios.infoPlist.NSCameraUsageDescription
  const picker = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-image-picker')
  assert.match(location, /Clemson Rides uses your location/)
  assert.match(location, /set your pickup point and show your driver approaching/)
  assert.match(camera, /Clemson Rides uses the camera/)
  assert.match(camera, /active ride/)
  assert.equal(picker[1].photosPermission.includes('photo library'), true)
  assert.match(picker[1].cameraPermission, /active ride/)
  assert.doesNotMatch(`${location} ${camera} ${picker[1].photosPermission}`, /Crimson|Clemson RIDES/)
})

test('rider offers Sign in with Apple beside Google', () => {
  const expo = JSON.parse(read('apps/rider/app.json')).expo
  assert.equal(expo.ios.usesAppleSignIn, true)
  assert.ok(expo.plugins.includes('expo-apple-authentication'))
  assert.deepEqual(RIDER_SOCIAL_PROVIDERS.map((provider) => provider.id), ['apple', 'google'])
  const signIn = read('apps/rider/lib/socialSignIn.ts')
  assert.match(signIn, /provider:\s*'apple'/)
  assert.match(signIn, /signInWithIdToken/)
  assert.match(signIn, /AppleAuthentication\.signInAsync/)
  for (const file of ['apps/rider/app/sign-in.tsx', 'apps/rider/app/sign-up.tsx']) {
    const source = read(file)
    assert.match(source, /RIDER_SOCIAL_PROVIDERS/, file)
    assert.doesNotMatch(source, /id:\s*'apple'[\s\S]{0,120}hidden:\s*true/, file)
  }
})

test('rider Account confirms immediate deletion for a signed-in user', () => {
  const account = read('apps/rider/app/(tabs)/account.tsx')
  assert.match(account, /router\.push\('\/delete-account'\)/)
  assert.match(account, />Delete account<\/Text>/)
  assert.match(account, /Deletes this account immediately/)
  const deleteAt = account.indexOf('>Delete account</Text>')
  const gated = account.slice(account.lastIndexOf('{user ? (', deleteAt), deleteAt)
  assert.match(gated, /router\.push\('\/delete-account'\)/)
  assert.doesNotMatch(account, /AdminAccountRow/)
  const route = read('apps/rider/app/delete-account.tsx')
  assert.match(route, /Alert\.alert\(/)
  assert.match(route, /style:\s*'destructive'/)
  assert.match(route, /confirmText\.trim\(\) === 'DELETE'/)
  assert.match(route, /authedJson\(supabase, '\/api\/account\?action=delete'/)
  assert.match(route, /confirm:\s*'DELETE'/)
  assert.match(route, /Deletion is immediate/)
  assert.match(route, /router\.replace\('\/sign-in'\)/)
  assert.match(route, /signOut\(\)/)
  assert.doesNotMatch(route, /buildAccountDeletionTicket|admin-drivers\?action=ticket/)
})
