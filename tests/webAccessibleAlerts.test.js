import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import { normalizeErrorCopy } from '../src/lib/errorUtils.js'
import {
  GENERIC_ERROR_COPY,
  UNAVAILABLE_COPY,
  AUTH_REQUIRED_COPY,
  NETWORK_ERROR_COPY,
} from '../src/lib/apiErrors.js'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')

function readSource(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('normalizeErrorCopy prevents technical and secret leaks while preserving user copy', () => {
  // Empty / null
  assert.equal(normalizeErrorCopy(null), '')
  assert.equal(normalizeErrorCopy(''), '')
  assert.equal(normalizeErrorCopy('   '), '')

  // User-facing friendly strings preserved
  assert.equal(
    normalizeErrorCopy('That driver is offline. This request does not auto-match.'),
    'That driver is offline. This request does not auto-match.'
  )
  assert.equal(
    normalizeErrorCopy('Sign in with an active trip to share location'),
    'Sign in with an active trip to share location'
  )

  // Technical internal server error / stack traces sanitized
  assert.equal(normalizeErrorCopy('Internal server error'), GENERIC_ERROR_COPY)
  assert.equal(normalizeErrorCopy('TypeError: Cannot read properties of undefined'), GENERIC_ERROR_COPY)
  assert.equal(normalizeErrorCopy('UnhandledPromiseRejection: failed at client.js:42'), GENERIC_ERROR_COPY)
  assert.equal(normalizeErrorCopy('500 internal server error'), GENERIC_ERROR_COPY)

  // Secret environment variables never leak
  assert.equal(
    normalizeErrorCopy('SUPABASE_SERVICE_ROLE_KEY is not set in production'),
    UNAVAILABLE_COPY
  )
  assert.equal(
    normalizeErrorCopy('STRIPE_SECRET_KEY missing in server config'),
    UNAVAILABLE_COPY
  )

  // Error object handling
  const errObj = new Error('VITE_SUPABASE_ANON_KEY not configured')
  assert.equal(normalizeErrorCopy(errObj), UNAVAILABLE_COPY)

  // HTTP status mapping
  assert.equal(normalizeErrorCopy({ status: 401 }), AUTH_REQUIRED_COPY)
  assert.equal(normalizeErrorCopy({ status: 503 }), UNAVAILABLE_COPY)
  assert.equal(normalizeErrorCopy({ status: 0 }), NETWORK_ERROR_COPY)
})

test('index.css includes accessible alert and error boundary styling', () => {
  const css = readSource('src/index.css')

  assert.match(css, /\.accessible-alert\s*\{/, 'defines .accessible-alert base class')
  assert.match(css, /\.accessible-alert--danger\s*\{/, 'defines .accessible-alert--danger')
  assert.match(css, /\.accessible-alert--warning\s*\{/, 'defines .accessible-alert--warning')
  assert.match(css, /\.accessible-alert--info\s*\{/, 'defines .accessible-alert--info')
  assert.match(css, /\.accessible-error-boundary\s*\{/, 'defines .accessible-error-boundary')
})

test('AccessibleAlert component declares accessible roles and attributes', () => {
  const code = readSource('src/components/AccessibleAlert.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'AccessibleAlert parses cleanly')

  assert.match(code, /export function AccessibleAlert/, 'exports AccessibleAlert')
  assert.match(code, /role=\{computedRole\}/, 'computes accessible role')
  assert.match(code, /aria-live=\{computedLive\}/, 'computes aria-live announcement mode')
  assert.match(code, /aria-hidden="true"/, 'decorative icon marked aria-hidden')
  assert.match(code, /aria-label=\{retryLabel\}/, 'retry button has accessible aria-label')
  assert.match(code, /aria-label=\{dismissLabel\}/, 'dismiss button has accessible aria-label')
})

test('AccessibleErrorBoundary exports React error boundary with accessible fallback', () => {
  const code = readSource('src/components/AccessibleAlert.jsx')

  assert.match(code, /export class AccessibleErrorBoundary extends React\.Component/, 'exports AccessibleErrorBoundary')
  assert.match(code, /static getDerivedStateFromError/, 'implements getDerivedStateFromError')
  assert.match(code, /componentDidCatch/, 'implements componentDidCatch')
  assert.match(code, /role="alert"/, 'fallback declared with role="alert"')
  assert.match(code, /aria-live="assertive"/, 'fallback declared with aria-live="assertive"')
  assert.match(code, /handleReset/, 'provides reset handler')
})

test('PickDriver.jsx renders AccessibleAlert on driver errors', () => {
  const code = readSource('src/screens/PickDriver.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'PickDriver parses cleanly')

  assert.match(code, /import.*AccessibleAlert.*from\s+['"]\.\.\/components\/AccessibleAlert['"]/, 'imports AccessibleAlert')
  assert.match(code, /<AccessibleAlert error=\{error\}/, 'renders AccessibleAlert for error state')
})

test('Requested.jsx renders AccessibleAlert on trip status errors', () => {
  const code = readSource('src/screens/Requested.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'Requested parses cleanly')

  assert.match(code, /import.*AccessibleAlert.*from\s+['"]\.\.\/components\/AccessibleAlert['"]/, 'imports AccessibleAlert')
  assert.match(code, /<AccessibleAlert error=\{error\}/, 'renders AccessibleAlert for error state')
})

test('AuthScreens.jsx renders AccessibleAlert on authentication errors', () => {
  const code = readSource('src/screens/AuthScreens.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'AuthScreens parses cleanly')

  assert.match(code, /import.*AccessibleAlert.*from\s+['"]\.\.\/components\/AccessibleAlert['"]/, 'imports AccessibleAlert')
  const alertMatches = code.match(/<AccessibleAlert error=\{error\}/g)
  assert.ok(alertMatches && alertMatches.length >= 2, 'renders AccessibleAlert for sign-in and sign-up errors')
})
