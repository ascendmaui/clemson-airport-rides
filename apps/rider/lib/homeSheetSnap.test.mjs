import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDisplayMode, resolveScheme } from './appearance.ts'
import {
  HOME_SHEET_BOTTOM_PADDING,
  HOME_SHEET_HANDLE_FALLBACK,
  HOME_SHEET_MAP_MAX_RATIO,
  HOME_SHEET_MAP_MIN_RATIO,
  HOME_SHEET_SEARCH_FALLBACK,
  HOME_SHEET_SNAP_PROJECTION_S,
  HOME_SHEET_SPRING,
  buildHomeSheetSnapPoints,
  homeTabClearance,
  collapsedSheetHeight,
  collapsedSheetPadding,
  expandedSheetHeights,
  homeSheetSnapPoints,
  snapHomeSheet,
} from './homeSheetSnap.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8')
}

test('native tabs keep the home sheet above the tab bar and the home indicator', () => {
  assert.equal(homeTabClearance(34), 90)
  assert.equal(homeTabClearance(0), 56)
  assert.equal(homeTabClearance(Number.NaN), 56)
  const home = read('apps/rider/app/(tabs)/index.tsx')
  assert.match(home, /homeTabClearance\(insets\.bottom\)/)
  assert.match(home, /nativeTabs \? \{ paddingBottom: homeTabClearance\(insets\.bottom\) \}/)
  assert.match(home, /liveTrip \? liveCardH \+ 12 : 0/)
})

test('collapsed snap height is the search field plus padding', () => {
  assert.equal(collapsedSheetHeight(56, 20), 76)
  assert.equal(collapsedSheetHeight(106, 38), 144)
  assert.equal(collapsedSheetHeight(HOME_SHEET_SEARCH_FALLBACK, collapsedSheetPadding(HOME_SHEET_HANDLE_FALLBACK, HOME_SHEET_BOTTOM_PADDING)), 144)
  assert.equal(collapsedSheetHeight(-8, 12), 12)
  assert.equal(collapsedSheetHeight(40, -4), 40)
})

test('snap points keep a collapsed search-field height and the existing expanded map sizes', () => {
  assert.equal(HOME_SHEET_MAP_MIN_RATIO, 0.38)
  assert.equal(HOME_SHEET_MAP_MAX_RATIO, 0.64)
  assert.deepEqual(expandedSheetHeights(800, 80), [208, 416])
  assert.equal(Math.round(800 * 0.38), 304)
  assert.equal(800 - 80 - 304, 416)
  assert.equal(800 - 80 - Math.round(800 * 0.64), 208)

  const points = buildHomeSheetSnapPoints({
    windowHeight: 800,
    tabBarHeight: 80,
    searchFieldHeight: 106,
    handleHeight: 26,
    bottomPadding: HOME_SHEET_BOTTOM_PADDING,
  })
  assert.equal(points[0], collapsedSheetHeight(106, collapsedSheetPadding(26, HOME_SHEET_BOTTOM_PADDING)))
  assert.deepEqual(points, [144, 208, 416])

  assert.deepEqual(homeSheetSnapPoints({
    searchFieldHeight: 64,
    padding: 28,
    expandedHeights: [416, 50, 208, 208, Number.NaN],
  }), [92, 208, 416])
})

test('release snaps to collapsed or expanded from velocity and position', () => {
  const snapPoints = [144, 208, 416]
  assert.equal(HOME_SHEET_SNAP_PROJECTION_S, 0.35)

  const resting = (position) => snapHomeSheet({ position, velocity: 0, snapPoints })
  assert.deepEqual(resting(150), { height: 144, detent: 'collapsed' })
  assert.deepEqual(resting(190), { height: 208, detent: 'expanded' })
  assert.deepEqual(resting(400), { height: 416, detent: 'expanded' })
  // Exactly between collapsed and the shorter expanded sheet, stay expanded.
  assert.deepEqual(resting(176), { height: 208, detent: 'expanded' })

  // Same spot, opposite flicks: down collapses, up opens the full sheet.
  assert.deepEqual(snapHomeSheet({ position: 200, velocity: 400, snapPoints }), { height: 144, detent: 'collapsed' })
  assert.deepEqual(snapHomeSheet({ position: 200, velocity: -800, snapPoints }), { height: 416, detent: 'expanded' })

  // Same downward speed lands on different detents depending on where the finger is.
  assert.deepEqual(snapHomeSheet({ position: 416, velocity: 500, snapPoints }), { height: 208, detent: 'expanded' })
  assert.deepEqual(snapHomeSheet({ position: 180, velocity: 500, snapPoints }), { height: 144, detent: 'collapsed' })

  // A firm swipe down from the open sheet leaves only the collapsed search field.
  assert.deepEqual(snapHomeSheet({ position: 416, velocity: 2000, snapPoints }), { height: 144, detent: 'collapsed' })
  // A firm swipe up from the peek opens the tallest expanded sheet.
  assert.deepEqual(snapHomeSheet({ position: 144, velocity: -2000, snapPoints }), { height: 416, detent: 'expanded' })

  assert.deepEqual(snapHomeSheet({ position: 10, velocity: Number.NaN, snapPoints: [] }), { height: 0, detent: 'collapsed' })
  assert.deepEqual(snapHomeSheet({ position: 80, velocity: 50, snapPoints: [80] }), { height: 80, detent: 'collapsed' })
})

