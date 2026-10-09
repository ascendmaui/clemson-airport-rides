import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

test('driver has an in-app account deletion request route', () => {
  const route = read('apps/driver/app/delete-account.tsx')
  assert.match(route, /buildAccountDeletionTicket\(\{\s*email:\s*user\.email,\s*roleVariant:\s*'driver'/)
  assert.match(route, /authedJson\(supabase, '\/api\/support-ticket'/)
  assert.match(route, /Alert\.alert\(/)
  assert.match(route, /style:\s*'destructive'/)
})

test('driver Menu opens the account deletion route', () => {
  const menu = read('apps/driver/app/(tabs)/menu.tsx')
  assert.match(menu, /router\.push\('\/delete-account'\)/)
  assert.match(menu, />Delete account<\/Text>/)
})
