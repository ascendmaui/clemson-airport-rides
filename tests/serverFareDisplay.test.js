import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
}

test('rider screens ask the server for the fare that is saved', () => {
  const tiers = read('src/screens/RideTiers.jsx')
  const schedule = read('src/lib/scheduledRides.js')
  const planner = read('src/components/ScheduledRidePlanner.jsx')
  const quote = read('server/endpoints/quoteFare.js')
  const tip = read('src/screens/TipRide.jsx')

  assert.match(tiers, /fetchRideQuote\(/)
  assert.match(tiers, /bookableRideTiers\(/)
  assert.doesNotMatch(tiers, /displayTierPrice|upgradePrice=\{4\.5\}|miles:\s*3|price:\s*18\.5/)
  assert.doesNotMatch(tiers, new RegExp(`id: 'xl'|id: 'pet'|id: '${'te' + 'sla'}'|upsell === '${'te' + 'sla'}'`))
  assert.match(schedule, /fetchRideQuote\(/)
  assert.doesNotMatch(schedule, /distanceFareCents|priceAirportRide|applyStudentDiscount/)
  assert.match(planner, /This is the fare saved on the ride/)
  assert.doesNotMatch(planner, /Final fare can change|Estimate from distance/)
  assert.match(quote, /riderTierQuotes\(/)
  assert.match(quote, /studentDiscountGranted/)
  assert.doesNotMatch(quote, /body\.isStudent|body\.fareCents|body\.miles|body\.amount|body\.total|body\.deposit/)
  assert.match(tip, /data-testid="tip-fare-base"/)
  assert.match(tip, /offer\.fareCents/)
})
