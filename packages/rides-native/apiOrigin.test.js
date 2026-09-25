import assert from 'node:assert/strict'
import test, { after, afterEach } from 'node:test'
import * as apiOrigin from './apiOrigin.js'
import { DEFAULT_API_BASE, resolveApiBase } from './apiOrigin.js'
import { WEB_ORIGIN } from '../../shared/productLinks.js'

const ORIGINAL_EXPO_PUBLIC_API_BASE = process.env.EXPO_PUBLIC_API_BASE

afterEach(() => {
  if (ORIGINAL_EXPO_PUBLIC_API_BASE === undefined) {
    delete process.env.EXPO_PUBLIC_API_BASE
  } else {
    process.env.EXPO_PUBLIC_API_BASE = ORIGINAL_EXPO_PUBLIC_API_BASE
  }
})

after(() => {
  if (ORIGINAL_EXPO_PUBLIC_API_BASE === undefined) {
    delete process.env.EXPO_PUBLIC_API_BASE
  } else {
    process.env.EXPO_PUBLIC_API_BASE = ORIGINAL_EXPO_PUBLIC_API_BASE
  }
})

// ---------------------------------------------------------------------------
// 1. Module surface and export contracts
// ---------------------------------------------------------------------------

test('exports DEFAULT_API_BASE constant and resolveApiBase function', () => {
  assert.deepEqual(Object.keys(apiOrigin).sort(), ['DEFAULT_API_BASE', 'resolveApiBase'])
  assert.equal(typeof DEFAULT_API_BASE, 'string')
  assert.equal(typeof resolveApiBase, 'function')
  assert.equal(resolveApiBase.name, 'resolveApiBase')
  assert.equal(resolveApiBase.length, 0)
})

// ---------------------------------------------------------------------------
// 2. DEFAULT_API_BASE constant values and properties
// ---------------------------------------------------------------------------

test('DEFAULT_API_BASE matches WEB_ORIGIN and canonical production origin', () => {
  assert.equal(DEFAULT_API_BASE, WEB_ORIGIN)
  assert.equal(DEFAULT_API_BASE, 'https://clemson-rides.vercel.app')
  assert.equal(DEFAULT_API_BASE.startsWith('https://'), true)
  assert.equal(DEFAULT_API_BASE.endsWith('/'), false)
  assert.equal(DEFAULT_API_BASE.includes('clemson-airport-rides.vercel.app'), false)

  const parsed = new URL(DEFAULT_API_BASE)
  assert.equal(parsed.protocol, 'https:')
  assert.equal(parsed.hostname, 'clemson-rides.vercel.app')
  assert.equal(parsed.pathname, '/')
  assert.equal(parsed.origin, 'https://clemson-rides.vercel.app')
})

// ---------------------------------------------------------------------------
// 3. resolveApiBase happy path with no env override (defaults)
// ---------------------------------------------------------------------------

test('resolveApiBase returns DEFAULT_API_BASE when EXPO_PUBLIC_API_BASE is unset', () => {
  delete process.env.EXPO_PUBLIC_API_BASE
  assert.equal(resolveApiBase(), DEFAULT_API_BASE)
  assert.equal(resolveApiBase(), 'https://clemson-rides.vercel.app')
  assert.equal(resolveApiBase().endsWith('/'), false)

  // Multiple consecutive calls return identical idempotent result
  assert.equal(resolveApiBase(), resolveApiBase())
})

// ---------------------------------------------------------------------------
// 4. resolveApiBase with empty or falsy inputs
// ---------------------------------------------------------------------------

test('resolveApiBase falls back to DEFAULT_API_BASE when EXPO_PUBLIC_API_BASE is empty string', () => {
  process.env.EXPO_PUBLIC_API_BASE = ''
  assert.equal(resolveApiBase(), DEFAULT_API_BASE)
  assert.equal(resolveApiBase(), 'https://clemson-rides.vercel.app')
})

test('resolveApiBase handles string null, undefined, or slash with fallback', () => {
  process.env.EXPO_PUBLIC_API_BASE = 'null'
  assert.equal(resolveApiBase(), 'null')

  process.env.EXPO_PUBLIC_API_BASE = 'undefined'
  assert.equal(resolveApiBase(), 'undefined')

  // An EXPO_PUBLIC_API_BASE set to '/' has its slash stripped and falls back to DEFAULT_API_BASE
  process.env.EXPO_PUBLIC_API_BASE = '/'
  assert.equal(resolveApiBase(), DEFAULT_API_BASE)
})


// ---------------------------------------------------------------------------
// 5. resolveApiBase custom origin overrides (happy path)
// ---------------------------------------------------------------------------

