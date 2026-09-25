import assert from 'node:assert/strict'
import test from 'node:test'
import * as authUrlModule from './authUrl.js'
import { parseSupabaseAuthUrl } from './authUrl.js'

test('authUrl module exports expected helpers', () => {
  assert.deepEqual(Object.keys(authUrlModule).sort(), ['parseSupabaseAuthUrl'])
  assert.equal(typeof parseSupabaseAuthUrl, 'function')
})

test('password recovery deep links keep the Supabase session tokens', () => {
  const parsed = parseSupabaseAuthUrl(
    'clemsonrides://reset-password#access_token=aaa&refresh_token=bbb&type=recovery',
  )
  assert.deepEqual(parsed, {
    kind: 'session',
    accessToken: 'aaa',
    refreshToken: 'bbb',
    type: 'recovery',
  })
})

test('PKCE recovery links keep the code', () => {
  const parsed = parseSupabaseAuthUrl('clemsonrides://reset-password?code=pkce-code&type=recovery')
  assert.equal(parsed.kind, 'code')
  assert.equal(parsed.code, 'pkce-code')
  assert.equal(parsed.type, 'recovery')
})

test('app-scheme deep links: rider scheme session and PKCE flows', () => {
  // Rider session without type
  assert.deepEqual(
    parseSupabaseAuthUrl('clemsonrides://auth/callback#access_token=tok_at1&refresh_token=tok_rt1'),
    {
      kind: 'session',
      accessToken: 'tok_at1',
      refreshToken: 'tok_rt1',
      type: null,
    },
  )

  // Rider session with signup type
  assert.deepEqual(
    parseSupabaseAuthUrl('clemsonrides://auth/callback#access_token=tok_at2&refresh_token=tok_rt2&type=signup'),
    {
      kind: 'session',
      accessToken: 'tok_at2',
      refreshToken: 'tok_rt2',
      type: 'signup',
    },
  )

  // Rider PKCE without type
  assert.deepEqual(
    parseSupabaseAuthUrl('clemsonrides://auth/callback?code=rider_pkce_123'),
    {
      kind: 'code',
      code: 'rider_pkce_123',
      type: null,
    },
  )
})

test('app-scheme deep links: driver scheme session and PKCE flows', () => {
  // Driver session without type
  assert.deepEqual(
    parseSupabaseAuthUrl('clemsonrides-driver://auth/callback#access_token=drv_at1&refresh_token=drv_rt1'),
    {
      kind: 'session',
      accessToken: 'drv_at1',
      refreshToken: 'drv_rt1',
      type: null,
    },
  )

  // Driver password recovery session
  assert.deepEqual(
    parseSupabaseAuthUrl('clemsonrides-driver://set-password#access_token=drv_at2&refresh_token=drv_rt2&type=recovery'),
    {
      kind: 'session',
      accessToken: 'drv_at2',
      refreshToken: 'drv_rt2',
      type: 'recovery',
    },
  )

  // Driver PKCE callback without type
  assert.deepEqual(
    parseSupabaseAuthUrl('clemsonrides-driver://auth/callback?code=drv_code_456'),
    {
      kind: 'code',
      code: 'drv_code_456',
      type: null,
    },
  )

  // Driver PKCE password reset with recovery type
  assert.deepEqual(
    parseSupabaseAuthUrl('clemsonrides-driver://set-password?code=drv_code_789&type=recovery'),
    {
      kind: 'code',
      code: 'drv_code_789',
      type: 'recovery',
    },
  )
})

test('app-scheme deep links: Expo development URLs', () => {
  assert.deepEqual(
    parseSupabaseAuthUrl('exp://127.0.0.1:8081/--/auth/callback#access_token=exp_at&refresh_token=exp_rt&type=signup'),
    {
      kind: 'session',
      accessToken: 'exp_at',
      refreshToken: 'exp_rt',
      type: 'signup',
    },
  )

  assert.deepEqual(
    parseSupabaseAuthUrl('exp://127.0.0.1:8081/--/auth/callback?code=exp_pkce'),
    {
      kind: 'code',
      code: 'exp_pkce',
      type: null,
    },
  )
})

