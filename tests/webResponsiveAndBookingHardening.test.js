import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const read = (rel) => readFileSync(new URL(rel, root), 'utf8')

test('RideTiers guards missing pickup before calling the live quote endpoint', () => {
  const src = read('src/screens/RideTiers.jsx')
  assert.match(src, /!String\(pickup \|\| ''\)\.trim\(\)/)
  assert.match(src, /Choose a pickup spot first to load live fares\./)
  assert.ok(
    src.indexOf('Choose a pickup spot first to load live fares.') < src.indexOf('fetchRideQuote('),
    'missing pickup guard must run before fetchRideQuote',
  )
})

test('web booking screens and tier CTA prevent sticky tab-bar and button overlap', () => {
  const riderHome = read('src/screens/RiderHome.jsx')
  const schedule = read('src/screens/ScheduleAirport.jsx')
  const indexCss = read('src/index.css')

  assert.match(riderHome, /className="fade-in booking-home" style=\{\{[^}]*height:\s*'100%'/)
  assert.match(riderHome, /className="booking-home-scroll" style=\{\{[^}]*minHeight:\s*0[^}]*paddingBottom:\s*24/)
  assert.match(schedule, /className="fade-in" style=\{\{[^}]*display:\s*'flex'[^}]*height:\s*'100%'/)
  assert.match(schedule, /flex:\s*1,\s*minHeight:\s*0,\s*padding:\s*'20px 20px 32px',\s*overflowY:\s*'auto'/)

  const ctaStart = indexCss.indexOf('.ride-tiers__cta {')
  assert.ok(ctaStart >= 0, '.ride-tiers__cta rule exists')
  const ctaBlock = indexCss.slice(ctaStart, indexCss.indexOf('}', ctaStart) + 1)
  assert.match(ctaBlock, /position:\s*relative;/)
  assert.doesNotMatch(ctaBlock, /position:\s*sticky;/)
})

test('marketing chrome, hero links, and drive tier rows avoid clipping and mobile overflow', () => {
  const chrome = read('src/components/MarketingChrome.jsx')
  const siteCss = read('src/styles/site.css')
  const drivePerksCss = read('src/styles/drivePerks.css')

  assert.match(chrome, /mkt-menu--left/)
  assert.match(chrome, /mkt-menu--right/)
  assert.match(siteCss, /@media \(min-width: 1100px\)[\s\S]*?\.mkt-menu/)
  assert.match(siteCss, /\.site-hero-links\s*\{[\s\S]*?flex-wrap:\s*wrap;/)
  assert.match(drivePerksCss, /\.dp-tier\s*\{[\s\S]*?flex-wrap:\s*wrap;/)
})

test('native rider confirm screen keeps static CTA label and inline guidance', () => {
  const confirm = read('apps/rider/app/confirm.tsx')
  assert.match(confirm, /label="Confirm pickup"/)
  assert.match(confirm, /disabled=\{!canConfirm\}/)
  assert.match(confirm, /Choose or locate a pickup address to continue\./)
})

test('PickDriver uses concise Extra Comfort copy without retired fleet wording', () => {
  const pickDriver = read('src/screens/PickDriver.jsx')
  assert.match(pickDriver, /setError\('Extra Comfort only\.'\)/)
  assert.doesNotMatch(pickDriver, /Extra Comfort fleet/)
})

test('CI workflow enforces typecheck, production build, and unit tests', () => {
  const ci = read('.github/workflows/ci.yml')
  assert.match(ci, /node scripts\/typecheck\.mjs/)
  assert.match(ci, /npm run build/)
  assert.match(ci, /npm test/)
})
