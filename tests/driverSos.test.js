import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@babel/parser'
import { buildSosText, isActiveRideStatus, logSosEvent, sosChannelHref, tripShareMessage } from '../packages/rides-native/safety.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const trip = read('apps/driver/app/trip.tsx')
const sheet = read('apps/driver/components/SosSheet.tsx')

test('trip header renders SOS only for live statuses and passes the latest driver fix', () => {
  assert.match(trip, /import \{ isActiveRideStatus \} from 'rides-native\/safety\.js'/)
  assert.match(trip, /const sosActive = isActiveRideStatus\(trip\?\.status\)/)
  assert.match(trip, /<View style=\{styles\.sheetHeader\}>[\s\S]*?\{sosActive \? <SosButton onPress=\{\(\) => setSosOpen\(true\)\} \/> : null\}/)
  assert.match(trip, /<SosSheet\s+open=\{sosOpen && sosActive\}/)
  assert.match(trip, /fix=\{self \? \{ lat: self\.latitude, lng: self\.longitude \} : null\}/)
  assert.match(sheet, /if \(!live\) return null/)
  for (const status of ['accepted', 'arriving', 'arrived', 'in_progress']) assert.equal(isActiveRideStatus(status), true)
  for (const status of ['completed', 'canceled', 'canceled_midride', 'cancelled_wait', 'searching', 'offered', 'scheduled']) assert.equal(isActiveRideStatus(status), false)
})

test('driver safety opens the same sheet with active trip and last published coordinates', () => {
  const safety = read('apps/driver/app/safety.tsx')
  assert.match(safety, /\.in\('status', \[\.\.\.ACTIVE_RIDE_STATUSES\]\)/)
  assert.match(safety, /from\('driver_status'\)\.select\('lat, lng'\)/)
  assert.match(safety, /\{trip \? \([\s\S]*?<SosButton onPress=\{\(\) => setSosOpen\(true\)\}/)
  assert.match(safety, /<SosSheet open=\{sosOpen && Boolean\(trip\)\}[^\n]*trip=\{trip\}[^\n]*fix=\{fix\}/)
  assert.match(safety, /useFocusEffect/)
  assert.match(safety, /subscribeTrips\(client/)
})

test('driver SOS has accessible large controls for each required action', () => {
  assert.match(sheet, /accessibilityLabel="Emergency SOS"/)
  assert.match(sheet, />SOS<\/Text>/)
  assert.match(sheet, /button: \{ minWidth: 64, minHeight: 48/)
  assert.match(sheet, /backgroundColor: colors\.danger/)
  for (const [label, channel] of [['Call 911', 'tel_911'], ['Call Clemson University Police', 'tel_cupd'], ['Share trip with a contact', 'web_share']]) {
    assert.ok(sheet.includes(`accessibilityLabel="${label}" onPress={() => onAction('${channel}')}`))
  }
})

// Exercise the actual action body without needing a native runtime. This checks
// dialing and sharing when logging stalls or rejects, beyond a source substring.
const ast = parse(sheet, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
function findAction(node) {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'FunctionDeclaration' && node.id?.name === 'onAction') return node
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = findAction(child)
      if (found) return found
    }
  }
  return null
}
const actionNode = findAction(ast)
const actionBody = sheet.slice(actionNode.body.start + 1, actionNode.body.end - 1).replace('sosChannelHref(channel, text)!', 'sosChannelHref(channel, text)')
const makeAction = new Function('trip', 'live', 'userId', 'fix', 'supabase', 'logSosEvent', 'Linking', 'Share', 'buildSosText', 'sosChannelHref', 'tripShareMessage', 'setLogError', 'setActionError', `return function(channel) { ${actionBody} }`)

test('driver calls and shares without waiting for SOS logging, including thrown failures', async () => {
  for (const failure of ['stalled', 'rejected', 'rls']) {
    for (const channel of ['tel_911', 'tel_cupd', 'web_share']) {
      let row
      let opened
      let shared
      const errors = []
      const logger = (_, input) => {
        row = input
        if (failure === 'stalled') return new Promise(() => {})
        if (failure === 'rejected') return Promise.reject(new Error('offline'))
        return Promise.resolve({ ok: false, error: 'rls' })
      }
      const action = makeAction({ id: 'trip-1', status: 'arrived', pickupLabel: 'Pickup', dropoffLabel: 'Airport' }, true, 'driver-1', { lat: 34.68, lng: -82.83 }, {}, logger,
        { openURL: (href) => { opened = href; return Promise.resolve() } },
        { share: (payload) => { shared = payload; return Promise.resolve() } },
        buildSosText, sosChannelHref, tripShareMessage, (error) => errors.push(error), () => {})
      action(channel)
      assert.deepEqual(row, { userId: 'driver-1', tripId: 'trip-1', lat: 34.68, lng: -82.83, channel })
      if (channel === 'web_share') {
        assert.match(shared.message, /Pickup → Airport/)
        assert.match(shared.message, /Trip: trip-1/)
        assert.match(shared.message, /34\.68000, -82\.83000/)
      } else {
        assert.equal(opened, channel === 'tel_911' ? 'tel:911' : 'tel:+18646562222')
      }
      await new Promise((resolve) => setImmediate(resolve))
      if (failure !== 'stalled') assert.match(errors.at(-1), /Could not save the SOS event/)
    }
  }
})

test('native SOS logger handles thrown transport errors as a failed result', async () => {
  const db = { from() { throw new Error('offline') } }
  assert.deepEqual(await logSosEvent(db, { tripId: 'trip-1', userId: 'driver-1', channel: 'tel_911' }), { ok: false, error: 'offline' })
})