test('clemson-rides.vercel.app and web URLs: session tokens in hash fragment', () => {
  assert.deepEqual(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback#access_token=w_at1&refresh_token=w_rt1&type=magiclink'),
    {
      kind: 'session',
      accessToken: 'w_at1',
      refreshToken: 'w_rt1',
      type: 'magiclink',
    },
  )

  assert.deepEqual(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/set-password#access_token=w_at2&refresh_token=w_rt2&type=recovery'),
    {
      kind: 'session',
      accessToken: 'w_at2',
      refreshToken: 'w_rt2',
      type: 'recovery',
    },
  )

  // Legacy origin compatibility
  assert.deepEqual(
    parseSupabaseAuthUrl('https://clemson-airport-rides.vercel.app/auth/callback#access_token=leg_at&refresh_token=leg_rt'),
    {
      kind: 'session',
      accessToken: 'leg_at',
      refreshToken: 'leg_rt',
      type: null,
    },
  )
})

test('clemson-rides.vercel.app and web URLs: session tokens in query string', () => {
  assert.deepEqual(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback?access_token=wq_at&refresh_token=wq_rt&type=invite'),
    {
      kind: 'session',
      accessToken: 'wq_at',
      refreshToken: 'wq_rt',
      type: 'invite',
    },
  )

  assert.deepEqual(
    parseSupabaseAuthUrl('clemsonrides://set-password?access_token=q_at&refresh_token=q_rt'),
    {
      kind: 'session',
      accessToken: 'q_at',
      refreshToken: 'q_rt',
      type: null,
    },
  )
})

test('clemson-rides.vercel.app and web URLs: PKCE code in query or hash', () => {
  assert.deepEqual(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback?code=web_pkce_q&type=signup'),
    {
      kind: 'code',
      code: 'web_pkce_q',
      type: 'signup',
    },
  )

  assert.deepEqual(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback#code=web_pkce_h'),
    {
      kind: 'code',
      code: 'web_pkce_h',
      type: null,
    },
  )
})

test('partial or fragment-only URL strings', () => {
  // Hash fragment only
  assert.deepEqual(
    parseSupabaseAuthUrl('#access_token=hash_at&refresh_token=hash_rt&type=recovery'),
    {
      kind: 'session',
      accessToken: 'hash_at',
      refreshToken: 'hash_rt',
      type: 'recovery',
    },
  )

  // Query string only
  assert.deepEqual(
    parseSupabaseAuthUrl('?code=query_code&type=recovery'),
    {
      kind: 'code',
      code: 'query_code',
      type: 'recovery',
    },
  )

  // BUG?: Bare key-value strings lacking '?' or '#' return null because parseSupabaseAuthUrl checks indexOf('?') and indexOf('#')
  assert.equal(
    parseSupabaseAuthUrl('access_token=bare_at&refresh_token=bare_rt'),
    null,
  )
})

test('precedence: session tokens take precedence over PKCE code', () => {
  // When both session tokens and code are present in URL, session is preferred
  assert.deepEqual(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback#access_token=s_at&refresh_token=s_rt&code=ignored_code'),
    {
      kind: 'session',
      accessToken: 's_at',
      refreshToken: 's_rt',
      type: null,
    },
  )
})

test('precedence: hash fragment parameters take precedence over query parameters', () => {
  // Hash tokens override query tokens
  assert.deepEqual(
    parseSupabaseAuthUrl(
      'https://clemson-rides.vercel.app/auth/callback?access_token=q_at&refresh_token=q_rt#access_token=h_at&refresh_token=h_rt',
    ),
    {
      kind: 'session',
      accessToken: 'h_at',
      refreshToken: 'h_rt',
      type: null,
    },
  )

  // Hash code overrides query code
  assert.deepEqual(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback?code=q_code#code=h_code'),
    {
      kind: 'code',
      code: 'h_code',
      type: null,
    },
  )

  // Hash type overrides query type
  assert.deepEqual(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback?code=c1&type=q_type#type=h_type'),
    {
      kind: 'code',
      code: 'c1',
      type: 'h_type',
    },
  )

  // BUG?: Tokens are picked independently from hash then query, which combines tokens split across query and hash fragments
  assert.deepEqual(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback?refresh_token=split_rt#access_token=split_at'),
    {
      kind: 'session',
      accessToken: 'split_at',
      refreshToken: 'split_rt',
      type: null,
    },
  )
})

test('empty, null, undefined, and non-string inputs return null', () => {
  assert.equal(parseSupabaseAuthUrl(null), null)
  assert.equal(parseSupabaseAuthUrl(undefined), null)
  assert.equal(parseSupabaseAuthUrl(), null)
  assert.equal(parseSupabaseAuthUrl(''), null)
  assert.equal(parseSupabaseAuthUrl(0), null)
  assert.equal(parseSupabaseAuthUrl(123), null)
  assert.equal(parseSupabaseAuthUrl(-1), null)
  assert.equal(parseSupabaseAuthUrl(true), null)
  assert.equal(parseSupabaseAuthUrl(false), null)
  assert.equal(parseSupabaseAuthUrl({}), null)
  assert.equal(parseSupabaseAuthUrl({ url: 'clemsonrides://reset-password#access_token=a&refresh_token=b' }), null)
  assert.equal(parseSupabaseAuthUrl([]), null)
  assert.equal(parseSupabaseAuthUrl(['clemsonrides://reset-password']), null)
  assert.equal(parseSupabaseAuthUrl(() => {}), null)
  assert.equal(parseSupabaseAuthUrl(Symbol('url')), null)
})

