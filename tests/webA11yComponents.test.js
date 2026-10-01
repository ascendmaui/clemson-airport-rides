import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')

function readSource(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('index.css includes standard accessibility utilities and focus-visible indicators', () => {
  const css = readSource('src/index.css')

  // Screen reader utility class
  assert.match(css, /\.sr-only\s*\{/, 'defines .sr-only class')
  assert.match(css, /clip:\s*rect\(0,\s*0,\s*0,\s*0\)/, 'sr-only clips visually')

  // Focus visible styles
  assert.match(css, /:focus-visible\s*\{/, 'defines global :focus-visible rule')
  assert.match(css, /outline:\s*2px solid var\(--orange\)/, 'focus-visible provides high-contrast outline')

  // Component focus states
  assert.match(css, /\.primary-cta:focus-visible\s*\{/, 'defines .primary-cta:focus-visible')
  assert.match(css, /\.primary-cta\.variant-purple:focus-visible\s*\{/, 'defines .primary-cta.variant-purple:focus-visible')
  assert.match(css, /\.pill-btn:focus-visible\s*\{/, 'defines .pill-btn:focus-visible')
  assert.match(css, /\.search-field-container:focus-within\s*\{/, 'defines search container focus-within outline')

  // Spinner animation
  assert.match(css, /@keyframes\s+spin\s*\{/, 'defines @keyframes spin for accessible busy states')
})

test('PrimaryButton.jsx provides accessible roles, busy states, labels, and variant focus styling', () => {
  const code = readSource('src/components/PrimaryButton.jsx')
  
  // Syntax check with babel parser
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'PrimaryButton parses cleanly')

  // Accessibility features
  assert.match(code, /loading\s*=\s*false/, 'supports loading state')
  assert.match(code, /ariaLabel/, 'supports explicit ariaLabel')
  assert.match(code, /aria-busy=\{loading\s*\?\s*['"]true['"]\s*:\s*undefined\}/, 'wires aria-busy to loading prop')
  assert.match(code, /aria-disabled=\{isDisabled\s*\?\s*['"]true['"]\s*:\s*undefined\}/, 'wires aria-disabled to disabled/loading')
  assert.match(code, /aria-label=\{ariaLabel/, 'wires aria-label')
  assert.match(code, /variant-\$\{variant\}/, 'attaches variant class for specific focus outlines')
  assert.match(code, /className="button-spinner"/, 'renders button spinner when loading')
  assert.match(code, /aria-hidden="true"/, 'hides decorative spinner icon from screen readers')
  assert.match(code, /cursor:\s*isDisabled\s*\?\s*['"]not-allowed['"]\s*:\s*['"]pointer['"]/, 'provides visual disabled affordance')

  // PurpleAcceptButton helper preserves Clemson purple variant
  assert.match(code, /export function PurpleAcceptButton\(props\)/, 'exports PurpleAcceptButton')
  assert.match(code, /variant="purple"/, 'PurpleAcceptButton sets variant="purple"')
})

test('SearchField.jsx exposes search role, screen-reader label, and accessible SVG icon', () => {
  const code = readSource('src/components/SearchField.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'SearchField parses cleanly')

  // Landmark search role and container class
  assert.match(code, /role="search"/, 'container specifies role="search"')
  assert.match(code, /search-field-container/, 'container has search-field-container class')

  // Screen-reader accessible label
  assert.match(code, /<label\s+htmlFor=\{id\}\s+className="sr-only">/, 'includes hidden screen reader label associated to input id')
  assert.match(code, /aria-hidden="true"/, 'marks decorative magnifying glass SVG as aria-hidden')
  assert.match(code, /focusable="false"/, 'prevents SVG from receiving IE/Edge focus')

  // Input attributes
  assert.match(code, /type="search"/, 'input specifies type="search"')
  assert.match(code, /aria-label=\{label\s*\|\|\s*placeholder\}/, 'input specifies aria-label fallback')
  assert.match(code, /className="search-field-input"/, 'input has search-field-input class')
  assert.match(code, /autoComplete=\{autoComplete\}/, 'supports autoComplete')
  assert.match(code, /onBlur=\{onBlur\}/, 'wires onBlur event handler')
})

test('Pill.jsx supports toggle state announcements and accessible icons', () => {
  const code = readSource('src/components/Pill.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'Pill parses cleanly')

  // Toggle button accessibility
  assert.match(code, /pill-btn/, 'includes pill-btn class for keyboard focus')
  assert.match(code, /aria-pressed=\{active\s*!==\s*undefined\s*\?\s*Boolean\(active\)\s*:\s*undefined\}/, 'wires aria-pressed when pill acts as toggle')
  assert.match(code, /aria-label=\{ariaLabel/, 'supports aria-label prop')
  assert.match(code, /aria-hidden="true"/, 'hides emoji or icon element from screen readers')
})