test('resolveApiBase respects custom origin overrides without trailing slash', () => {
  // Remote preview and staging domains
  process.env.EXPO_PUBLIC_API_BASE = 'https://api.clemsonrides.com'
  assert.equal(resolveApiBase(), 'https://api.clemsonrides.com')

  process.env.EXPO_PUBLIC_API_BASE = 'https://clemson-rides-git-feature-preview.vercel.app'
  assert.equal(resolveApiBase(), 'https://clemson-rides-git-feature-preview.vercel.app')

  // Local development origins
  process.env.EXPO_PUBLIC_API_BASE = 'http://localhost:3000'
  assert.equal(resolveApiBase(), 'http://localhost:3000')

  process.env.EXPO_PUBLIC_API_BASE = 'http://localhost:8081'
  assert.equal(resolveApiBase(), 'http://localhost:8081')

  process.env.EXPO_PUBLIC_API_BASE = 'http://127.0.0.1:8787'
  assert.equal(resolveApiBase(), 'http://127.0.0.1:8787')

  // LAN IP address (common for Expo physical device testing)
  process.env.EXPO_PUBLIC_API_BASE = 'http://192.168.1.150:8081'
  assert.equal(resolveApiBase(), 'http://192.168.1.150:8081')
})

test('resolveApiBase strips single trailing slash from custom origin overrides', () => {
  process.env.EXPO_PUBLIC_API_BASE = 'https://api.clemsonrides.com/'
  assert.equal(resolveApiBase(), 'https://api.clemsonrides.com')

  process.env.EXPO_PUBLIC_API_BASE = 'https://staging.vercel.app/'
  assert.equal(resolveApiBase(), 'https://staging.vercel.app')

  process.env.EXPO_PUBLIC_API_BASE = 'http://localhost:3000/'
  assert.equal(resolveApiBase(), 'http://localhost:3000')

  process.env.EXPO_PUBLIC_API_BASE = 'http://127.0.0.1:8787/'
  assert.equal(resolveApiBase(), 'http://127.0.0.1:8787')

  process.env.EXPO_PUBLIC_API_BASE = 'http://192.168.1.150:8081/'
  assert.equal(resolveApiBase(), 'http://192.168.1.150:8081')
})

// ---------------------------------------------------------------------------
// 6. resolveApiBase with path prefixes and subpaths
// ---------------------------------------------------------------------------

test('resolveApiBase preserves subpath while stripping trailing slash', () => {
  process.env.EXPO_PUBLIC_API_BASE = 'https://clemson-rides.vercel.app/api'
  assert.equal(resolveApiBase(), 'https://clemson-rides.vercel.app/api')

  process.env.EXPO_PUBLIC_API_BASE = 'https://clemson-rides.vercel.app/api/'
  assert.equal(resolveApiBase(), 'https://clemson-rides.vercel.app/api')

  process.env.EXPO_PUBLIC_API_BASE = 'https://example.com/v1/subpath/'
  assert.equal(resolveApiBase(), 'https://example.com/v1/subpath')
})

// ---------------------------------------------------------------------------
// 7. Edge cases, quirks, and suspected bugs
// ---------------------------------------------------------------------------

test('resolveApiBase strips all trailing slashes from custom origin overrides', () => {
  // Strips multiple trailing slashes cleanly
  process.env.EXPO_PUBLIC_API_BASE = 'https://api.example.com//'
  assert.equal(resolveApiBase(), 'https://api.example.com')

  process.env.EXPO_PUBLIC_API_BASE = 'https://api.example.com///'
  assert.equal(resolveApiBase(), 'https://api.example.com')
})

test('resolveApiBase trims whitespace and falls back to DEFAULT_API_BASE when blank', () => {
  // Whitespace-only EXPO_PUBLIC_API_BASE falls back to DEFAULT_API_BASE
  process.env.EXPO_PUBLIC_API_BASE = '   '
  assert.equal(resolveApiBase(), DEFAULT_API_BASE)

  process.env.EXPO_PUBLIC_API_BASE = '\t\n'
  assert.equal(resolveApiBase(), DEFAULT_API_BASE)

  // Leading and trailing whitespace is trimmed
  process.env.EXPO_PUBLIC_API_BASE = '  https://clemson-rides.vercel.app  '
  assert.equal(resolveApiBase(), 'https://clemson-rides.vercel.app')

  // Trailing slash followed by whitespace is properly stripped
  process.env.EXPO_PUBLIC_API_BASE = 'https://clemson-rides.vercel.app/ '
  assert.equal(resolveApiBase(), 'https://clemson-rides.vercel.app')
})

