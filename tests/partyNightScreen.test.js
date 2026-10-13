import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const screen = readFileSync(path.join(root, 'src/screens/PartyNight.jsx'), 'utf8')

test('party night screen is the explainer, the split, the reminder, and the return queue', () => {
  assert.match(screen, /How a party night works/)
  assert.match(screen, /Schedule the night out/)
  assert.match(screen, /Pre-authorization hold/)
  assert.match(screen, /Not a deposit/)
  assert.match(screen, /PICKUP REMINDER/)
  assert.match(screen, /Late-night return queue/)
  assert.match(screen, /Invite link/)
  assert.match(screen, /#F56600/)
  assert.match(screen, /#522D80/)
  assert.match(screen, /minHeight: 44/)
  assert.equal(/pay a deposit|25% deposit/i.test(screen), false)
})
