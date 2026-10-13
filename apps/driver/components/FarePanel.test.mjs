import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { fareCollection } from '../../../packages/rides-native/tripTags.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, 'FarePanel.tsx'), 'utf8')

test('FarePanel keeps the DriverCard card prop and core fare rows', () => {
  assert.match(source, /export function FarePanel\(\{ card \}: \{ card: DriverCard \}\)/)
  assert.match(source, /fareCollection\(card\)/)
  for (const label of ['Trip fare', 'Already paid', 'Charged at trip end']) {
    assert.match(source, new RegExp(`label="${label}"`))
  }
  assert.match(source, /label="You net" value=\{formatCents\(fare\.totalNetCents\)\} strong/)
  assert.match(source, /Fare net · \$\{fare\.sharePercent\}%/)
  assert.match(source, /driverFareNote\(fare\.depositCents\)/)
})

test('FarePanel fare contract supplies the display fields for a normal driver card', () => {
  const fare = fareCollection({ fareCents: 1001 })
  assert.deepEqual(fare, {
    fareCents: 1001,
    depositCents: 0,
    remainderCents: 1001,
    driverNetCents: 801,
    boostNetCents: 0,
    backupBonusCents: 0,
    waitNetCents: 0,
    totalNetCents: 801,
    platformFeeCents: 200,
    shares: [],
    baseNetCents: null,
    carpoolBonusCents: null,
    carpoolIncentiveId: null,
    usesStoredPayout: false,
    sharePercent: 80,
  })
})

test('FarePanel carpool contract retains stored payout and split rows', () => {
  const fare = fareCollection({
    shares: [
      { id: 'a', label: 'Alex', shareCents: 1200 },
      { id: 'b', label: 'Blair', shareCents: 1200 },
    ],
    metadata: {
      kind: 'carpool',
      driver_payout_cents: 2200,
      incentive_id: 'driver_carpool_bonus',
      carpool: { driver: { payoutCents: 2200, soloPayoutCents: 1800, carpoolBonusCents: 400 } },
    },
  })
  assert.equal(fare.fareCents, 2400)
  assert.equal(fare.depositCents, 0)
  assert.equal(fare.driverNetCents, 2200)
  assert.equal(fare.platformFeeCents, 200)
  assert.equal(fare.baseNetCents, 1800)
  assert.equal(fare.carpoolBonusCents, 400)
  assert.equal(fare.carpoolIncentiveId, 'driver_carpool_bonus')
  assert.equal(fare.shares.length, 2)
})
