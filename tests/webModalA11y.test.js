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

test('A11yModal.jsx exports useModalA11y hook with escape key, focus trapping and body scroll locking', () => {
  const code = readSource('src/components/A11yModal.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'A11yModal parses cleanly')

  assert.match(code, /export function useModalA11y/, 'exports useModalA11y')
  assert.match(code, /e\.key === ['"]Escape['"]/, 'handles Escape key event')
  assert.match(code, /onClose\?\.?\(\)/, 'calls onClose handler when Escape pressed')
  assert.match(code, /e\.key === ['"]Tab['"]/, 'handles Tab key focus trap')
  assert.match(code, /e\.shiftKey/, 'supports backward Shift+Tab focus cycling')
  assert.match(code, /document\.body\.style\.overflow\s*=\s*['"]hidden['"]/, 'locks background scroll when modal opens')
  assert.match(code, /previousFocusRef\.current/, 'remembers and restores previous active focus element')
})

test('A11yModal.jsx exports A11yModalDialog with accessible dialog attributes', () => {
  const code = readSource('src/components/A11yModal.jsx')

  assert.match(code, /export function A11yModalDialog/, 'exports A11yModalDialog')
  assert.match(code, /role="dialog"/, 'declares role="dialog"')
  assert.match(code, /aria-modal="true"/, 'declares aria-modal="true"')
  assert.match(code, /aria-labelledby=\{titleId\}/, 'wires aria-labelledby')
  assert.match(code, /ref=\{dialogRef\}/, 'attaches useModalA11y ref to dialog container')
})

test('SignInToBookModal.jsx wires useModalA11y and accessible dialog semantics', () => {
  const code = readSource('src/components/SignInToBookModal.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'SignInToBookModal parses cleanly')

  assert.match(code, /import.*useModalA11y.*from\s+['"]\.\/A11yModal['"]/, 'imports useModalA11y')
  assert.match(code, /useModalA11y\(\{\s*isOpen:\s*open,\s*onClose\s*\}\)/, 'invokes useModalA11y hook')
  assert.match(code, /ref=\{dialogRef\}/, 'attaches dialogRef to card container')
  assert.match(code, /role="dialog"/, 'declares role="dialog"')
  assert.match(code, /aria-modal="true"/, 'declares aria-modal="true"')
  assert.match(code, /aria-labelledby="sign-in-to-book-title"/, 'labels dialog via title ID')
})

test('UpsellModal.jsx wires useModalA11y, dialog role, and title labelling', () => {
  const code = readSource('src/components/UpsellModal.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'UpsellModal parses cleanly')

  assert.match(code, /import.*useModalA11y.*from\s+['"]\.\/A11yModal['"]/, 'imports useModalA11y')
  assert.match(code, /useModalA11y\(\{\s*isOpen:\s*open,\s*onClose\s*\}\)/, 'invokes useModalA11y hook')
  assert.match(code, /ref=\{dialogRef\}/, 'attaches dialogRef to inner card')
  assert.match(code, /role="dialog"/, 'declares role="dialog"')
  assert.match(code, /aria-modal="true"/, 'declares aria-modal="true"')
  assert.match(code, /aria-labelledby="upsell-modal-title"/, 'wires aria-labelledby')
  assert.match(code, /id="upsell-modal-title"/, 'assigns matching ID to header element')
  assert.match(code, /aria-hidden="true"/, 'decorative emoji is hidden from screen readers')
})

test('PaymentFailedSheet.jsx wires useModalA11y for keyboard escape and modal trapping', () => {
  const code = readSource('src/components/PaymentFailedSheet.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'PaymentFailedSheet parses cleanly')

  assert.match(code, /import.*useModalA11y.*from\s+['"]\.\/A11yModal['"]/, 'imports useModalA11y')
  assert.match(code, /useModalA11y\(\{\s*isOpen:\s*Boolean\(failure\),\s*onClose:\s*onDismiss\s*\}\)/, 'wires useModalA11y with failure visibility')
  assert.match(code, /ref=\{sheetRef\}/, 'attaches ref to sheet container')
  assert.match(code, /role="dialog"/, 'declares role="dialog"')
  assert.match(code, /aria-modal="true"/, 'declares aria-modal="true"')
})
