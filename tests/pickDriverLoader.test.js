import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('pick-driver loading state is a centered mark, not an empty slab', () => {
  const screen = readFileSync(path.join(ROOT, 'apps/rider/app/pick-driver.tsx'), 'utf8')
  const loader = readFileSync(path.join(ROOT, 'apps/rider/components/ClemsonLoader.tsx'), 'utf8')

  assert.doesNotMatch(screen, /Skeleton/)
  assert.doesNotMatch(screen, /colors\.tabBar/)
  assert.match(screen, /styles\.loaderCard/)
  assert.match(screen, /justifyContent: 'center'/)
  assert.doesNotMatch(loader, /marginTop:\s*8\d/)
  assert.match(loader, /styles\.mark/)
  assert.match(loader, /top: 0/)
  assert.match(loader, /left: 0/)
  assert.match(loader, /PawMark/)
})
