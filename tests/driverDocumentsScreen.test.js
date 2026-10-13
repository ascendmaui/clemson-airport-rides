import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

test('documents screen splits uploads into four status tabs and reuses the upload path', () => {
  const screen = read('apps/driver/app/documents.tsx')
  const helper = read('packages/rides-native/documentCategories.js')
  const npmTest = JSON.parse(read('package.json')).scripts.test

  assert.match(helper, /Driver's License/)
  assert.match(helper, /Insurance/)
  assert.match(helper, /Registration/)
  assert.match(helper, /Vehicle Photos/)
  assert.match(helper, /Needs your attention/)
  assert.match(screen, /DOCUMENT_CATEGORIES\.map/)
  assert.match(screen, /category\.label/)
  assert.match(screen, /status\.label/)
  assert.match(screen, /attentionScreenItems\(/)
  assert.match(screen, /attentionItems\.length === 0/)
  assert.match(screen, /Nothing else is required\./)
  assert.match(screen, /categoryAttention\(/)
  assert.match(screen, /uploadDriverDocument\(/)
  assert.match(screen, /label="Open application"/)
  assert.match(screen, /onPress=\{\(\) => openDriverApplication\(router\)\}/)
  assert.match(read('apps/driver/lib/openApplication.ts'), /router\.push\(DRIVER_APPLICATION_HREF\)/)
  assert.match(read('apps/driver/app/onboarding.tsx'), /setStepId\(next\.stepId\)/)
  assert.doesNotMatch(read('apps/driver/app/onboarding.tsx'), /Redirect href="\/\(tabs\)"/)
  assert.match(screen, /colors\.orange/)
  assert.match(screen, /tone=\{slot\.action === 'replace' \? 'purple' : 'orange'\}/)
  assert.doesNotMatch(screen, /review_status\s*===?\s*['"]approved['"]/)
  assert.doesNotMatch(screen, /supabase\.storage\.from\(/)
  assert.match(helper, /export function categoryAttention/)
  assert.match(helper, /doc_type/)
  assert.equal((helper.match(/function attention\(/g) || []).length, 1)

  for (const file of [
    'packages/rides-native/documentCategories.test.js',
    'tests/driverDocumentsScreen.test.js',
    'apps/driver/lib/openApplication.test.mjs',
  ]) {
    assert.match(npmTest, new RegExp(file.replace(/\./g, '\\.')))
  }
})
