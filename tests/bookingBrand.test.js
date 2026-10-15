import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const iconMarks = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2139}\u{23F3}\uFE0F★☆✓]/u

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8')
}

test('the site title, Open Graph title, and Twitter title say Clemson Rides', () => {
  const html = read('index.html')
  assert.match(html, /<title>Clemson Rides<\/title>/)
  assert.match(html, /property="og:title" content="Clemson Rides"/)
  assert.match(html, /name="twitter:title" content="Clemson Rides"/)
  assert.match(html, /name="description" content="Clemson Rides —/)
  assert.match(html, /property="og:description" content="Clemson Rides —/)
  assert.doesNotMatch(html, /Clemson RIDES/)
})

test('booking screens do not use Clemson RIDES or emoji as icons', () => {
  const dir = path.join(root, 'src/screens')
  const files = readdirSync(dir).filter((name) => name.endsWith('.jsx'))
  assert.ok(files.includes('RiderHome.jsx'))
  for (const name of files) {
    const text = read(path.join('src/screens', name))
    assert.doesNotMatch(text, /Clemson RIDES/, name)
    assert.doesNotMatch(text, /CLEMSON RIDES/, name)
    assert.doesNotMatch(text, iconMarks, name)
  }
})
