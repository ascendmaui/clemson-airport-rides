import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import {
  CLEMSON_TOKENS,
  BADGE_VARIANTS,
  hexToRgb,
  getRelativeLuminance,
  getContrastRatio,
  isContrastAccessible,
} from '../src/lib/colorTokens.js'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')

function readSource(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('colorTokens: hexToRgb and getRelativeLuminance calculate WCAG values accurately', () => {
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255])
  assert.deepEqual(hexToRgb('#000000'), [0, 0, 0])
  assert.deepEqual(hexToRgb('#522D80'), [82, 45, 128])

  assert.equal(Math.round(getRelativeLuminance('#FFFFFF') * 100) / 100, 1.0)
  assert.equal(getRelativeLuminance('#000000'), 0.0)

  const purpleLuminance = getRelativeLuminance('#522D80')
  assert.ok(purpleLuminance > 0.05 && purpleLuminance < 0.07, 'Clemson purple luminance is accurate')
})

test('colorTokens: getContrastRatio verifies WCAG AA compliance across Clemson text tokens', () => {
  const white = '#FFFFFF'

  // Black / White bounds
  assert.equal(getContrastRatio('#000000', '#FFFFFF'), 21.0)
  assert.equal(getContrastRatio('#FFFFFF', '#FFFFFF'), 1.0)

  // Primary Clemson Purple against white (exceeds AAA 7.0:1)
  const purpleRatio = getContrastRatio(CLEMSON_TOKENS.purpleText, white)
  assert.ok(purpleRatio >= 9.0, `Purple contrast ${purpleRatio}:1 meets AAA`)
  assert.ok(isContrastAccessible(CLEMSON_TOKENS.purpleText, white, 'AAA'))

  // High-contrast Orange text against white (exceeds AA 4.5:1)
  const orangeTextRatio = getContrastRatio(CLEMSON_TOKENS.orangeText, white)
  assert.ok(orangeTextRatio >= 4.5, `Orange text contrast ${orangeTextRatio}:1 meets AA`)
  assert.ok(isContrastAccessible(CLEMSON_TOKENS.orangeText, white, 'AA'))

  // High-contrast Orange dark text against white (exceeds AAA 7.0:1)
  const orangeDarkRatio = getContrastRatio(CLEMSON_TOKENS.orangeDark, white)
  assert.ok(orangeDarkRatio >= 7.0, `Orange dark contrast ${orangeDarkRatio}:1 meets AAA`)
  assert.ok(isContrastAccessible(CLEMSON_TOKENS.orangeDark, white, 'AAA'))

  // Accessible Success & Danger against white
  const successRatio = getContrastRatio(CLEMSON_TOKENS.successText, white)
  assert.ok(successRatio >= 4.5, `Success text contrast ${successRatio}:1 meets AA`)
  assert.ok(isContrastAccessible(CLEMSON_TOKENS.successText, white, 'AA'))

  const dangerRatio = getContrastRatio(CLEMSON_TOKENS.dangerText, white)
  assert.ok(dangerRatio >= 4.5, `Danger text contrast ${dangerRatio}:1 meets AA`)
  assert.ok(isContrastAccessible(CLEMSON_TOKENS.dangerText, white, 'AA'))

  // High-contrast tertiary ink
  const tertiaryRatio = getContrastRatio(CLEMSON_TOKENS.inkTertiary, white)
  assert.ok(tertiaryRatio >= 4.5, `Tertiary ink contrast ${tertiaryRatio}:1 meets AA`)
})

test('colorTokens: BADGE_VARIANTS defines standard accessible token mapping', () => {
  const variants = ['purple', 'orange', 'success', 'danger', 'neutral', 'fleet']
  for (const name of variants) {
    const variant = BADGE_VARIANTS[name]
    assert.ok(variant, `Variant ${name} exists in BADGE_VARIANTS`)
    assert.ok(variant.bg, `${name} has CSS var bg`)
    assert.ok(variant.border, `${name} has CSS var border`)
    assert.ok(variant.color, `${name} has CSS var color`)

    // Verify text contrast against badge background
    const ratio = getContrastRatio(variant.textHex, variant.bgHex)
    assert.ok(ratio >= 4.5, `Badge ${name} text (${variant.textHex}) meets AA contrast against (${variant.bgHex}): ${ratio}:1`)
  }
})

