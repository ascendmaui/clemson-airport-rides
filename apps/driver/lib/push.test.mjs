import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Stub Expo and React Native so this file never loads native modules or the network.
globalThis.fetch = async function forbiddenFetch() {
  throw new Error('offline test tried to call fetch')
}

const KEY = '__t1DriverPush'
const REGISTERED = 'This phone is registered for new ride requests.'
const SAVE_FAILED = 'In-app alerts are on. Saving the push token failed, so a closed app may miss the ping.'
const NOTIFICATIONS_OFF = 'Notifications are off. New requests still show in the queue while this app is open.'
const SIGN_IN = 'Sign in to enable ride alerts.'
const TOKEN_UNAVAILABLE = 'Push token is unavailable on this device.'
const RAW_STACK = 'token failed\n    at getExpoPushTokenAsync (expo-notifications.js:10:5)'

function dataUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`
}

const constantsUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  const Constants = {
    get expoConfig() { return globalThis[key].expoConfig },
    get easConfig() { return globalThis[key].easConfig },
  }
  export default Constants
`)

const notificationsUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  export function setNotificationHandler(handler) {
    globalThis[key].handler = handler
  }
  export async function getPermissionsAsync() {
    const state = globalThis[key]
    state.reads += 1
    if (state.readError) throw state.readError
    return { status: state.permissionStatus }
  }
  export async function requestPermissionsAsync() {
    const state = globalThis[key]
    state.asks += 1
    if (state.askError) throw state.askError
    return { status: state.askStatus }
  }
  export async function getExpoPushTokenAsync(options) {
    const state = globalThis[key]
    state.tokenOpts.push(options)
    if (state.tokenError) throw state.tokenError
    return { data: state.tokenData }
  }
  export async function scheduleNotificationAsync(request) {
    const state = globalThis[key]
    state.scheduled.push(request)
    if (state.scheduleError) throw state.scheduleError
  }
  export const AndroidImportance = {
    UNKNOWN: 0,
    UNSPECIFIED: 1,
    NONE: 2,
    MIN: 3,
    LOW: 4,
    DEFAULT: 5,
    HIGH: 6,
    MAX: 7,
  }
  export async function setNotificationChannelAsync(id, channel) {
    const state = globalThis[key]
    state.channels.push({ id, channel })
    if (state.channelError) throw state.channelError
    return { id, ...channel }
  }
`)

const reactNativeUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  export const Platform = {
    get OS() { return globalThis[key].os },
  }
`)

