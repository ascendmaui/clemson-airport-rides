import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('web wires /partners, /partners/join, /drivers/rentals and the admin tab', () => {
  const app = read('src/App.jsx')
  assert.match(app, /case 'partners':/)
  assert.match(app, /params\.sub === 'join'/)
  assert.match(app, /case 'drivers':/)
  assert.match(read('src/lib/navigation.js'), /path === 'partners' \|\| path === 'drivers'/)
  assert.match(read('src/screens/AdminDesk.jsx'), /'rentals', 'Rental partners'/)
})

test('forms render the shared vehicle rules and off-platform payment copy', () => {
  const ui = read('src/screens/RentalPartners.jsx')
  assert.match(ui, /VEHICLE_RULES_COPY/)
  assert.match(ui, /OFF_PLATFORM_PAYMENT_NOTE/)
  assert.match(ui, /Draft, needs legal review/)
  assert.match(ui, /evaluateListing/)
})

test('"No car? Rent one" entry is on web onboarding, the drive page and the driver app', () => {
  assert.match(read('src/screens/DriverOnboarding.jsx'), /No car\? Rent one/)
  assert.match(read('src/screens/DriveWithUs.jsx'), /drivers\/rentals/)
  assert.match(read('apps/driver/app/onboarding.tsx'), /WEB_DRIVER_RENTALS_URL/)
})
