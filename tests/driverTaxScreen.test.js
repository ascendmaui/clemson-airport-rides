import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

test('driver tax screen exports a yearly summary and links 1099 forms', () => {
  const screen = read('apps/driver/app/tax.tsx')
  const menu = read('apps/driver/app/(tabs)/menu.tsx')
  const earnings = read('apps/driver/app/(tabs)/earnings.tsx')
  const migration = read('supabase/migrations/20261012235000_driver_tax_mileage.sql')
  const router = read('api/driver.js')
  const npmTest = JSON.parse(read('package.json')).scripts.test

  assert.match(screen, /Estimated mileage deduction/)
  assert.match(screen, /Download CSV/)
  assert.match(screen, /Download PDF/)
  assert.match(screen, /packet\.disclaimer/)
  assert.match(screen, /Open 1099 forms in Stripe/)
  assert.match(screen, /1099 info/)
  assert.match(screen, /colors\.purple/)
  assert.match(screen, /colors\.orange/)
  assert.match(screen, /W-9/)
  assert.match(screen, /router\.push\('\/w9'\)/)
  assert.match(screen, /Yearly earnings summary/i)
  assert.match(screen, /Monthly breakdown/)
  assert.match(screen, /Bonuses and perks/)
  assert.doesNotMatch(screen, /Coming soon/)
  assert.doesNotMatch(screen, /Update W-9[\s\S]{0,120}\/onboarding/)
  assert.match(menu, /Year-end mileage and earnings/)
  assert.match(earnings, /Open tax summary/)
  assert.match(migration, /create table if not exists public\.driver_mileage_logs/)
  assert.match(migration, /driver_id = auth\.uid\(\)/)
  assert.match(migration, /enable row level security/)
  const web = read('src/screens/DriverEarnings.jsx')
  assert.match(web, /data-testid="tax-summary"/)
  assert.match(web, /data-testid="tax-disclaimer"/)
  assert.match(web, /Download CSV/)
  assert.match(web, /Download PDF/)
  assert.match(web, /TAX_NOT_ADVICE/)
  assert.match(web, /STRIPE_CONNECT_1099_URL/)
  assert.match(web, /Estimated deduction/)
  assert.match(router, /tax-summary/)
  for (const file of [
    'shared/driverTaxMileage.test.js',
    'tests/driverTaxMileageSql.test.js',
    'server/driverTaxSummary.test.js',
    'apps/driver/lib/taxPacket.test.mjs',
    'tests/driverTaxScreen.test.js',
  ]) {
    assert.match(npmTest, new RegExp(file.replace(/\./g, '\\.')))
  }
})
