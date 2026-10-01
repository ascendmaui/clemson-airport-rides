import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import {
  TOUCH_TARGET_MIN_PX,
  TOUCH_TARGET_SPACING_MIN_PX,
  isTouchTargetAccessible,
  isTapSpacingAccessible,
  enforceTouchTarget,
  getTouchButtonProps,
} from '../src/lib/touchA11y.js'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')

function readSource(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('touchA11y: constants and validators enforce 44px minimum touch targets and 8px tap clearance', () => {
  assert.equal(TOUCH_TARGET_MIN_PX, 44, 'standard touch target minimum is 44px')
  assert.equal(TOUCH_TARGET_SPACING_MIN_PX, 8, 'minimum tap spacing is 8px')

  // Target size tests
  assert.equal(isTouchTargetAccessible(44, 44), true)
  assert.equal(isTouchTargetAccessible(48, 50), true)
  assert.equal(isTouchTargetAccessible(40, 40), false)
  assert.equal(isTouchTargetAccessible(44, 32), false)

  // Spacing tests
  assert.equal(isTapSpacingAccessible(8), true)
  assert.equal(isTapSpacingAccessible(12), true)
  assert.equal(isTapSpacingAccessible(6), false)
  assert.equal(isTapSpacingAccessible(0), false)
})

test('touchA11y: enforceTouchTarget and getTouchButtonProps generate compliant style props', () => {
  // Enforces 44px on smaller elements
  const smallStyle = enforceTouchTarget({ width: 28, height: 28, borderRadius: 8 })
  assert.equal(smallStyle.minWidth, 44)
  assert.equal(smallStyle.minHeight, 44)
  assert.equal(smallStyle.borderRadius, 8)

  // Preserves dimensions that already exceed 44px
  const largeStyle = enforceTouchTarget({ width: 64, height: 52 })
  assert.equal(largeStyle.minWidth, 64)
  assert.equal(largeStyle.minHeight, 52)

  // Helper with label
  const buttonProps = getTouchButtonProps({ label: 'Dismiss alert', style: { width: 32, height: 32 } })
  assert.equal(buttonProps['aria-label'], 'Dismiss alert')
  assert.equal(buttonProps.style.minWidth, 44)
  assert.equal(buttonProps.style.minHeight, 44)
})

test('tokens.css declares touch target and spacing design tokens', () => {
  const css = readSource('src/styles/tokens.css')

  assert.match(css, /--touch-target-min:\s*44px;/, 'declares --touch-target-min: 44px')
  assert.match(css, /--touch-target-spacing:\s*8px;/, 'declares --touch-target-spacing: 8px')
})

test('index.css declares .touch-target-min, .nav-back-btn, and hit-area expansions', () => {
  const css = readSource('src/index.css')

  // Base touch target utilities
  assert.match(css, /\.touch-target-min\s*\{/, 'defines .touch-target-min rule')
  assert.match(css, /min-width:\s*var\(--touch-target-min,\s*44px\)/, 'enforces 44px min-width')
  assert.match(css, /min-height:\s*var\(--touch-target-min,\s*44px\)/, 'enforces 44px min-height')

  // Dedicated navigation back button class
  assert.match(css, /\.nav-back-btn\s*\{/, 'defines .nav-back-btn')
  assert.match(css, /width:\s*44px;/, 'nav-back-btn sets 44px width')
  assert.match(css, /height:\s*44px;/, 'nav-back-btn sets 44px height')

  // Hit-area pseudo-element expansion for compact dismiss buttons
  assert.match(css, /\.toast-dismiss::after\s*\{/, 'defines .toast-dismiss::after hit expansion')
  assert.match(css, /\.sos-banner-dismiss::after\s*\{/, 'defines .sos-banner-dismiss::after hit expansion')
})

test('Screens use .nav-back-btn with >=44px touch targets and descriptive aria-labels', () => {
  const files = [
    { path: 'src/screens/ConfirmPickup.jsx', labelMatch: /aria-label="Back to home"/ },
    { path: 'src/screens/ScheduleAirport.jsx', labelMatch: /aria-label="Back to home"/ },
    { path: 'src/screens/RideTiers.jsx', labelMatch: /aria-label="Back to pickup confirmation"/ },
    { path: 'src/screens/AccountScreenImpl.jsx', labelMatch: /aria-label="Back to home"/ },
    { path: 'src/screens/LegalPages.jsx', labelMatch: /aria-label="Back to landing"/ },
    { path: 'src/screens/ProfileView.jsx', labelMatch: /aria-label="Go back"/ },
  ]

  for (const item of files) {
    const code = readSource(item.path)
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx'],
    })
    assert.ok(ast, `${item.path} parses cleanly`)
    assert.match(code, /nav-back-btn/, `${item.path} includes nav-back-btn class`)
    assert.match(code, item.labelMatch, `${item.path} includes matching accessible label`)
  }
})
