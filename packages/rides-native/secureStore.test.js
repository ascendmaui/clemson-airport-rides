import assert from 'node:assert/strict'
import test, { beforeEach, describe } from 'node:test'
import { registerHooks } from 'node:module'
import { SECURE_CHUNK } from './secureChunks.js'

// Stand-in for expo-secure-store. Keys match the real charset. Values are
// capped at 2048 UTF-8 bytes, the limit secureChunks.js chunks under.
// AFTER_FIRST_UNLOCK is a numeric keychain constant in the real package.
const VALUE_BYTES_LIMIT = 2048
const AFTER_FIRST_UNLOCK = 1
const INVALID_KEY = /Invalid key/

function utf8Bytes(value) {
  return Buffer.byteLength(value, 'utf8')
}

function createFakeSecureStore() {
  const store = {
    data: new Map(),
    calls: [],
    getError: null,
    setError: null,
    deleteError: null,
    throwOnSetKey: null,
    reset() {
      this.data.clear()
      this.calls.length = 0
      this.getError = null
      this.setError = null
      this.deleteError = null
      this.throwOnSetKey = null
    },
    async getItemAsync(key) {
      this.calls.push({ op: 'get', key, argc: arguments.length })
      if (this.getError) throw this.getError
      assertValidKey(key)
      return this.data.has(key) ? this.data.get(key) : null
    },
    async setItemAsync(key, value, options) {
      this.calls.push({ op: 'set', key, value, options, argc: arguments.length })
      if (this.setError) throw this.setError
      if (this.throwOnSetKey?.(key)) throw new Error(`set failed for ${key}`)
      assertValidKey(key)
      if (typeof value !== 'string') {
        throw new Error('Invalid value provided to SecureStore. Values must be strings.')
      }
      if (utf8Bytes(value) > VALUE_BYTES_LIMIT) {
        throw new Error('Value exceeds 2048 byte SecureStore limit')
      }
      this.data.set(key, value)
    },
    async deleteItemAsync(key) {
      this.calls.push({ op: 'del', key, argc: arguments.length })
      if (this.deleteError) throw this.deleteError
      assertValidKey(key)
      if (!this.data.has(key)) throw new Error(`Could not find key ${key}`)
      this.data.delete(key)
    },
  }
  return store
}

function assertValidKey(key) {
  if (typeof key !== 'string' || !/^[\w.-]+$/.test(key)) {
    throw new Error(
      'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".',
    )
  }
}

