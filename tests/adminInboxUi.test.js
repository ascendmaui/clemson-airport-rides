import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

test('web admin gates on the server inbox and opens at /admin', () => {
  const desk = read('src/screens/AdminDesk.jsx')
  const nav = read('src/lib/navigation.js')
  const account = read('src/screens/AccountScreenImpl.jsx')
  assert.match(desk, /fetchAdminInbox/)
  assert.doesNotMatch(desk, /isAdminIdentity/)
  assert.match(desk, /\['inbox', 'To-do'\]/)
  assert.match(desk, /<AdminDrivers embedded/)
  assert.match(read('src/screens/AdminDrivers.jsx'), /if \(embedded\)/)
  assert.match(nav, /pathname = '\/admin'/)
  assert.match(account, /fetchAdminInbox/)
  assert.match(account, /Admin dashboard/)
  assert.doesNotMatch(account, /isAdminIdentity/)
})

test('rider and driver Account and Settings show the server-gated Admin row', () => {
  const surfaces = [
    'apps/rider/app/(tabs)/account.tsx',
    'apps/driver/app/(tabs)/menu.tsx',
    'apps/driver/app/settings/index.tsx',
    'apps/driver/app/account.tsx',
  ]
  for (const path of surfaces) {
    const source = read(path)
    assert.match(source, /AdminAccountRow/, path)
    assert.match(source, /router\.push\('\/admin'\)/, path)
  }
  for (const path of ['apps/rider/app/admin.tsx', 'apps/driver/app/admin.tsx']) {
    const source = read(path)
    assert.match(source, /AdminInboxScreen/, path)
    assert.match(source, /openBrowserAsync/, path)
  }
  const screen = read('packages/rides-native/AdminInboxScreen.jsx')
  assert.match(screen, /useEffect/)
  assert.doesNotMatch(screen, /useState\(\(\) => \{\s*reload\(\)/)
})
