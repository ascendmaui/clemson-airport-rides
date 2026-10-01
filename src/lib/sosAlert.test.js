import assert from 'node:assert/strict'
import {
  CUPD_EMAIL,
  CUPD_PHONE_E164,
  buildSosText,
  isActiveRideStatus,
  shareSosText,
  sosChannelHref,
} from './sosAlert.js'

const text = buildSosText({ lat: 34.6834, lng: -82.8374, tripId: 'trip-123' })
assert.match(text, /Trip: trip-123/)
assert.match(text, /34\.68340, -82\.83740/)
assert.match(text, /https:\/\/maps\.google\.com\/maps\?q=34\.68340,-82\.83740/)

const missing = buildSosText({ lat: null, lng: null, tripId: 'trip-123' })
assert.match(missing, /GPS unavailable/)
assert.equal(missing.includes('maps.google.com'), false)

assert.equal(sosChannelHref('tel_911', text), 'tel:911')
assert.equal(sosChannelHref('tel_cupd', text), `tel:${CUPD_PHONE_E164}`)
assert.match(sosChannelHref('sms', text), /^sms:911\?&body=/)
assert.match(decodeURIComponent(sosChannelHref('sms', text)), /Trip: trip-123/)
assert.match(sosChannelHref('mailto', text), new RegExp(`^mailto:${CUPD_EMAIL}\\?`))
assert.equal(sosChannelHref('web_share', text), null)
assert.equal(sosChannelHref('banner', text), null)
assert.throws(() => sosChannelHref('fat-finger', text))

assert.equal(isActiveRideStatus('in_progress'), true)
assert.equal(isActiveRideStatus('searching'), false)
assert.equal(isActiveRideStatus('completed'), false)

const hadNavigator = Object.prototype.hasOwnProperty.call(globalThis, 'navigator')
const originalNavigator = globalThis.navigator

function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value,
  })
}

function restoreNavigator() {
  if (hadNavigator) setNavigator(originalNavigator)
  else delete globalThis.navigator
}

try {
  setNavigator({ share: async () => {} })
  assert.equal(await shareSosText('hello'), 'shared')

  setNavigator({
    share: async () => {
      const err = new Error('cancelled')
      err.name = 'AbortError'
      throw err
    },
  })
  assert.equal(await shareSosText('hello'), 'dismissed')

  let copied = null
  setNavigator({
    share: async () => {
      throw new Error('share unavailable')
    },
    clipboard: {
      writeText: async (value) => {
        copied = value
      },
    },
  })
  assert.equal(await shareSosText('hello'), 'copied')
  assert.equal(copied, 'hello')

  copied = null
  setNavigator({
    clipboard: {
      writeText: async (value) => {
        copied = value
      },
    },
  })
  assert.equal(await shareSosText('pin'), 'copied')
  assert.equal(copied, 'pin')

  setNavigator({
    share: async () => {
      throw new Error('share unavailable')
    },
  })
  assert.equal(await shareSosText('hello'), 'unavailable')

  setNavigator({})
  assert.equal(await shareSosText('hello'), 'unavailable')

  setNavigator(undefined)
  assert.equal(await shareSosText('hello'), 'unavailable')
} finally {
  restoreNavigator()
}

console.log('sosAlert checks passed')