const fakes = {
  ios: createFakeSecureStore(),
  android: createFakeSecureStore(),
  web: createFakeSecureStore(),
}
globalThis.__ridesNativeSecureStoreFakes = fakes

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL ?? ''
    if (!parent.includes('/packages/rides-native/secureStore.js')) {
      return nextResolve(specifier, context)
    }
    const os = new URL(parent).searchParams.get('os') ?? 'web'
    if (specifier === 'react-native') {
      const source = `export const Platform = { OS: ${JSON.stringify(os)} };\n`
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    }
    if (specifier === 'expo-secure-store') {
      const source = `
        const bag = globalThis.__ridesNativeSecureStoreFakes[${JSON.stringify(os)}];
        export const AFTER_FIRST_UNLOCK = ${AFTER_FIRST_UNLOCK};
        export function getItemAsync(key) { return bag.getItemAsync(key); }
        export function setItemAsync(key, value, options) { return bag.setItemAsync(key, value, options); }
        export function deleteItemAsync(key) { return bag.deleteItemAsync(key); }
      `
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const iosMod = await import('./secureStore.js?os=ios')
const androidMod = await import('./secureStore.js?os=android')
const webMod = await import('./secureStore.js?os=web')
const ios = iosMod.secureStoreAdapter
const android = androidMod.secureStoreAdapter
const web = webMod.secureStoreAdapter

function sets(fake) {
  return fake.calls.filter((call) => call.op === 'set')
}

function supabaseSession() {
  return JSON.stringify({
    access_token: 'a'.repeat(2400),
    refresh_token: 'b'.repeat(2400),
    user: { id: 'user-1', email: 'tiger@clemson.edu' },
  })
}

describe('secureStoreAdapter', { concurrency: 1 }, () => {
  beforeEach(() => {
    fakes.ios.reset()
    fakes.android.reset()
    fakes.web.reset()
  })

  test('exports only the chunked get/set/remove adapter', () => {
    assert.deepEqual(Object.keys(iosMod).sort(), ['secureStoreAdapter'])
    assert.deepEqual(Object.keys(androidMod).sort(), ['secureStoreAdapter'])
    assert.deepEqual(Object.keys(webMod).sort(), ['secureStoreAdapter'])
    for (const adapter of [ios, android, web]) {
      assert.equal(typeof adapter.getItem, 'function')
      assert.equal(typeof adapter.setItem, 'function')
      assert.equal(typeof adapter.removeItem, 'function')
    }
    assert.notEqual(ios, android)
    assert.notEqual(ios, web)
    assert.notEqual(android, web)
  })

  test('ios stores a short session under one key after first unlock', async () => {
    const pending = ios.getItem('missing-session')
    assert.equal(typeof pending.then, 'function')
    assert.equal(await pending, null)

    await ios.setItem('sb-session', 'short-token')
    assert.equal(await ios.getItem('sb-session'), 'short-token')
    assert.deepEqual(sets(fakes.ios), [{
      op: 'set',
      key: 'sb-session',
      value: 'short-token',
      options: { keychainAccessible: AFTER_FIRST_UNLOCK },
      argc: 3,
    }])
    for (const call of fakes.ios.calls) {
      if (call.op !== 'set') assert.equal(call.argc, 1)
    }
    assert.equal(fakes.android.calls.length, 0)
    assert.equal(fakes.web.calls.length, 0)

    await ios.removeItem('sb-session')
    assert.equal(await ios.getItem('sb-session'), null)
    assert.equal(fakes.ios.data.size, 0)

    await ios.removeItem('sb-session')
    assert.equal(await ios.getItem('missing-session'), null)
  })

  test('android uses its own keychain entry and the same accessibility constant', async () => {
    await ios.setItem('sb-session', 'ios-token')
    await android.setItem('sb-session', 'android-token')
    assert.equal(await android.getItem('sb-session'), 'android-token')
    assert.equal(await ios.getItem('sb-session'), 'ios-token')
    assert.equal(fakes.android.data.get('sb-session'), 'android-token')
    assert.deepEqual(sets(fakes.android)[0].options, { keychainAccessible: AFTER_FIRST_UNLOCK })
    assert.equal(sets(fakes.android)[0].argc, 3)
    await android.removeItem('sb-session')
    assert.equal(await android.getItem('sb-session'), null)
    assert.equal(await ios.getItem('sb-session'), 'ios-token')
  })

  test('web keeps values in memory and does not call SecureStore', async () => {
    assert.equal(await web.getItem('signup-cooldown'), null)
    await web.setItem('signup-cooldown', '2026-09-25T00:00:00.000Z')
    assert.equal(await web.getItem('signup-cooldown'), '2026-09-25T00:00:00.000Z')
    assert.equal(fakes.web.calls.length, 0)
    assert.equal(fakes.ios.calls.length, 0)
    assert.equal(await ios.getItem('signup-cooldown'), null)

    await web.removeItem('signup-cooldown')
    assert.equal(await web.getItem('signup-cooldown'), null)
    await web.removeItem('signup-cooldown')
    assert.equal(fakes.web.calls.length, 0)
  })

  test('empty and whitespace values round-trip on native and web', async () => {
    await ios.setItem('empty-native', '')
    assert.equal(await ios.getItem('empty-native'), '')
    assert.equal(fakes.ios.data.get('empty-native'), '')
    await ios.setItem('space-native', '   ')
    assert.equal(await ios.getItem('space-native'), '   ')

    await web.setItem('empty-web', '')
    assert.equal(await web.getItem('empty-web'), '')
    await web.setItem('space-web', ' \n\t ')
    assert.equal(await web.getItem('space-web'), ' \n\t ')
    assert.equal(fakes.web.calls.length, 0)
  })

  test('a value at the chunk boundary stays whole, and one past it splits', async () => {
    const exact = 'e'.repeat(SECURE_CHUNK)
    await ios.setItem('boundary', exact)
    assert.equal(await ios.getItem('boundary'), exact)
    assert.equal(fakes.ios.data.get('boundary'), exact)
    assert.equal(fakes.ios.data.has('boundary.n'), false)
    for (const [, value] of fakes.ios.data) {
      assert.ok(utf8Bytes(value) <= VALUE_BYTES_LIMIT)
    }

    const split = 's'.repeat(SECURE_CHUNK + 1)
    await ios.setItem('boundary', split)
    assert.equal(await ios.getItem('boundary'), split)
    assert.equal(fakes.ios.data.has('boundary'), false)
    assert.equal(fakes.ios.data.get('boundary.n'), '2')
    assert.equal(fakes.ios.data.get('boundary.0'), 's'.repeat(SECURE_CHUNK))
    assert.equal(fakes.ios.data.get('boundary.1'), 's')
    for (const call of sets(fakes.ios)) {
      assert.deepEqual(call.options, { keychainAccessible: AFTER_FIRST_UNLOCK })
      assert.ok(utf8Bytes(call.value) <= VALUE_BYTES_LIMIT)
    }

    await ios.removeItem('boundary')
    assert.equal(await ios.getItem('boundary'), null)
    assert.equal(fakes.ios.data.size, 0)
  })

  test('a Supabase-sized session round-trips on ios and in web memory', async () => {
    const session = supabaseSession()
    assert.ok(session.length > SECURE_CHUNK)
    assert.ok(utf8Bytes(session) > VALUE_BYTES_LIMIT)

    await ios.setItem('sb-auth-token', session)
    assert.equal(await ios.getItem('sb-auth-token'), session)
    assert.equal(fakes.ios.data.has('sb-auth-token'), false)
    const count = Number(fakes.ios.data.get('sb-auth-token.n'))
    assert.equal(count, Math.ceil(session.length / SECURE_CHUNK))
    let joined = ''
    for (let i = 0; i < count; i += 1) {
      const part = fakes.ios.data.get(`sb-auth-token.${i}`)
      assert.equal(typeof part, 'string')
      assert.ok(part.length <= SECURE_CHUNK)
      assert.ok(utf8Bytes(part) <= VALUE_BYTES_LIMIT)
      joined += part
    }
    assert.equal(joined, session)
    await ios.removeItem('sb-auth-token')
    assert.equal(fakes.ios.data.size, 0)

    await web.setItem('sb-auth-token', session)
    assert.equal(await web.getItem('sb-auth-token'), session)
    assert.equal(fakes.web.calls.length, 0)
    await web.setItem('sb-auth-token', 'short-again')
    assert.equal(await web.getItem('sb-auth-token'), 'short-again')
    await web.removeItem('sb-auth-token')
    assert.equal(await web.getItem('sb-auth-token'), null)
  })

  test('nullish and non-string values are stringified', async () => {
    // BUG?: setItem coerces with String() before writing. null, undefined,
    // false, 0, and a symbol are stored as "null", "undefined", "false", "0",
    // and "Symbol(token)" instead of being rejected or removed.
    await ios.setItem('coerced', null)
    assert.equal(await ios.getItem('coerced'), 'null')
    assert.equal(fakes.ios.data.get('coerced'), 'null')
    await ios.setItem('coerced', undefined)
    assert.equal(await ios.getItem('coerced'), 'undefined')
    await ios.setItem('coerced', false)
    assert.equal(await ios.getItem('coerced'), 'false')
    await ios.setItem('coerced', 0)
    assert.equal(await ios.getItem('coerced'), '0')
    await ios.setItem('coerced', Symbol('token'))
    assert.equal(await ios.getItem('coerced'), 'Symbol(token)')

    await web.setItem('coerced-web', null)
    assert.equal(await web.getItem('coerced-web'), 'null')
    await web.setItem('coerced-web', undefined)
    assert.equal(await web.getItem('coerced-web'), 'undefined')
    await web.setItem('coerced-web', Symbol('token'))
    assert.equal(await web.getItem('coerced-web'), 'Symbol(token)')
    assert.equal(fakes.web.calls.length, 0)
  })

  test('a failed write rejects and the previous value is already gone', async () => {
    await ios.setItem('sb-session', 'previous-token')
    fakes.ios.setError = new Error('disk full')
    await assert.rejects(() => ios.setItem('sb-session', 'next-token'), (err) => {
      assert.equal(err.message, 'disk full')
      return true
    })
    fakes.ios.setError = null
    // BUG?: setItem deletes the current value before the new write. A rejected
    // setItemAsync leaves the key empty, so a keychain write failure logs the user out.
    assert.equal(await ios.getItem('sb-session'), null)
    assert.equal(fakes.ios.data.has('sb-session'), false)

    const explosive = {
      toString() {
        throw new TypeError('refusing to stringify')
      },
    }
    await ios.setItem('sb-session', 'previous-token')
    // BUG?: String(value) runs only after removeItem. A value whose toString throws
    // clears the stored session, then setItem rejects.
    await assert.rejects(() => ios.setItem('sb-session', explosive), /refusing to stringify/)
    assert.equal(await ios.getItem('sb-session'), null)

    await web.setItem('web-explosive', 'kept-until-throw')
    await assert.rejects(() => web.setItem('web-explosive', explosive), /refusing to stringify/)
    assert.equal(await web.getItem('web-explosive'), null)
    assert.equal(fakes.web.calls.length, 0)
  })

  test('a failure halfway through the chunks drops the old session and leaves orphans', async () => {
    await ios.setItem('sb-session', 'previous-token')
    const big = 'b'.repeat(SECURE_CHUNK * 2 + 10)
    fakes.ios.throwOnSetKey = (key) => key === 'sb-session.1'
    await assert.rejects(() => ios.setItem('sb-session', big), /set failed for sb-session\.1/)
    fakes.ios.throwOnSetKey = null
    // BUG?: the base key is removed before chunk writes. If a later chunk throws,
    // `.n` is never written, getItem returns null, and `key.0` is left behind.
    assert.equal(await ios.getItem('sb-session'), null)
    assert.equal(fakes.ios.data.has('sb-session'), false)
    assert.equal(fakes.ios.data.has('sb-session.n'), false)
    assert.equal(fakes.ios.data.get('sb-session.0'), 'b'.repeat(SECURE_CHUNK))
  })

  test('a missing key deletes quietly and a real delete error rejects', async () => {
    await ios.removeItem('already-gone')
    assert.equal(fakes.ios.data.size, 0)

    fakes.ios.deleteError = new Error('The specified item could not be found in the keychain.')
    await ios.removeItem('also-gone')
    fakes.ios.deleteError = null
    assert.equal(fakes.ios.data.size, 0)

    const session = supabaseSession()
    await ios.setItem('sb-session', session)
    fakes.ios.deleteError = new Error('keychain locked')
    await assert.rejects(() => ios.removeItem('sb-session'), /keychain locked/)
    fakes.ios.deleteError = null
    assert.equal(await ios.getItem('sb-session'), session)

    fakes.ios.deleteError = new Error('Could not delete the item from SecureStore')
    await assert.rejects(() => ios.removeItem('sb-session'), /Could not delete the item from SecureStore/)
    fakes.ios.deleteError = null
    assert.equal(await ios.getItem('sb-session'), session)

    fakes.ios.getError = new Error('keychain unavailable')
    await assert.rejects(() => ios.getItem('sb-session'), /keychain unavailable/)
    await assert.rejects(() => ios.removeItem('sb-session'), /keychain unavailable/)
    await assert.rejects(() => ios.setItem('sb-session', 'replacement'), /keychain unavailable/)
    fakes.ios.getError = null
    assert.equal(await ios.getItem('sb-session'), session)

    await ios.removeItem('sb-session')
    assert.equal(await ios.getItem('sb-session'), null)
    assert.equal(fakes.ios.data.size, 0)
  })

  test('invalid keys fail on native, including an empty key', async () => {
    await assert.rejects(() => ios.setItem('bad key', 'x'), INVALID_KEY)
    await assert.rejects(() => ios.getItem('bad key'), INVALID_KEY)
    await assert.rejects(() => ios.removeItem('bad key'), INVALID_KEY)
    await assert.rejects(() => ios.setItem('', 'x'), INVALID_KEY)
    await assert.rejects(() => ios.getItem(''), INVALID_KEY)
    // `.n` is a legal key, so the chunk probe succeeds and delete('') itself rejects.
    await assert.rejects(() => ios.removeItem(''), INVALID_KEY)
    await assert.rejects(() => ios.setItem(null, 'x'), INVALID_KEY)
    await assert.rejects(() => ios.getItem(null), INVALID_KEY)
    await assert.rejects(() => ios.removeItem(null), INVALID_KEY)
    await assert.rejects(() => ios.setItem(undefined, 'x'), INVALID_KEY)
    await assert.rejects(() => ios.getItem(undefined), INVALID_KEY)
    await assert.rejects(() => ios.removeItem(undefined), INVALID_KEY)
    assert.equal(fakes.ios.data.size, 0)
  })

  test('web memory accepts null, undefined, and empty keys', async () => {
    // BUG?: the same keys native SecureStore rejects are stored on the web memory backend.
    try {
      await web.setItem(null, 'null-key')
      assert.equal(await web.getItem(null), 'null-key')
      await web.setItem(undefined, 'undefined-key')
      assert.equal(await web.getItem(undefined), 'undefined-key')
      await web.setItem('', 'empty-key')
      assert.equal(await web.getItem(''), 'empty-key')
      assert.equal(fakes.web.calls.length, 0)
    } finally {
      await web.removeItem(null)
      await web.removeItem(undefined)
      await web.removeItem('')
    }
    assert.equal(await web.getItem(null), null)
    assert.equal(await web.getItem(undefined), null)
    assert.equal(await web.getItem(''), null)
  })

  test('a bad chunk count hides the base value, and a missing part returns null', async () => {
    for (const count of ['0', '-3', 'Infinity', 'nope', '   ']) {
      fakes.ios.reset()
      fakes.ios.data.set('sb-session', 'still-here')
      fakes.ios.data.set('sb-session.n', count)
      assert.equal(await ios.getItem('sb-session'), null, count)
    }

    fakes.ios.reset()
    fakes.ios.data.set('sb-session.n', '')
    fakes.ios.data.set('sb-session', 'base-value')
    assert.equal(await ios.getItem('sb-session'), 'base-value')

    fakes.ios.reset()
    fakes.ios.data.set('sb-session.n', '2')
    fakes.ios.data.set('sb-session.0', 'hello')
    assert.equal(await ios.getItem('sb-session'), null)
  })

  test('removeItem trusts .n, skips non-finite counts, and fans out one delete per index', async () => {
    fakes.ios.data.set('sb-session.n', 'nope')
    fakes.ios.data.set('sb-session.0', 'orphan')
    fakes.ios.data.set('sb-session', 'base')
    await ios.removeItem('sb-session')
    // BUG?: a non-finite `.n` skips chunk deletes. removeItem still resolves,
    // drops the base key, and leaves `key.0` in the keychain.
    assert.equal(fakes.ios.data.has('sb-session.n'), false)
    assert.equal(fakes.ios.data.has('sb-session'), false)
    assert.equal(fakes.ios.data.get('sb-session.0'), 'orphan')

    fakes.ios.reset()
    const count = 20
    fakes.ios.data.set('sb-session.n', String(count))
    fakes.ios.data.set('sb-session.0', 'only-chunk')
    await ios.removeItem('sb-session')
    const deleted = fakes.ios.calls.filter((call) => call.op === 'del').map((call) => call.key)
    assert.deepEqual(deleted, [
      ...Array.from({ length: count }, (_, i) => `sb-session.${i}`),
      'sb-session.n',
      'sb-session',
    ])
    // BUG?: that loop has no upper bound. A corrupt count of 1000000 would
    // issue that many deleteItemAsync calls. The count above is only 20.
    assert.equal(fakes.ios.data.size, 0)
  })

  test('multibyte text under the code-unit cap can still exceed the byte cap', async () => {
    const fits = '你'.repeat(Math.floor(VALUE_BYTES_LIMIT / 3))
    assert.ok(fits.length <= SECURE_CHUNK)
    assert.ok(utf8Bytes(fits) <= VALUE_BYTES_LIMIT)
    await ios.setItem('cjk', fits)
    assert.equal(await ios.getItem('cjk'), fits)
    assert.equal(fakes.ios.data.has('cjk.n'), false)

    const over = '你'.repeat(Math.floor(VALUE_BYTES_LIMIT / 3) + 1)
    assert.ok(over.length <= SECURE_CHUNK)
    assert.ok(utf8Bytes(over) > VALUE_BYTES_LIMIT)
    await assert.rejects(() => ios.setItem('cjk', over), /2048/)
    // BUG?: chunking splits on UTF-16 code units (1800), not UTF-8 bytes.
    // 683 CJK characters stay one item and are 2049 bytes. A SecureStore that
    // still enforces the historical 2048-byte cap rejects the write, and
    // setItem has already deleted the previous value. Web memory keeps it.
    assert.equal(await ios.getItem('cjk'), null)
    assert.equal(fakes.ios.data.has('cjk'), false)

    await web.setItem('cjk-web', over)
    assert.equal(await web.getItem('cjk-web'), over)
    assert.equal(fakes.web.calls.length, 0)
    await web.removeItem('cjk-web')
  })
})
