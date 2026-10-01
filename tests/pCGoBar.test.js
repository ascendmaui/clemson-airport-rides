/**
 * Parallel C. GO / END bar contract for native shell and web DriverHome.
 * Documents the duplicate accessibility props. Does not edit the components.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function sliceFn(source, start, end) {
  const i = source.indexOf(start)
  assert.ok(i >= 0, `missing ${start}`)
  const j = source.indexOf(end, i + start.length)
  assert.ok(j > i, `missing ${end}`)
  return source.slice(i, j)
}

const shell = read('apps/driver/components/shell.tsx')
const home = read('apps/driver/app/(tabs)/index.tsx')
const web = read('src/screens/DriverHome.jsx')
const go = sliceFn(shell, 'export function GoButton', 'export function Toggle')
const toggle = sliceFn(home, 'async function toggle', 'async function onAccept')

function attrNames(opening) {
  return [...opening.matchAll(/\n\s+([A-Za-z][A-Za-z0-9]*)=/g)].map((match) => match[1])
}

test('GoButton writes each accessibility prop twice and the later one wins', () => {
  const pressableAt = go.indexOf('<Pressable')
  const opening = go.slice(pressableAt, go.indexOf('>', pressableAt))
  const names = attrNames(opening)
  assert.deepEqual(names, [
    'onPress',
    'disabled',
    'accessibilityRole',
    'accessibilityLabel',
    'accessibilityHint',
    'accessibilityState',
    'style',
    'accessibilityLabel',
    'accessibilityState',
    'accessibilityHint',
    'style',
  ])

  const labels = [...opening.matchAll(/accessibilityLabel=\{([^}]+)\}/g)].map((match) => match[1])
  assert.deepEqual(labels, ['label', "online ? 'Go offline' : 'Go online'"])

  const states = [...opening.matchAll(/accessibilityState=\{\{([^}]+)\}\}/g)].map((match) => match[1].trim())
  assert.deepEqual(states, ['disabled: isDisabled', 'disabled: busy'])

  const hints = [...opening.matchAll(/accessibilityHint=\{([^}]+)\}/g)].map((match) => match[1])
  assert.equal(hints.length, 2)
  assert.match(hints[0], /disabled && disabledReason/)
  assert.match(hints[1], /online \? 'Takes you offline' : 'Goes online to receive ride requests'/)

  const opacities = [...opening.matchAll(/opacity: ([^}]+)\}/g)].map((match) => match[1].trim())
  assert.deepEqual(opacities, ['isDisabled ? 0.45 : 1', 'busy ? 0.7 : 1'])
})

test('the visible GO control still uses approval-disabled, separate from the second a11y state', () => {
  assert.match(go, /const isDisabled = Boolean\(busy \|\| disabled\)/)
  assert.match(go, /const label = disabled/)
  assert.match(go, /disabledReason \? `Go online disabled: \$\{disabledReason\}` : 'Go online disabled'/)
  assert.match(go, /disabled=\{isDisabled\}/)
  assert.match(go, /colors=\{disabled \? \[colors\.card, colors\.track\] : \[colors\.goStart, colors\.orange\]\}/)
  assert.match(go, /color: disabled \? colors\.inkSecondary : colors\.onAccent/)
  assert.match(go, /\{online \? 'END' : 'GO'\}/)
  assert.equal(go.includes('accessibilityState={{ disabled: isDisabled, busy }}'), false)
})

test('native home wires the gate into GoButton and does not auto-publish online', () => {
  assert.match(home, /<GoButton/)
  assert.match(home, /online=\{online\}/)
  assert.match(home, /busy=\{busy\}/)
  assert.match(home, /disabled=\{!canGoOnline\}/)
  assert.match(home, /disabledReason=\{gate\.body\}/)
  assert.match(home, /onPress=\{toggle\}/)
  assert.match(home, /const online = Boolean\(desk\?\.online\)/)
  assert.equal((home.match(/\bsetDriverOnline\b/g) || []).length, 2)
  assert.equal((toggle.match(/\bsetDriverOnline\b/g) || []).length, 1)
  assert.equal(home.includes('setOnline(true)'), false)
  assert.match(home, /useDriverLocation\(Boolean\(user && approved && online\)/)
})

test('toggle signs in, stops when the gate is closed, then announces the next state', () => {
  assert.match(toggle, /if \(!user\)/)
  assert.match(toggle, /router\.push\('\/sign-in'\)/)
  assert.match(toggle, /if \(!canGoOnline\)/)
  assert.match(toggle, /setError\(gate\.body\)/)
  assert.ok(toggle.indexOf('setError(gate.body)') < toggle.indexOf('setDriverOnline'))
  assert.match(toggle, /const nextOnline = !online/)
  assert.match(toggle, /await setDriverOnline\(supabase, user\.id, nextOnline\)/)
  assert.match(toggle, /if \(nextOnline\) await publishDriverCapacity\(supabase, user\.id, desk\?\.vehicle\?\.seats\)/)
  assert.match(toggle, /AccessibilityInfo\.announceForAccessibility\(nextOnline \? 'You are now online' : 'You are now offline'\)/)
  assert.match(toggle, /Could not update online status/)
  assert.match(toggle, /setBusy\(false\)/)
})

test('web DriverHome publishes online as soon as the application is approved', () => {
  const effect = web.slice(web.indexOf('useEffect(() => {\n    if (!driverId || !approved) return undefined'))
  const body = effect.slice(0, effect.indexOf('}, [driverId, approved])') + 1)
  assert.match(body, /setDriverOnline\(driverId, true\)/)
  assert.match(body, /setOnline\(true\)/)
  assert.match(body, /return \(\) => \{/)
  assert.match(body, /setDriverOnline\(driverId, false\)/)
  assert.equal(web.includes('GoButton'), false)
  assert.equal(web.includes("'END'"), false)
  assert.equal(web.includes('>GO<'), false)
})

test('web location publish forces online true while the watch is active', () => {
  assert.match(web, /if \(!driverId \|\| !approved \|\| !navigator\.geolocation\) return undefined/)
  assert.match(web, /online: true/)
  assert.match(web, /enableHighAccuracy: true, maximumAge: 5000, timeout: 15000/)
})

test('shell neighbors of GoButton keep a single accessibility label', () => {
  const circle = sliceFn(shell, 'export function CircleButton', 'export function GoButton')
  const toggleBtn = sliceFn(shell, 'export function Toggle', 'export function Segmented')
  assert.equal((circle.match(/accessibilityLabel=/g) || []).length, 1)
  assert.equal((toggleBtn.match(/accessibilityLabel=/g) || []).length, 1)
  assert.match(toggleBtn, /accessibilityRole="switch"/)
  assert.match(toggleBtn, /accessibilityState=\{\{ checked: on \}\}/)
  assert.match(circle, /accessibilityRole="button"/)
})