test('URLs missing auth tokens or codes return null', () => {
  // Bare URLs with no parameters
  assert.equal(parseSupabaseAuthUrl('https://clemson-rides.vercel.app'), null)
  assert.equal(parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback'), null)
  assert.equal(parseSupabaseAuthUrl('clemsonrides://reset-password'), null)
  assert.equal(parseSupabaseAuthUrl('clemsonrides-driver://set-password'), null)

  // Unrelated parameters
  assert.equal(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback?utm_source=email&redirect_to=/home'),
    null,
  )
  assert.equal(
    parseSupabaseAuthUrl('clemsonrides://auth/callback#section=overview&theme=dark'),
    null,
  )

  // BUG?: When only access_token is present without refresh_token, parseSupabaseAuthUrl returns null rather than a partial session
  assert.equal(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback#access_token=only_at'),
    null,
  )

  // Only refresh_token without access_token
  assert.equal(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback#refresh_token=only_rt'),
    null,
  )

  // Empty string token values evaluate to falsy and return null
  assert.equal(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback#access_token=&refresh_token='),
    null,
  )
  assert.equal(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback#access_token=at&refresh_token='),
    null,
  )
  assert.equal(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback?code='),
    null,
  )
})

test('error branches and error redirect parameters', () => {
  // BUG?: parseSupabaseAuthUrl returns null on error redirects without extracting error or error_description, forcing consumers (e.g. googleAuth.js) to re-parse raw URLs
  assert.equal(
    parseSupabaseAuthUrl(
      'https://clemson-rides.vercel.app/auth/callback?error=access_denied&error_code=403&error_description=User+cancelled+the+sign-in+flow',
    ),
    null,
  )

  assert.equal(
    parseSupabaseAuthUrl(
      'clemsonrides://auth/callback#error=unauthorized_client&error_description=Invalid+redirect+URI',
    ),
    null,
  )

  // BUG?: parseSupabaseAuthUrl does not check for error parameters, so a URL with both error and code still returns the code instead of null or an error descriptor
  assert.deepEqual(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/auth/callback?error=server_error&code=pkce_with_error'),
    {
      kind: 'code',
      code: 'pkce_with_error',
      type: null,
    },
  )
})

test('URL structural quirks and encoding behaviors', () => {
  // BUG?: When '#' appears before '?' in the URL (such as hash routing '#/route?code=xyz'), url.slice(queryIndex + 1, hashIndex) produces an empty string because queryIndex > hashIndex, and URLSearchParams fails to extract parameters from the hash path, causing parseSupabaseAuthUrl to return null
  assert.equal(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/#/auth/callback?code=pkce_spa'),
    null,
  )
  assert.equal(
    parseSupabaseAuthUrl('https://clemson-rides.vercel.app/#/set-password?access_token=spa_at&refresh_token=spa_rt'),
    null,
  )

  // Percent-encoded characters in tokens are properly decoded by URLSearchParams
  assert.deepEqual(
    parseSupabaseAuthUrl('clemsonrides://auth/callback#access_token=tok%2Fencoded%2Bval&refresh_token=ref%2Ftoken'),
    {
      kind: 'session',
      accessToken: 'tok/encoded+val',
      refreshToken: 'ref/token',
      type: null,
    },
  )

  // BUG?: URLSearchParams treats unencoded '+' characters as spaces in hash fragments, which can mutate base64-encoded tokens that contain '+' into spaces
  assert.deepEqual(
    parseSupabaseAuthUrl('clemsonrides://auth/callback#access_token=tok+with+plus&refresh_token=ref+with+plus'),
    {
      kind: 'session',
      accessToken: 'tok with plus',
      refreshToken: 'ref with plus',
      type: null,
    },
  )

  // BUG?: parseSupabaseAuthUrl does not trim input URLs or parameter values, preserving trailing whitespace in extracted tokens or codes
  assert.deepEqual(
    parseSupabaseAuthUrl('clemsonrides://auth/callback?code=code_with_spaces  '),
    {
      kind: 'code',
      code: 'code_with_spaces  ',
      type: null,
    },
  )
})
