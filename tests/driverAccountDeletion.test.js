import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

test('driver has an immediate in-app account deletion route', () => {
  const route = read('apps/driver/app/delete-account.tsx')
  assert.match(route, /authedJson\(supabase, '\/api\/account\?action=delete'/)
  assert.match(route, /confirm:\s*'DELETE'/)
  assert.match(route, /confirmText\.trim\(\) === 'DELETE'/)
  assert.match(route, /Alert\.alert\(/)
  assert.match(route, /style:\s*'destructive'/)
  assert.match(route, /Deletion is immediate/)
  assert.match(route, /trip in progress/)
  assert.match(route, /router\.replace\('\/sign-in'\)/)
  assert.match(route, /signOut\(\)/)
  assert.doesNotMatch(route, /buildAccountDeletionTicket|\/api\/support-ticket/)
})

test('driver Menu opens the account deletion route', () => {
  const menu = read('apps/driver/app/(tabs)/menu.tsx')
  assert.match(menu, /router\.push\('\/delete-account'\)/)
  assert.match(menu, />Delete account<\/Text>/)
})
