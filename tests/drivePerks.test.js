import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PAY_TIERS, PERK_GROUPS, COMPARISON_ROWS, RENTAL } from '../src/content/drivePerks.js'

test('drive page perks, tiers and rental copy stay accurate', () => {
  assert.deepEqual(PAY_TIERS.map((t) => t.range), ['Under $30', '$30–35', '$35–40', '$40–45', '$45–50', '$50–100', 'Above $100'])
  assert.deepEqual(PERK_GROUPS.map((g) => g.title), ['See the pay before you accept', 'Get paid fast', 'Earn more', 'Work smarter with AI', 'Safety & control'])
  assert.equal(PERK_GROUPS.flatMap((g) => g.perks).length, 18)
  assert.equal(RENTAL.title, 'No car? Rent one and start driving.')
  assert.match(RENTAL.body.join(' '), /Typical weekly rentals run about \$300–\$400/)
  assert.match(RENTAL.note, /Availability may vary/)
  const fleet = RENTAL.paths.find((p) => p.id === 'fleet')
  assert.equal(fleet.status, 'Coming soon')
  assert.equal(fleet.cta, 'Get notified')
  assert.doesNotMatch(JSON.stringify(fleet), /Reserve|\$|book/i)
  assert.match(RENTAL.paths.find((p) => p.id === 'turo').body, /Check the host’s rideshare policy/)
  const all = readFileSync(new URL('../src/content/drivePerks.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/components/DrivePerks.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(all, new RegExp(['te' + 'sla', 'robo' + 'taxi'].join('|'), 'i'))
  assert.doesNotMatch(JSON.stringify(COMPARISON_ROWS), /Uber|Lyft|don't|lack/i)
  assert.match(readFileSync(new URL('../src/components/DrivePerks.jsx', import.meta.url), 'utf8'), /needs_vehicle: '1'/)
})