test('tokens.css declares high-contrast text and badge tokens', () => {
  const css = readSource('src/styles/tokens.css')

  assert.match(css, /--orange-text:\s*#BA4700;/, 'defines --orange-text token')
  assert.match(css, /--orange-dark:\s*#963800;/, 'defines --orange-dark token')
  assert.match(css, /--purple-text:\s*#522D80;/, 'defines --purple-text token')
  assert.match(css, /--ink-tertiary-contrast:\s*#596372;/, 'defines --ink-tertiary-contrast token')
  assert.match(css, /--success-text:\s*#156938;/, 'defines --success-text token')
  assert.match(css, /--danger-text:\s*#B42318;/, 'defines --danger-text token')

  // Badge CSS variables
  assert.match(css, /--badge-purple-bg:/, 'defines --badge-purple-bg')
  assert.match(css, /--badge-purple-text:/, 'defines --badge-purple-text')
  assert.match(css, /--badge-orange-bg:/, 'defines --badge-orange-bg')
  assert.match(css, /--badge-orange-text:/, 'defines --badge-orange-text')
  assert.match(css, /--badge-success-bg:/, 'defines --badge-success-bg')
  assert.match(css, /--badge-danger-bg:/, 'defines --badge-danger-bg')
  assert.match(css, /--badge-neutral-bg:/, 'defines --badge-neutral-bg')
  assert.match(css, /--badge-fleet-bg:/, 'defines --badge-fleet-bg')
})

test('index.css includes standard .a11y-badge utility and variant styles', () => {
  const css = readSource('src/index.css')

  assert.match(css, /\.a11y-badge\s*\{/, 'defines .a11y-badge base rule')
  assert.match(css, /\.a11y-badge--purple\s*\{/, 'defines purple badge variant')
  assert.match(css, /\.a11y-badge--orange\s*\{/, 'defines orange badge variant')
  assert.match(css, /\.a11y-badge--success\s*\{/, 'defines success badge variant')
  assert.match(css, /\.a11y-badge--danger\s*\{/, 'defines danger badge variant')
  assert.match(css, /\.a11y-badge--neutral\s*\{/, 'defines neutral badge variant')
  assert.match(css, /\.a11y-badge--fleet\s*\{/, 'defines fleet badge variant')
})

test('A11yBadge.jsx component parses cleanly and supports icons and counts', () => {
  const code = readSource('src/components/A11yBadge.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'A11yBadge parses cleanly')

  assert.match(code, /export function A11yBadge/, 'exports A11yBadge function')
  assert.match(code, /className=\{`a11y-badge a11y-badge--\$\{variant\}/, 'wires variant CSS classes')
  assert.match(code, /aria-label=\{ariaLabel\}/, 'supports explicit aria-label')
  assert.match(code, /aria-hidden="true"/, 'decorative icon is hidden from screen readers')
  assert.match(code, /className="a11y-badge-count"/, 'renders count when present')
})

test('TierRow.jsx uses A11yBadge for accessible fleet and tier badges', () => {
  const code = readSource('src/components/TierRow.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'TierRow parses cleanly')

  assert.match(code, /import\s+\{\s*A11yBadge\s*\}\s+from\s+['"]\.\/A11yBadge\.jsx['"]/, 'imports A11yBadge')
  assert.match(code, /<A11yBadge variant="purple">/, 'renders A11yBadge')
})

test('SurgeBadge.jsx exposes role="status", descriptive aria-label, and high-contrast styling', () => {
  const code = readSource('src/components/SurgeBadge.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'SurgeBadge parses cleanly')

  assert.match(code, /role="status"/, 'SurgeBadge announces live price changes with role="status"')
  assert.match(code, /aria-label=\{`Surge pricing active:/, 'SurgeBadge supplies full accessible description')
  assert.match(code, /#BA4700/, 'uses WCAG AA compliant deep orange in gradient')
})
