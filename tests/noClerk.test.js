import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// ASCII bytes for the removed auth vendor name. Kept split so this file
// does not contain the token it is guarding. The root test script invokes
// this file as tests/no*.test.js for the same reason.
const NEEDLE = Buffer.from([0x63, 0x6c, 0x65, 0x72, 0x6b])

function allowed(file) {
  return file === 'docs/FIXES.md' || file === 'package-lock.json' || file.endsWith('/package-lock.json')
}

function hasNeedle(buf) {
  const n = NEEDLE.length
  if (buf.length < n) return false
  for (let i = 0; i <= buf.length - n; i++) {
    let match = true
    for (let j = 0; j < n; j++) {
      let byte = buf[i + j]
      if (byte >= 0x41 && byte <= 0x5a) byte += 0x20
      if (byte !== NEEDLE[j]) {
        match = false
        break
      }
    }
    if (match) return true
  }
  return false
}

test('tracked files omit the removed auth vendor name', () => {
  const listed = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  const files = listed.split('\0').filter(Boolean)
  const hits = []
  for (const file of files) {
    if (allowed(file)) continue
    if (hasNeedle(readFileSync(file))) hits.push(file)
  }
  assert.deepEqual(hits, [])
})