test('resolveApiBase handles whitespace combined with multiple trailing slashes', () => {
  process.env.EXPO_PUBLIC_API_BASE = '   https://api.example.com///   '
  assert.equal(resolveApiBase(), 'https://api.example.com')

  // When only slashes and whitespace are provided, it strips to empty and falls back to DEFAULT_API_BASE
  process.env.EXPO_PUBLIC_API_BASE = '   ///   '
  assert.equal(resolveApiBase(), DEFAULT_API_BASE)

  process.env.EXPO_PUBLIC_API_BASE = '\t\n//\n\t'
  assert.equal(resolveApiBase(), DEFAULT_API_BASE)
})

test('resolveApiBase returns non-URL strings directly without validation', () => {
  // BUG?: Non-URL strings like 'invalid-origin' or 'not_a_url' are returned as-is without protocol or host validation.
  process.env.EXPO_PUBLIC_API_BASE = 'not-a-valid-origin'
  assert.equal(resolveApiBase(), 'not-a-valid-origin')

  process.env.EXPO_PUBLIC_API_BASE = 'custom-host/api/'
  assert.equal(resolveApiBase(), 'custom-host/api')
})

test('resolveApiBase with bare scheme strips slashes leaving malformed scheme prefix', () => {
  // BUG?: When EXPO_PUBLIC_API_BASE is set to a bare scheme like 'http://' or 'https://',
  // replace(/\/+$/, '') strips the trailing slashes leaving 'http:' or 'https:', which results
  // in invalid concatenated paths like 'https:/api/ping'.
  process.env.EXPO_PUBLIC_API_BASE = 'https://'
  assert.equal(resolveApiBase(), 'https:')

  process.env.EXPO_PUBLIC_API_BASE = 'http://'
  assert.equal(resolveApiBase(), 'http:')
})

test('resolveApiBase preserves protocol-relative URLs without normalization', () => {
  // BUG?: Protocol-relative URLs (e.g. '//api.example.com') are returned without scheme,
  // which will fail in React Native fetch environments that require an explicit scheme.
  process.env.EXPO_PUBLIC_API_BASE = '//api.example.com'
  assert.equal(resolveApiBase(), '//api.example.com')

  process.env.EXPO_PUBLIC_API_BASE = '//api.example.com/'
  assert.equal(resolveApiBase(), '//api.example.com')
})

test('resolveApiBase preserves query parameters and fragments in base URL', () => {
  // BUG?: If EXPO_PUBLIC_API_BASE contains query params or hash fragments,
  // string concatenation `${resolveApiBase()}/endpoint` appends path after query/fragment
  // (e.g. 'https://api.example.com?env=dev/endpoint').
  process.env.EXPO_PUBLIC_API_BASE = 'https://api.example.com?env=dev'
  assert.equal(resolveApiBase(), 'https://api.example.com?env=dev')

  process.env.EXPO_PUBLIC_API_BASE = 'https://api.example.com#debug'
  assert.equal(resolveApiBase(), 'https://api.example.com#debug')
})

test('resolveApiBase does not restrict scheme to http or https', () => {
  // BUG?: Arbitrary non-http schemes (e.g. 'ftp://', 'javascript:void(0)')
  // are accepted without error or protocol verification.
  process.env.EXPO_PUBLIC_API_BASE = 'ftp://ftp.clemsonrides.com'
  assert.equal(resolveApiBase(), 'ftp://ftp.clemsonrides.com')
})

test('resolveApiBase handles custom ports and IPv6 addresses', () => {
  process.env.EXPO_PUBLIC_API_BASE = 'http://localhost:8080/'
  assert.equal(resolveApiBase(), 'http://localhost:8080')

  process.env.EXPO_PUBLIC_API_BASE = 'http://[::1]:3000/'
  assert.equal(resolveApiBase(), 'http://[::1]:3000')
})

// ---------------------------------------------------------------------------
// 8. Call site URL composition compatibility
// ---------------------------------------------------------------------------

test('URL concatenation produces clean endpoint URLs across default and overridden bases', () => {
  const endpoint = '/api/create-checkout-session'

  // Default origin
  delete process.env.EXPO_PUBLIC_API_BASE
  assert.equal(
    `${resolveApiBase()}${endpoint}`,
    'https://clemson-rides.vercel.app/api/create-checkout-session',
  )

  // Custom origin without slash
  process.env.EXPO_PUBLIC_API_BASE = 'https://custom-api.example.com'
  assert.equal(
    `${resolveApiBase()}${endpoint}`,
    'https://custom-api.example.com/api/create-checkout-session',
  )

  // Custom origin with trailing slash
  process.env.EXPO_PUBLIC_API_BASE = 'https://custom-api.example.com/'
  assert.equal(
    `${resolveApiBase()}${endpoint}`,
    'https://custom-api.example.com/api/create-checkout-session',
  )
})

test('resolveApiBase ignores extraneous arguments', () => {
  delete process.env.EXPO_PUBLIC_API_BASE
  assert.equal(resolveApiBase('ignored', 42, { extra: true }), DEFAULT_API_BASE)
})
