/**
 * Parallel C. Rider approach wash and SOS sheet.
 * Locks attention math and the screen wiring. Does not edit either file.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ALERT_CHANNELS,
  SOS_CHANNELS,
  isActiveRideStatus,
  sosChannelButton,
  sosChannelHref,
  sosChannelPhrase,
} from '../packages/rides-native/safety.js'
import {
  APPROACH_CLOSE_FT,
  APPROACH_DECREASE_FT,
  APPROACH_HERE_FT,
  APPROACH_NEAR_FT,
  approachAttention,
  approachStage,
  approachStatusLine,
  formatApproachFeet,
  isApproachStatus,
} from '../apps/rider/lib/approachAlert.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

const approach = read('apps/rider/components/ApproachAlert.tsx')
const sheet = read('apps/rider/components/SosSheet.tsx')
const hook = read('apps/rider/lib/useDriverApproach.ts')
const engaged = read('apps/rider/lib/sosEngaged.ts')

test('approach stages and status checks stay case-sensitive', () => {
  assert.equal(isApproachStatus('accepted'), true)
  assert.equal(isApproachStatus('arriving'), true)
  assert.equal(isApproachStatus('arrived'), true)
  assert.equal(isApproachStatus('Accepted'), false)
  assert.equal(isApproachStatus(''), false)
  assert.equal(isApproachStatus(null), false)
  assert.equal(isApproachStatus(undefined), false)
  assert.equal(isApproachStatus('in_progress'), false)
  assert.deepEqual(approachStage(APPROACH_HERE_FT), 'here')
  assert.deepEqual(approachStage(APPROACH_CLOSE_FT), 'close')
  assert.deepEqual(approachStage(APPROACH_NEAR_FT), 'near')
})

test('attention peaks, closing haptics, and the outward latch', () => {
  const table = [
    ['here', 40, 0.4, 0.24, 'heavy'],
    ['close', 150, 0.32, 0.18, 'medium'],
    ['near', 400, 0.24, 0.12, 'light'],
  ]
  for (const [stage, feet, wash, bright, haptic] of table) {
    const entered = approachAttention({ previousFeet: null, feet, previousStage: null })
    assert.equal(entered.stage, stage)
    assert.equal(entered.pulseMode, 'steady')
    assert.equal(entered.washPeak, wash)
    assert.equal(entered.brightPeak, bright)
    assert.equal(entered.haptic, haptic)
    assert.equal(entered.hapticReason, 'stage')
  }

  const farClosing = approachAttention({ previousFeet: 2000, feet: 1900 })
  assert.equal(farClosing.stage, 'far')
  assert.equal(farClosing.pulseMode, 'burst')
  assert.equal(farClosing.washPeak, 0.18)
  assert.equal(farClosing.brightPeak, 0.1)
  assert.equal(farClosing.haptic, 'light')
  assert.equal(farClosing.hapticReason, 'closing')

  const closeClosing = approachAttention({ previousFeet: 180, feet: 180 - APPROACH_DECREASE_FT, previousStage: 'close' })
  assert.equal(closeClosing.stage, 'close')
  assert.equal(closeClosing.haptic, 'medium')
  assert.equal(closeClosing.hapticReason, 'closing')

  const hereClosing = approachAttention({ previousFeet: 80, feet: 80 - APPROACH_DECREASE_FT, previousStage: 'here' })
  assert.equal(hereClosing.haptic, 'medium')
  assert.equal(hereClosing.hapticReason, 'closing')

  const held = approachAttention({ previousFeet: 100, feet: APPROACH_HERE_FT + APPROACH_DECREASE_FT, previousStage: 'here' })
  assert.equal(held.stage, 'here')
  assert.equal(held.decreasing, false)
  assert.equal(held.haptic, null)
  assert.equal(held.pulseMode, 'steady')

  const released = approachAttention({ previousFeet: 100, feet: APPROACH_HERE_FT + APPROACH_DECREASE_FT + 1, previousStage: 'here' })
  assert.equal(released.stage, 'close')
  assert.equal(released.haptic, null)
  assert.equal(released.pulseMode, 'steady')
})

test('the outward hold runs only when previousStage is passed', () => {
  const fromFeet = approachAttention({ previousFeet: 90, feet: 110 })
  assert.equal(fromFeet.stage, 'close')
  assert.equal(fromFeet.haptic, null)
  assert.equal(fromFeet.decreasing, false)

  const held = approachAttention({ previousFeet: 90, feet: 110, previousStage: 'here' })
  assert.equal(held.stage, 'here')
  assert.equal(held.haptic, null)
  assert.equal(held.pulseMode, 'steady')

  const explicitNull = approachAttention({ previousFeet: 90, feet: 110, previousStage: null })
  assert.equal(explicitNull.stage, 'close')
  assert.equal(explicitNull.haptic, 'medium')
  assert.equal(explicitNull.hapticReason, 'stage')
  assert.equal(explicitNull.pulseMode, 'steady')

  assert.equal(approachStatusLine('close', true, 110), 'Getting closer · 110 ft')
  assert.equal(approachStatusLine('here', true, 40), 'Right here · 40 ft')
  assert.equal(formatApproachFeet(110.4), '110 ft')
})

test('the approach overlay unmounts while SOS is engaged and pulses slower than 1 Hz', () => {
  assert.match(approach, /const paused = useSosEngaged\(\)/)
  assert.match(approach, /if \(!active \|\| paused\) return/)
  assert.match(approach, /if \(!active \|\| paused\) return null/)
  assert.match(approach, /const STAGE_HAPTIC_GAP_MS = 12000/)
  assert.match(approach, /const half = stage === 'here' \? 820 : 980/)
  assert.match(approach, /if \(pulseMode === 'burst'\) timer = setTimeout\(fade, half \* 6\)/)
  assert.match(approach, /if \(paused\) \{\s*wash\.stopAnimation\(\)/)
  assert.match(approach, /wash\.setValue\(0\)/)
  assert.match(approach, /bright\.setValue\(0\)/)
  assert.match(approach, /accessibilityLiveRegion="polite"/)
  assert.match(approach, /Platform\.OS === 'ios'/)
  assert.match(approach, /FullWindowOverlay/)
  assert.match(approach, /label === 'nearby' \? 'Nearby' : label/)
  assert.match(approach, /backgroundColor: colors\.orange/)
})

test('the approach hook resets on driver change and names the waiting lines', () => {
  assert.match(hook, /prevFeet\.current = null/)
  assert.match(hook, /prevStage\.current = null/)
  assert.match(hook, /\}, \[driverId\]\)/)
  assert.match(hook, /timeInterval: 2000, distanceInterval: 5/)
  assert.match(hook, /\}, 8000\)/)
  assert.match(hook, /approach-driver-\$\{driverId\}/)
  assert.match(hook, /table: 'driver_status'/)
  assert.match(hook, /approachAttention\(\{ previousFeet, feet, previousStage \}\)/)
  assert.match(hook, /if \(!driverId\) waiting = 'Waiting for your driver'/)
  assert.match(hook, /else if \(!driver\) waiting = "Waiting for your driver's location"/)
  assert.match(hook, /else if \(denied && !rider\) waiting = 'Turn on location to see the distance'/)
  assert.match(hook, /else if \(!rider\) waiting = 'Finding you…'/)
  assert.match(hook, /else if \(!reading\) waiting = 'Updating distance…'/)
})

test('SOS engagement is a module flag and the server snapshot stays false', () => {
  assert.match(engaged, /if \(engaged === next\) return/)
  assert.match(engaged, /useSyncExternalStore\(subscribe, \(\) => engaged, \(\) => false\)/)
  assert.match(engaged, /export function setSosEngaged\(next: boolean\)/)
  assert.match(sheet, /setSosEngaged\(open\)/)
  assert.match(sheet, /return \(\) => setSosEngaged\(false\)/)
  assert.match(sheet, /if \(!open\) setArming\(null\)/)
})

test('the first SOS press logs banner, which is not an alert channel', () => {
  assert.deepEqual(ALERT_CHANNELS, ['tel_911', 'tel_cupd', 'sms', 'mailto', 'web_share'])
  assert.equal(ALERT_CHANNELS.includes('banner'), false)
  assert.equal(SOS_CHANNELS.includes('banner'), true)
  assert.match(sheet, /const MORE_CHANNELS = ALERT_CHANNELS\.filter\(\(channel\) => channel !== 'tel_911' && channel !== 'tel_cupd'\)/)
  assert.match(sheet, /channel: 'banner'/)
  assert.equal(sosChannelHref('banner', 'hello'), null)
  assert.equal(sosChannelHref('web_share', 'hello'), null)
  assert.equal(sosChannelPhrase('banner'), 'sent an in-app SOS')
  assert.deepEqual(sosChannelButton('banner'), {
    title: 'Alert the other person',
    detail: 'In-app banner on this trip',
  })
  assert.equal(isActiveRideStatus('accepted'), true)
  assert.equal(isActiveRideStatus('arriving'), true)
  assert.equal(isActiveRideStatus('in_progress'), true)
  assert.equal(isActiveRideStatus('arrived'), false)
  assert.equal(isActiveRideStatus('searching'), false)
  assert.match(sheet, /const canLog = Boolean\(tripId && userId && isActiveRideStatus\(tripStatus\)\)/)
})

test('SOS copy confirms before it dials, and the extra channels have no label', () => {
  assert.match(sheet, /accessibilityLabel="SOS"/)
  assert.match(sheet, /accessibilityHint="Opens emergency help"/)
  assert.match(sheet, /accessibilityLabel="Close SOS"/)
  assert.match(sheet, /accessibilityLabel="Call 911"/)
  assert.match(sheet, /accessibilityLabel="Call Clemson Police"/)
  assert.match(sheet, /accessibilityLabel="Dismiss SOS banner"/)
  assert.match(sheet, /The first press confirms and alerts your driver\. It does not dial\./)
  assert.match(sheet, /The first press confirms\. It does not dial\. There is no active ride to log\./)
  assert.match(sheet, /Your driver has the in-app SOS\. Press Call 911 or Call Clemson Police to dial\./)
  assert.match(sheet, /Press Call 911 or Call Clemson Police to dial\. This ride is not logging an in-app alert\./)
  assert.match(sheet, /Tap to confirm · does not dial yet/)
  assert.match(sheet, /Confirmed\. Press the button again to call\./)
  assert.match(sheet, /Getting your location…/)
  assert.match(sheet, /GPS unavailable\. You can still call\./)
  assert.match(sheet, /Could not save the SOS log/)
  assert.match(sheet, /You can still call 911\./)
  assert.match(sheet, /No emergency contacts/)
  assert.match(sheet, /Add someone on the Safety screen to call them from here\./)
  assert.match(sheet, /\['#4A0C0C', '#B42318', '#6E1212'\]/)

  const more = sheet.slice(sheet.indexOf('MORE_CHANNELS.map'), sheet.indexOf('contacts.length === 0'))
  assert.match(more, /accessibilityRole="button"/)
  assert.equal(more.includes('accessibilityLabel'), false)
  const contacts = sheet.slice(sheet.indexOf('contacts.map'), sheet.indexOf('shareNote ?'))
  assert.match(contacts, /accessibilityRole="button"/)
  assert.equal(contacts.includes('accessibilityLabel'), false)
})

test('arming returns before dialing, and share errors ignore cancel', () => {
  const police = sheet.slice(sheet.indexOf('async function onPolice'), sheet.indexOf('async function onChannel'))
  assert.match(police, /if \(!armed\)/)
  assert.match(police, /await armSos\(\)/)
  assert.match(police, /return/)
  assert.ok(police.indexOf('return') < police.indexOf('await onChannel(channel)'))
  assert.match(sheet, /if \(busy \|\| armed\) return/)
  assert.match(sheet, /channel === 'web_share'/)
  assert.match(sheet, /Share\.share\(\{ title: 'SOS Clemson RIDES', message: text \}\)/)
  assert.match(sheet, /if \(!\/cancel\|dismiss\/i\.test\(message\)\) setShareNote\(message\)/)
  assert.match(sheet, /setInterval\(load, 8000\)/)
  assert.match(sheet, /row\.user_id !== userId/)
})