test('the spring config is a clamped UI-thread spring', () => {
  assert.equal(typeof HOME_SHEET_SPRING.damping, 'number')
  assert.equal(typeof HOME_SHEET_SPRING.stiffness, 'number')
  assert.equal(HOME_SHEET_SPRING.overshootClamping, true)
})

test('worklet helpers are declared before the worklets that call them', () => {
  // The worklets plugin captures callees by value at initialization. Node's
  // test runner loads the TypeScript as-is, so a later helper still works
  // here. The declaration order is what Hermes actually executes.
  const source = read('apps/rider/lib/homeSheetSnap.ts')
  const at = (name) => {
    const index = source.search(new RegExp(`function ${name}\\b`))
    assert.notEqual(index, -1, `${name} is declared`)
    return index
  }
  const before = (helper, caller) => {
    assert.ok(at(helper) < at(caller), `${helper} is declared before ${caller}`)
  }

  before('sortAscending', 'expandedSheetHeights')
  before('sortAscending', 'homeSheetSnapPoints')
  before('sortAscending', 'finiteSorted')
  before('pushUnique', 'homeSheetSnapPoints')
  before('pushUnique', 'finiteSorted')
  before('nearestSnap', 'snapHomeSheet')
  before('finiteSorted', 'snapHomeSheet')
  before('collapsedSheetHeight', 'homeSheetSnapPoints')
  before('collapsedSheetHeight', 'buildHomeSheetSnapPoints')
  before('collapsedSheetPadding', 'buildHomeSheetSnapPoints')
  before('expandedSheetHeights', 'buildHomeSheetSnapPoints')
  before('homeSheetSnapPoints', 'buildHomeSheetSnapPoints')
})

test('rider home wires the snap helper through gesture-handler and does not touch the driver swipe', () => {
  const home = read('apps/rider/app/(tabs)/index.tsx')
  const hook = read('apps/rider/lib/useHomeSheetSnap.ts')
  const swipe = read('apps/driver/components/SwipeToStart.tsx')
  assert.match(home, /useHomeSheetSnap/)
  assert.match(home, /expandFromSearch/)
  assert.doesNotMatch(home, /PanResponder/)
  assert.match(hook, /from 'react-native-gesture-handler'/)
  assert.match(hook, /withSpring\([^)]*HOME_SHEET_SPRING/)
  assert.match(hook, /snapHomeSheet\(/)
  assert.match(hook, /tapHaptic/)
  assert.match(hook, /collapsedSheetHeight|buildHomeSheetSnapPoints/)
  assert.match(swipe, /PanResponder/)
  assert.doesNotMatch(swipe, /homeSheetSnap|useHomeSheetSnap/)
})

test('appearance defaults to the system scheme and keeps explicit overrides', () => {
  assert.equal(readDisplayMode(undefined), 'auto')
  assert.equal(readDisplayMode('nope'), 'auto')
  assert.equal(readDisplayMode('auto'), 'auto')
  assert.equal(readDisplayMode('light'), 'light')
  assert.equal(readDisplayMode('dark'), 'dark')
  assert.equal(resolveScheme('auto', 'dark'), 'dark')
  assert.equal(resolveScheme('auto', 'light'), 'light')
  assert.equal(resolveScheme('auto', null), 'light')
  assert.equal(resolveScheme('auto', undefined), 'light')
  assert.equal(resolveScheme('light', 'dark'), 'light')
  assert.equal(resolveScheme('dark', 'light'), 'dark')
  const theme = read('apps/rider/lib/theme.tsx')
  assert.match(theme, /useColorScheme/)
  assert.match(theme, /displayMode: 'auto'/)
  assert.match(theme, /readDisplayMode\(parsed\.displayMode\)/)
  assert.doesNotMatch(theme, /it now opens light/)
})

test('xxx large type keeps the home headline inside the scrolling sheet', () => {
  const home = read('apps/rider/app/(tabs)/index.tsx')
  const scrollAt = home.indexOf('<ScrollView')
  const promptAt = home.indexOf('Where are you headed, Tiger?')
  assert.ok(scrollAt > 0 && promptAt > scrollAt, 'headline scrolls with the sheet')
  assert.match(home, /maxFontSizeMultiplier=\{DENSE_FONT_SCALE\}/)
  assert.match(home, /numberOfLines=\{3\}/)
  assert.match(home, /numberOfLines=\{2\}/)
  assert.match(home, /height: insets\.top/)
  assert.match(home, /minWidth: 0/)
})
