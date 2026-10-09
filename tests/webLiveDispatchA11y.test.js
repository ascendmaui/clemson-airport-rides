import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import {
  DISPATCH_A11Y_ROLE,
  DISPATCH_A11Y_LIVE,
  DISPATCH_STATUS_TEXT,
  formatTripProgressValueText,
  getProgressStepA11yProps,
  getLivePhaseRegionProps,
  formatDispatchStatusAnnouncement,
} from '../src/lib/liveDispatchA11y.js'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')

function readSource(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('liveDispatchA11y constants and defaults', () => {
  assert.equal(DISPATCH_A11Y_ROLE, 'status')
  assert.equal(DISPATCH_A11Y_LIVE, 'polite')
  assert.ok(DISPATCH_STATUS_TEXT.searching)
  assert.ok(DISPATCH_STATUS_TEXT.accepted)
  assert.ok(DISPATCH_STATUS_TEXT.arriving)
  assert.ok(DISPATCH_STATUS_TEXT.completed)
})

test('formatTripProgressValueText handles steps and edges', () => {
  const steps = [
    { id: 'req', label: 'Requested' },
    { id: 'route', label: 'En route' },
    { id: 'arrived', label: 'Arrived' },
    { id: 'done', label: 'Completed' },
  ]

  assert.equal(formatTripProgressValueText(0, steps), 'Step 1 of 4: Requested')
  assert.equal(formatTripProgressValueText(1, steps), 'Step 2 of 4: En route')
  assert.equal(formatTripProgressValueText(3, steps), 'Step 4 of 4: Completed')

  // Negative or empty edges
  assert.equal(formatTripProgressValueText(-1, steps), '')
  assert.equal(formatTripProgressValueText(0, []), '')
  assert.equal(formatTripProgressValueText(0, null), '')
})

test('getProgressStepA11yProps returns complete progressbar attributes', () => {
  const steps = [
    { id: 's1', label: 'Step 1' },
    { id: 's2', label: 'Step 2' },
    { id: 's3', label: 'Step 3' },
  ]
  const props = getProgressStepA11yProps({ activeIndex: 1, steps, label: 'Driver progress' })

  assert.equal(props.role, 'progressbar')
  assert.equal(props['aria-label'], 'Driver progress')
  assert.equal(props['aria-valuenow'], 2)
  assert.equal(props['aria-valuemin'], 1)
  assert.equal(props['aria-valuemax'], 3)
  assert.equal(props['aria-valuetext'], 'Step 2 of 3: Step 2')
})

test('getLivePhaseRegionProps provides polite status live region defaults', () => {
  const defaults = getLivePhaseRegionProps()
  assert.equal(defaults.role, 'status')
  assert.equal(defaults['aria-live'], 'polite')
  assert.equal(defaults['aria-atomic'], 'true')

  const assertive = getLivePhaseRegionProps({ role: 'alert', ariaLive: 'assertive', ariaAtomic: false })
  assert.equal(assertive.role, 'alert')
  assert.equal(assertive['aria-live'], 'assertive')
  assert.equal(assertive['aria-atomic'], 'false')
})

test('formatDispatchStatusAnnouncement formats status announcements with driver and ETA', () => {
  assert.equal(
    formatDispatchStatusAnnouncement({ status: 'searching' }),
    'Looking for available drivers nearby...',
  )

  const matchAnnounce = formatDispatchStatusAnnouncement({
    status: 'accepted',
    driverName: 'Trevor',
    eta: '6 mins',
  })
  assert.equal(matchAnnounce, 'Driver Trevor accepted your ride! · ETA: 6 mins')

  const arrivingAnnounce = formatDispatchStatusAnnouncement({
    status: 'arriving',
    driverName: 'Trevor',
    eta: '2 mins',
  })
  assert.equal(arrivingAnnounce, 'Trevor is en route to your pickup location. · Estimated arrival: 2 mins')

  assert.equal(
    formatDispatchStatusAnnouncement({ status: 'in_progress' }),
    'Trip is underway to your destination.',
  )

  assert.equal(
    formatDispatchStatusAnnouncement({ status: 'completed' }),
    'Trip completed. Thank you for riding!',
  )

  assert.equal(
    formatDispatchStatusAnnouncement({ status: 'canceled' }),
    'This ride has been canceled.',
  )
})

test('LivePhase.jsx parses cleanly and provides live region and progressbar semantics', () => {
  const code = readSource('src/components/LivePhase.jsx')
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'LivePhase parses cleanly as valid JSX AST')

  assert.match(code, /getLivePhaseRegionProps/, 'imports getLivePhaseRegionProps')
  assert.match(code, /getProgressStepA11yProps/, 'imports getProgressStepA11yProps')
  assert.match(code, /role\s*=\s*['"]status['"]/, 'defaults role to status')
  assert.match(code, /ariaLive\s*=\s*['"]polite['"]/, 'defaults ariaLive to polite')
  assert.match(code, /ariaAtomic\s*=\s*true/, 'defaults ariaAtomic to true')
  assert.match(code, /\{\.\.\.liveRegionProps\}/, 'spreads live region attributes onto status container')
  assert.match(code, /\{\.\.\.progressProps\}/, 'spreads progressbar attributes onto trip steps container')
  assert.match(code, /aria-current=\{current\s*\?\s*['"]step['"]\s*:\s*undefined\}/, 'marks active step with aria-current="step"')
  assert.match(code, /aria-hidden="true"/, 'hides decorative step segments from assistive technology')
})