const PARENT = '/apps/driver/lib/push.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || ''
    if (!parent.includes(PARENT)) return nextResolve(specifier, context)
    if (specifier === 'expo-constants') return { url: constantsUrl, shortCircuit: true }
    if (specifier === 'expo-notifications') return { url: notificationsUrl, shortCircuit: true }
    if (specifier === 'react-native') return { url: reactNativeUrl, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

function state() {
  return globalThis[KEY]
}

function networkError() {
  return new TypeError('Network request failed')
}

function timeoutError() {
  const error = new Error('Request timed out')
  error.name = 'TimeoutError'
  return error
}

function assertHuman(message) {
  assert.equal(typeof message, 'string')
  assert.notEqual(message.trim(), '')
  assert.equal(message.includes('[object Object]'), false)
  assert.equal(message.includes('undefined'), false)
  assert.equal(message.includes('\n'), false)
}

function assertIso(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
}

async function rejectionOf(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  assert.fail('expected a rejection')
}

function freshPushState() {
  const handler = globalThis[KEY]?.handler ?? null
  globalThis[KEY] = {
    os: 'ios',
    expoConfig: { extra: { eas: { projectId: 'expo-project' } } },
    easConfig: { projectId: 'eas-project' },
    permissionStatus: 'granted',
    askStatus: 'denied',
    readError: null,
    askError: null,
    reads: 0,
    asks: 0,
    tokenData: 'ExponentPushToken[abc]',
    tokenError: null,
    tokenOpts: [],
    scheduleError: null,
    scheduled: [],
    channelError: null,
    channels: [],
    handler,
  }
}

function supabaseClient(respond) {
  return {
    from(table) {
      const op = { table, filters: [] }
      let pending = null
      const run = () => {
        if (!pending) {
          state().ops.push(op)
          pending = Promise.resolve().then(() => respond(op))
        }
        return pending
      }
      const builder = {
        select() {
          return builder
        },
        upsert(payload) {
          op.action = 'upsert'
          op.payload = payload
          return builder
        },
        eq() {
          return builder
        },
        then(onFulfilled, onRejected) {
          return run().then(onFulfilled, onRejected)
        },
      }
      return builder
    },
  }
}

function reset() {
  freshPushState()
  state().ops = []
}

const CARD = {
  id: 'trip-1',
  pickupLabel: 'White C',
  dropoffLabel: 'GSP',
}

test('driver push offline and error states', { concurrency: false }, async (t) => {
  reset()
  const push = await import('./push.ts')
  t.beforeEach(reset)

  await t.test('exports registration and the local request alert', () => {
    assert.equal(typeof push.registerDriverPush, 'function')
    assert.equal(typeof push.notifyNewRequest, 'function')
  })

  await t.test('the notification handler shows a banner and plays a sound', async () => {
    const decision = await state().handler.handleNotification()
    assert.deepEqual(decision, {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    })
  })

  await t.test('registerDriverPush asks the driver to sign in when there is no id', async () => {
    const client = supabaseClient(() => {
      throw new Error('should not touch supabase')
    })
    for (const driverId of [undefined, '', null]) {
      const result = await push.registerDriverPush(client, driverId)
      assert.deepEqual(result, {
        granted: false,
        token: null,
        stored: false,
        detail: SIGN_IN,
      })
      assertHuman(result.detail)
    }
    assert.equal(state().reads, 0)
    assert.equal(state().ops.length, 0)
  })

  await t.test('registerDriverPush explains when notification permission stays denied', async () => {
    state().permissionStatus = 'denied'
    state().askStatus = 'denied'
    const client = supabaseClient(() => {
      throw new Error('should not touch supabase')
    })
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.deepEqual(result, {
      granted: false,
      token: null,
      stored: false,
      detail: NOTIFICATIONS_OFF,
    })
    assertHuman(result.detail)
    assert.equal(state().reads, 1)
    assert.equal(state().asks, 1)
    assert.equal(state().tokenOpts.length, 0)
    assert.equal(state().ops.length, 0)
  })

  await t.test('registerDriverPush skips the prompt when permission is already granted', async () => {
    const client = supabaseClient(() => ({ error: null }))
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.equal(result.granted, true)
    assert.equal(result.stored, true)
    assert.equal(state().reads, 1)
    assert.equal(state().asks, 0)
    assert.deepEqual(state().tokenOpts, [{ projectId: 'expo-project' }])
  })

  await t.test('registerDriverPush continues after the driver allows the prompt', async () => {
    state().permissionStatus = 'undetermined'
    state().askStatus = 'granted'
    const client = supabaseClient(() => ({ error: null }))
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.equal(result.detail, REGISTERED)
    assertHuman(result.detail)
    assert.equal(state().asks, 1)
    assert.equal(result.token, 'ExponentPushToken[abc]')
    assert.equal(result.stored, true)
  })

  await t.test('registerDriverPush lets a throwing permission check reject', async () => {
    // BUG?: a thrown permission read or prompt rejects the whole call. status !== "granted"
    // returns a PushState whose detail is "Notifications are off…".
    state().readError = networkError()
    const readFailed = await rejectionOf(push.registerDriverPush(null, 'driver-1'))
    assert.equal(readFailed, state().readError)
    assertHuman(readFailed.message)

    state().readError = null
    state().permissionStatus = 'denied'
    state().askError = timeoutError()
    const askFailed = await rejectionOf(push.registerDriverPush(null, 'driver-1'))
    assert.equal(askFailed, state().askError)
    assertHuman(askFailed.message)
    assert.equal(state().tokenOpts.length, 0)
  })

  await t.test('registerDriverPush stores the expo token on the happy path', async () => {
    let payload = null
    const client = supabaseClient((op) => {
      payload = op.payload
      assert.equal(op.table, 'driver_status')
      assert.equal(op.action, 'upsert')
      return { error: null }
    })
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.deepEqual(result, {
      granted: true,
      token: 'ExponentPushToken[abc]',
      stored: true,
      detail: REGISTERED,
    })
    assertHuman(result.detail)
    assert.equal(payload.driver_id, 'driver-1')
    assert.equal(payload.expo_push_token, 'ExponentPushToken[abc]')
    assert.equal('platform' in payload, false)
    assertIso(payload.updated_at)
    assert.equal(state().scheduled.length, 0)
  })

  await t.test('registerDriverPush uses the eas project id when the expo one is blank', async () => {
    state().expoConfig = { extra: { eas: { projectId: '' } } }
    state().easConfig = { projectId: 'eas-project' }
    const client = supabaseClient(() => ({ error: null }))
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.equal(result.stored, true)
    assert.deepEqual(state().tokenOpts, [{ projectId: 'eas-project' }])
  })

  await t.test('registerDriverPush still stores a token when no project id is configured', async () => {
    state().expoConfig = null
    state().easConfig = null
    const client = supabaseClient(() => ({ error: null }))
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.deepEqual(result, {
      granted: true,
      token: 'ExponentPushToken[abc]',
      stored: true,
      detail: REGISTERED,
    })
    assert.deepEqual(state().tokenOpts, [undefined])
  })

  await t.test('registerDriverPush shows the raw token error when no project id is configured', async () => {
    // BUG?: with no EAS projectId, getExpoPushTokenAsync is still called with undefined
    // and the raw thrown message becomes the on-screen detail.
    state().expoConfig = null
    state().easConfig = undefined
    state().tokenError = new Error('No "projectId" found.')
    const result = await push.registerDriverPush(null, 'driver-1')
    assert.deepEqual(result, {
      granted: true,
      token: null,
      stored: false,
      detail: 'No "projectId" found.',
    })
    assert.deepEqual(state().tokenOpts, [undefined])
  })

  await t.test('registerDriverPush turns a network or timeout token failure into detail text', async () => {
    for (const error of [networkError(), timeoutError()]) {
      state().tokenError = error
      state().tokenOpts = []
      const result = await push.registerDriverPush(null, 'driver-1')
      assert.deepEqual(result, {
        granted: true,
        token: null,
        stored: false,
        detail: error.message,
      })
      assertHuman(result.detail)
    }
  })

  await t.test('registerDriverPush replaces a non-Error token failure with a sentence', async () => {
    state().tokenError = 'nope'
    const result = await push.registerDriverPush(null, 'driver-1')
    assert.deepEqual(result, {
      granted: true,
      token: null,
      stored: false,
      detail: TOKEN_UNAVAILABLE,
    })
    assertHuman(result.detail)
  })

  await t.test('registerDriverPush passes a non-readable token Error message through', async () => {
    // BUG?: Error messages from the token call are used as detail with no readability
    // check, so "[object Object]" or a stack is what the driver sees.
    state().tokenError = new Error('[object Object]')
    const ugly = await push.registerDriverPush(null, 'driver-1')
    assert.equal(ugly.detail, '[object Object]')
    assert.equal(ugly.token, null)
    assert.equal(ugly.stored, false)

    state().tokenError = new Error(RAW_STACK)
    const stacked = await push.registerDriverPush(null, 'driver-1')
    assert.equal(stacked.detail, RAW_STACK)
  })

  await t.test('registerDriverPush describes a null supabase client as a failed save', async () => {
    // BUG?: an unconfigured (null) client uses the same detail as a failed token write,
    // "Saving the push token failed…", rather than a not-configured sentence.
    const result = await push.registerDriverPush(null, 'driver-1')
    assert.deepEqual(result, {
      granted: true,
      token: 'ExponentPushToken[abc]',
      stored: false,
      detail: SAVE_FAILED,
    })
    assertHuman(result.detail)
  })

  await t.test('registerDriverPush describes a missing token as a failed save', async () => {
    // BUG?: an empty token is returned as "" and a missing token payload as undefined,
    // and both use the save-failure detail instead of "Push token is unavailable…".
    state().tokenData = ''
    const empty = await push.registerDriverPush(supabaseClient(() => {
      throw new Error('should not touch supabase')
    }), 'driver-1')
    assert.equal(empty.token, '')
    assert.equal(empty.stored, false)
    assert.equal(empty.detail, SAVE_FAILED)
    assert.equal(state().ops.length, 0)

    state().tokenData = undefined
    state().ops = []
    const missing = await push.registerDriverPush(supabaseClient(() => {
      throw new Error('should not touch supabase')
    }), 'driver-1')
    assert.equal(missing.token, undefined)
    assert.equal(missing.stored, false)
    assert.equal(missing.detail, SAVE_FAILED)
    assert.equal(state().ops.length, 0)
  })

  await t.test('a returned driver_status error becomes the generic save-failure detail', async () => {
    const stack = 'permission denied\n    at upsert (client.js:1:1)'
    const client = supabaseClient(() => ({ error: { message: stack } }))
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.equal(result.stored, false)
    assert.equal(result.token, 'ExponentPushToken[abc]')
    assert.equal(result.detail, SAVE_FAILED)
    assertHuman(result.detail)
    assert.equal(state().ops.length, 1)
  })

  await t.test('a driver_status error with no message does not throw', async () => {
    const client = supabaseClient(() => ({ error: {} }))
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.equal(result.stored, false)
    assert.equal(result.detail, SAVE_FAILED)
    assertHuman(result.detail)
    assert.equal(state().ops.length, 1)
  })

  await t.test('a missing expo_push_token column falls back to driver_push_tokens', async () => {
    state().os = 'android'
    let updatedAt = null
    const client = supabaseClient((op) => {
      if (op.table === 'driver_status') {
        updatedAt = op.payload.updated_at
        return {
          error: {
            message: "Could not find the 'expo_push_token' column of 'driver_status' in the schema cache",
          },
        }
      }
      assert.equal(op.table, 'driver_push_tokens')
      assert.equal(op.payload.driver_id, 'driver-1')
      assert.equal(op.payload.token, 'ExponentPushToken[abc]')
      assert.equal(op.payload.platform, 'android')
      assert.equal(op.payload.updated_at, updatedAt)
      assertIso(op.payload.updated_at)
      return { error: null }
    })
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.deepEqual(result, {
      granted: true,
      token: 'ExponentPushToken[abc]',
      stored: true,
      detail: REGISTERED,
    })
    assert.equal(state().ops.length, 2)
  })

  await t.test('any driver_status error that mentions column takes the fallback', async () => {
    // BUG?: the schema-mismatch check matches the word "column", not only a missing
    // expo_push_token column. A not-null violation is written to driver_push_tokens
    // and reported as stored.
    const client = supabaseClient((op) => {
      if (op.table === 'driver_status') {
        return {
          error: {
            message: 'null value in column "driver_id" of relation "driver_status" violates not-null constraint',
          },
        }
      }
      assert.equal(op.table, 'driver_push_tokens')
      return { error: null }
    })
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.equal(result.stored, true)
    assert.equal(result.detail, REGISTERED)
    assert.equal(state().ops.length, 2)
  })

  await t.test('a failed fallback upsert stays unstored with a readable detail', async () => {
    const client = supabaseClient((op) => {
      if (op.table === 'driver_status') return { error: { message: 'schema cache' } }
      return { error: { message: 'permission denied for table driver_push_tokens' } }
    })
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.equal(result.stored, false)
    assert.equal(result.detail, SAVE_FAILED)
    assertHuman(result.detail)
    assert.equal(state().ops.length, 2)
  })

  await t.test('a thrown token upsert rejects instead of returning PushState', async () => {
    // BUG?: getExpoPushTokenAsync failures return a PushState. A thrown upsert
    // (network, timeout, or the fallback table) rejects with the raw error.
    const client = supabaseClient(() => {
      throw networkError()
    })
    const offline = await rejectionOf(push.registerDriverPush(client, 'driver-1'))
    assert.equal(offline instanceof TypeError, true)
    assert.equal(offline.message, 'Network request failed')

    const timed = supabaseClient(() => {
      throw timeoutError()
    })
    const timeout = await rejectionOf(push.registerDriverPush(timed, 'driver-1'))
    assert.equal(timeout.name, 'TimeoutError')
    assertHuman(timeout.message)

    const fallback = supabaseClient((op) => {
      if (op.table === 'driver_status') return { error: { message: 'schema cache' } }
      throw new Error('[object Object]')
    })
    const ugly = await rejectionOf(push.registerDriverPush(fallback, 'driver-1'))
    assert.equal(ugly.message, '[object Object]')
  })

  await t.test('notifyNewRequest copies the trip into a local notification', async () => {
    await push.notifyNewRequest({
      ...CARD,
      tagLabels: ['Airport', 'XL', 'Quiet', 'Extra'],
    })
    await push.notifyNewRequest({
      id: 'trip-2',
      pickupLabel: 'ASC',
      dropoffLabel: 'Downtown',
    })
    await push.notifyNewRequest({
      id: 'trip-3',
      pickupLabel: 'Library',
      dropoffLabel: 'Tillman',
      tagLabels: [],
    })
    assert.deepEqual(state().scheduled, [
      {
        content: {
          title: 'New ride request',
          body: 'White C → GSP · Airport · XL · Quiet',
          data: { tripId: 'trip-1' },
          sound: 'ride_offer_chime.caf',
        },
        trigger: null,
      },
      {
        content: {
          title: 'New ride request',
          body: 'ASC → Downtown',
          data: { tripId: 'trip-2' },
          sound: 'ride_offer_chime.caf',
        },
        trigger: null,
      },
      {
        content: {
          title: 'New ride request',
          body: 'Library → Tillman',
          data: { tripId: 'trip-3' },
          sound: 'ride_offer_chime.caf',
        },
        trigger: null,
      },
    ])
    assert.equal(state().reads, 0)
    assert.equal(state().channels.length, 0)
  })

  await t.test('ride-offer payloads name the bundled chime and other alerts do not', () => {
    state().os = 'ios'
    const offer = push.driverNotificationRequest('ride_offer', {
      title: 'New ride request',
      body: 'White C → GSP',
      data: { tripId: 'trip-1' },
    })
    assert.equal(offer.content.sound, 'ride_offer_chime.caf')
    assert.equal(offer.trigger, null)
    assert.equal(JSON.stringify(offer).includes('ride_offer_chime.wav'), false)

    state().os = 'android'
    const androidOffer = push.driverNotificationRequest('ride_offer', {
      title: 'New ride request',
      body: 'White C → GSP',
      data: { tripId: 'trip-1' },
    })
    assert.equal(androidOffer.content.sound, 'ride_offer_chime.wav')
    assert.deepEqual(androidOffer.trigger, { channelId: 'ride-offers' })
    assert.equal(JSON.stringify(androidOffer).includes('ride_offer_chime.caf'), false)

    for (const kind of ['chat', 'trip_status', 'marketing']) {
      for (const os of ['ios', 'android']) {
        state().os = os
        const other = push.driverNotificationRequest(kind, {
          title: 'Update',
          body: 'Something else',
          data: { tripId: 'trip-9' },
        })
        const encoded = JSON.stringify(other)
        assert.equal(other.content.sound, undefined, kind)
        assert.equal(other.trigger, null, kind)
        assert.equal(encoded.includes('ride_offer_chime'), false, kind)
        assert.equal(encoded.includes('ride-offers'), false, kind)
        assert.equal(encoded.includes('request.wav'), false, kind)
      }
    }
  })

  await t.test('android ride offers use a high-importance channel with the custom sound', async () => {
    state().os = 'android'
    await push.notifyNewRequest(CARD)
    assert.deepEqual(state().channels, [
      {
        id: 'ride-offers',
        channel: {
          name: 'New ride offers',
          // Expo AndroidImportance.HIGH is 6 and maps to NotificationManager.IMPORTANCE_HIGH.
          importance: 6,
          sound: 'ride_offer_chime.wav',
        },
      },
    ])
    assert.deepEqual(state().scheduled, [
      {
        content: {
          title: 'New ride request',
          body: 'White C → GSP',
          data: { tripId: 'trip-1' },
          sound: 'ride_offer_chime.wav',
        },
        trigger: { channelId: 'ride-offers' },
      },
    ])
  })

  await t.test('registerDriverPush creates the ride-offer channel on android before the token request', async () => {
    state().os = 'android'
    const client = supabaseClient(() => ({ error: null }))
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.equal(result.stored, true)
    assert.equal(state().channels.length, 1)
    assert.equal(state().channels[0].id, 'ride-offers')
    assert.equal(state().channels[0].channel.importance, 6)
    assert.equal(state().channels[0].channel.sound, 'ride_offer_chime.wav')
    assert.equal(state().tokenOpts.length, 1)
  })

  await t.test('a channel setup failure does not block push token registration', async () => {
    state().os = 'android'
    state().channelError = new Error('channel denied')
    const client = supabaseClient(() => ({ error: null }))
    const result = await push.registerDriverPush(client, 'driver-1')
    assert.equal(result.stored, true)
    assert.equal(result.detail, REGISTERED)
    assert.equal(state().channels.length, 1)
    assert.equal(state().tokenOpts.length, 1)
  })

  await t.test('notifyNewRequest propagates scheduler network, timeout, and raw errors', async () => {
    state().scheduleError = networkError()
    const offline = await rejectionOf(push.notifyNewRequest(CARD))
    assert.equal(offline.message, 'Network request failed')
    assertHuman(offline.message)

    state().scheduleError = timeoutError()
    const timeout = await rejectionOf(push.notifyNewRequest(CARD))
    assert.equal(timeout.name, 'TimeoutError')
    assertHuman(timeout.message)

    // BUG?: scheduler failures reject with the original error. "[object Object]" or a
    // stack is not replaced with a short sentence.
    state().scheduleError = new Error('[object Object]')
    const ugly = await rejectionOf(push.notifyNewRequest(CARD))
    assert.equal(ugly.message, '[object Object]')

    state().scheduleError = new Error(RAW_STACK)
    const stacked = await rejectionOf(push.notifyNewRequest(CARD))
    assert.equal(stacked.message, RAW_STACK)
  })

  await t.test('the chime is bundled for the driver app and not shared as an Android caf resource', () => {
    const driverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const wav = readFileSync(resolve(driverRoot, 'assets/sounds/ride_offer_chime.wav'))
    const caf = readFileSync(resolve(driverRoot, 'assets/sounds/ride_offer_chime.caf'))
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
    const fmt = wavInfo(wav)
    assert.equal(fmt.audioFormat, 1)
    assert.equal(fmt.channels, 1)
    assert.equal(fmt.sampleRate, 44100)
    assert.equal(fmt.bits, 16)
    assert.ok(fmt.frames / fmt.sampleRate < 30)
    assert.ok(fmt.frames / fmt.sampleRate > 1)
    assert.equal(caf.toString('ascii', 0, 4), 'caff')

    const appConfig = JSON.parse(readFileSync(resolve(driverRoot, 'app.json'), 'utf8'))
    const notificationsPlugin = appConfig.expo.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'expo-notifications')
    assert.ok(notificationsPlugin)
    assert.deepEqual(notificationsPlugin[1].sounds, [
      './assets/sounds/request.wav',
      './assets/sounds/ride_offer_chime.wav',
    ])
    assert.equal(appConfig.expo.plugins.includes('./plugins/withIosRideOfferChime.js'), true)
    const plugin = readFileSync(resolve(driverRoot, 'plugins/withIosRideOfferChime.js'), 'utf8')
    assert.equal(plugin.includes('assets/sounds/ride_offer_chime.caf'), true)
    assert.equal(plugin.includes('res/raw'), false)
  })
})

function wavInfo(wav) {
  let offset = 12
  let audioFormat = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let frames = 0
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      audioFormat = wav.readUInt16LE(offset + 8)
      channels = wav.readUInt16LE(offset + 10)
      sampleRate = wav.readUInt32LE(offset + 12)
      bits = wav.readUInt16LE(offset + 22)
    }
    if (id === 'data' && bits && channels && sampleRate) {
      frames = size / (channels * (bits / 8))
    }
    offset += 8 + size + (size % 2)
  }
  return { audioFormat, channels, sampleRate, bits, frames }
}
