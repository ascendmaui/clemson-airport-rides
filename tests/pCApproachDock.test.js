/**
 * Parallel C. Approach dock composition: kicker, secondary line, haptics, poll gates.
 * Source contract. Does not edit the overlay or the hook.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { approachStatusLine, formatApproachFeet } from '../apps/rider/lib/approachAlert.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

const overlay = read('apps/rider/components/ApproachAlert.tsx')
const hook = read('apps/rider/lib/useDriverApproach.ts')

function between(source, start, end) {
  const i = source.indexOf(start)
  assert.ok(i >= 0, `missing ${start}`)
  const j = source.indexOf(end, i + start.length)
  assert.ok(j > i, `missing ${end}`)
  return source.slice(i, j)
}

test('the visible kicker is the status phrase and the secondary line prefers meters', () => {
  assert.match(overlay, /const kicker = statusLine\.split\(' · '\)\[0\]/)
  assert.match(overlay, /\{kicker\.toUpperCase\(\)\}/)
  assert.match(overlay, /const secondary = reading\?\.secondary \?\? waiting \?\? statusLine/)
  assert.match(overlay, /const primary = approachPrimaryLine\(reading\?\.feet\)/)
  assert.match(overlay, /return label === 'nearby' \? 'Nearby' : label/)
  assert.match(overlay, /accessibilityRole="text"/)
  assert.match(overlay, /accessibilityLabel=\{reading \? `\$\{primary\}, \$\{reading\.secondary\}\. \$\{statusLine\}` : `\$\{primary\}\. \$\{waiting \?\? statusLine\}`\}/)
  const line = approachStatusLine('close', true, 180)
  assert.equal(line.split(' · ')[0], 'Getting closer')
  assert.equal(line.split(' · ')[0].toUpperCase(), 'GETTING CLOSER')
  assert.equal(approachStatusLine('near', false).split(' · ').length, 1)
  assert.equal(formatApproachFeet(null), 'nearby')
  assert.equal(formatApproachFeet(180), '180 ft')
})

test('the dock sits above the tab bar and iOS uses a non-modal overlay', () => {
  assert.match(overlay, /bottom: Math\.max\(insets\.bottom, 10\) \+ 74/)
  assert.match(overlay, /zIndex: 40/)
  assert.match(overlay, /elevation: 40/)
  assert.match(overlay, /pointerEvents="box-none"/)
  assert.equal((overlay.match(/pointerEvents="none"/g) || []).length, 3)
  assert.match(overlay, /unstable_accessibilityContainerViewIsModal=\{false\}/)
  assert.match(overlay, /if \(Platform\.OS === 'ios'\)/)
  const card = between(overlay, '<View', 'style={[styles.card')
  assert.match(card, /\baccessible\b/)
  assert.equal(overlay.includes('SosSheet'), false)
  assert.equal(overlay.includes('accessibilityLabel="SOS"'), false)
})

test('stage haptics dedupe and a closing buzz waits twelve seconds', () => {
  const effect = between(overlay, 'if (!active || paused) return', 'let loop')
  const farClear = effect.indexOf("stage === 'far' || stage == null")
  const reasonClear = effect.indexOf("hapticReason !== 'stage'")
  const noHaptic = effect.indexOf('if (!haptic) return')
  const sameStage = effect.indexOf('lastStageHaptic.current === stage')
  const closing = effect.indexOf("hapticReason === 'closing'")
  const gap = effect.indexOf('STAGE_HAPTIC_GAP_MS')
  assert.ok(farClear >= 0 && farClear < reasonClear)
  assert.ok(reasonClear < noHaptic)
  assert.ok(noHaptic < sameStage)
  assert.ok(sameStage < closing)
  assert.ok(closing < gap)
  assert.match(effect, /lastStageHaptic\.current = stage/)
  assert.match(effect, /void approachHaptic\(haptic\)/)
  assert.match(overlay, /duration: 480/)
  assert.equal((overlay.match(/duration: 480/g) || []).length, 2)
  assert.match(overlay, /wash\.setValue\(0\.04\)/)
  assert.match(overlay, /bright\.setValue\(0\)/)
  assert.match(overlay, /const half = stage === 'here' \? 820 : 980/)
})

test('waiting reasons stay in driver, permission, rider, then distance order', () => {
  const driver = hook.indexOf('if (!driverId) waiting')
  const location = hook.indexOf('else if (!driver) waiting')
  const denied = hook.indexOf('else if (denied && !rider)')
  const rider = hook.indexOf('else if (!rider) waiting')
  const reading = hook.indexOf('else if (!reading) waiting')
  assert.ok(driver < location && location < denied && denied < rider && rider < reading)
  const waitingBlock = hook.slice(driver, hook.indexOf('return {', driver))
  assert.equal(waitingBlock.includes('if (!active)'), false)
  assert.equal(waitingBlock.includes('if (active)'), false)
})

test('the hook latches previousStage and ignores a bad driver fix', () => {
  assert.match(hook, /const previousFeet = feet == null \? null : prevFeet\.current/)
  assert.match(hook, /const previousStage = feet == null \? null : prevStage\.current/)
  assert.match(hook, /const attention = feet == null \? null : approachAttention\(\{ previousFeet, feet, previousStage \}\)/)
  assert.match(hook, /if \(!active \|\| feet == null\) \{\s*prevFeet\.current = null\s*prevStage\.current = null/)
  const driverChange = between(hook, 'prevFeet.current = null', '}, [driverId])')
  assert.match(driverChange, /setDriver\(null\)/)
  assert.equal(driverChange.includes('setRider'), false)
  assert.equal(driverChange.includes('setDenied'), false)
  assert.match(hook, /if \(!active\) return undefined/)
  assert.match(hook, /if \(!active \|\| !driverId \|\| !supabase\) return undefined/)
  assert.match(hook, /\.select\('lat, lng'\)/)
  assert.match(hook, /\.eq\('driver_id', driverId\)/)
  assert.match(hook, /\.maybeSingle\(\)/)
  assert.match(hook, /if \(!alive \|\| error \|\| !data\) return/)
  assert.match(hook, /filter: `driver_id=eq\.\$\{driverId\}`/)
  assert.equal((hook.match(/if \(!Number\.isFinite\(lat\) \|\| !Number\.isFinite\(lng\)\) return/g) || []).length, 3)
  assert.match(hook, /if \(alive\) setDenied\(true\)/)
  assert.match(hook, /accuracy: Location\.Accuracy\.High, timeInterval: 2000, distanceInterval: 5/)
})

test('a feet sample with a null latch is what the hook sends on the first fix', () => {
  assert.match(hook, /const prevStage = useRef<ApproachStage \| null>\(null\)/)
  assert.match(hook, /const prevFeet = useRef<number \| null>\(null\)/)
  const call = hook.slice(hook.indexOf('approachAttention('), hook.indexOf(')', hook.indexOf('approachAttention(')) + 1)
  assert.match(call, /previousStage/)
  assert.equal(call.includes('undefined'), false)
  assert.match(hook, /statusLine: approachStatusLine\(attention\?\.stage \?\? null, Boolean\(attention\?\.decreasing\), feet\)/)
  assert.match(hook, /const active = isApproachStatus\(status\)/)
  const locationEffect = between(hook, 'if (!active) return undefined', 'if (!active || !driverId || !supabase)')
  assert.match(locationEffect, /getForegroundPermissionsAsync/)
  assert.match(locationEffect, /requestForegroundPermissionsAsync/)
  assert.match(locationEffect, /sub\?\.remove\(\)/)
})
