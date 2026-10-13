import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  GLASS_AA,
  GLASS_LAYERS,
  GLASS_ORANGE,
  GLASS_PRESS,
  GLASS_PURPLE,
  glassCatalog,
  glassContrastFailures,
  glassFill,
  glassRecipe,
  glassShowsStreak,
  worstContrast,
} from './tokens.js'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

test('liquid glass plates keep WCAG AA text on light and dark maps', () => {
  assert.equal(GLASS_ORANGE, '#F56600')
  assert.equal(GLASS_PURPLE, '#522D80')
  assert.equal(GLASS_AA, 4.5)
  const failures = glassContrastFailures()
  assert.deepEqual(failures, [])
  const catalog = glassCatalog()
  assert.ok(catalog.length >= 32)
  for (const row of catalog) {
    assert.ok(worstContrast(row.recipe.text, row.recipe.plate) >= GLASS_AA, `${row.app} ${row.scheme} ${row.variant} ${row.accent}`)
    if (row.app === 'rider') assert.equal(row.recipe.tint, GLASS_ORANGE)
    if (row.app === 'driver' && row.accent === 'purple') assert.equal(row.recipe.tint, GLASS_PURPLE)
    if (row.accent === 'orange') assert.equal(row.recipe.tint, GLASS_ORANGE)
  }
  const rider = glassRecipe({ app: 'rider', scheme: 'light', variant: 'primary' })
  const driver = glassRecipe({ app: 'driver', scheme: 'dark', variant: 'surface' })
  assert.match(glassFill(rider), /236,98,8/)
  assert.match(glassFill(driver), /28,18,42/)
})

test('glass primitives draw blur, specular, streak, border, and UI-thread press', () => {
  const surface = read('./GlassSurface.jsx')
  const button = read('./GlassButton.jsx')
  const card = read('./GlassCard.jsx')
  const sheet = read('./GlassSheet.jsx')
  const index = read('./index.js')
  assert.deepEqual([...GLASS_LAYERS], ['shadow', 'blur', 'tint', 'specular', 'streak', 'border'])
  assert.match(surface, /BlurView/)
  assert.match(surface, /styles\.fallback/)
  assert.match(surface, /backgroundColor: fill/)
  assert.match(surface, /GlassSheen/)
  assert.match(surface, /styles\.specular/)
  assert.match(surface, /styles\.streak/)
  assert.match(surface, /rotate: '-32deg'/)
  assert.match(surface, /glassShowsStreak/)
  assert.match(surface, /showStreak \?/)
  assert.equal(glassShowsStreak({ variant: 'primary', accent: 'orange' }), false)
  assert.equal(glassShowsStreak({ variant: 'fab', accent: 'orange' }), false)
  assert.equal(glassShowsStreak({ variant: 'chip', accent: 'orange' }), false)
  assert.equal(glassShowsStreak({ variant: 'primary', accent: 'purple' }), true)
  assert.equal(glassShowsStreak({ variant: 'fab', accent: 'purple' }), true)
  assert.equal(glassShowsStreak({ variant: 'surface', accent: 'orange' }), true)
  assert.equal(glassShowsStreak({ variant: 'header', accent: 'orange' }), true)
  assert.equal(glassShowsStreak({ variant: 'sheet', accent: 'orange' }), true)
  const green = glassRecipe({ app: 'driver', scheme: 'light', variant: 'fab', accent: 'green' })
  assert.ok(worstContrast(green.text, green.plate) >= GLASS_AA)
  const greenDark = glassRecipe({ app: 'driver', scheme: 'dark', variant: 'fab', accent: 'green' })
  assert.ok(worstContrast(greenDark.text, greenDark.plate) >= GLASS_AA)
  assert.match(surface, /borderTopColor/)
  assert.match(surface, /ambientShadow/)
  assert.match(surface, /contactShadow/)
  assert.match(button, /useAnimatedStyle/)
  assert.match(button, /useSharedValue/)
  assert.match(button, /withTiming/)
  assert.match(button, /withSpring/)
  assert.match(button, /useReduceMotion/)
  assert.match(button, /GLASS_PRESS\.scale/)
  assert.match(button, /GLASS_PRESS\.opacityDip/)
  assert.match(button, /pressed\.value = reduce \? 1/)
  assert.match(button, /export function GlassButton/)
  assert.match(card, /export function GlassCard/)
  assert.match(card, /variant="surface"/)
  assert.match(sheet, /export function GlassSheet/)
  assert.match(sheet, /variant="sheet"/)
  assert.match(sheet, /edges="top"/)
  assert.match(index, /GlassButton/)
  assert.match(index, /GlassCard/)
  assert.match(index, /GlassSheet/)
  assert.equal(GLASS_PRESS.scale, 0.96)
  assert.equal(GLASS_PRESS.opacityDip, 0.12)
  assert.equal(GLASS_PRESS.durationMs, 120)
})

test('rider and driver chrome mount the shared glass primitives', () => {
  const riderButton = read('../../../apps/rider/components/Button.tsx')
  const riderHeader = read('../../../apps/rider/components/StackHeader.tsx')
  const riderTabs = read('../../../apps/rider/components/MainTabs.tsx')
  const driverChrome = read('../../../apps/driver/components/chrome.tsx')
  const driverShell = read('../../../apps/driver/components/shell.tsx')
  const swipe = read('../../../apps/driver/components/SwipeToStart.tsx')
  const driverTabs = read('../../../apps/driver/app/(tabs)/_layout.tsx')
  const tabBar = read('../icons/GlassTabBar.jsx')
  assert.match(riderButton, /GlassButton/)
  assert.match(riderButton, /app="rider"/)
  assert.match(riderHeader, /GlassButton/)
  assert.match(riderTabs, /app="rider"/)
  assert.match(driverChrome, /GlassButton/)
  assert.match(driverChrome, /GlassCard/)
  assert.match(driverChrome, /app="driver"/)
  assert.match(driverShell, /GlassButton/)
  assert.match(driverShell, /\{online \? 'END' : 'GO'\}/)
  assert.match(swipe, /GlassSheen/)
  assert.match(swipe, /Gesture\.Pan\(\)/)
  assert.doesNotMatch(swipe, /onPress=/)
  assert.match(driverTabs, /app="driver"/)
  assert.match(tabBar, /GlassSheen/)
  assert.match(tabBar, /#522D80/)
  assert.match(tabBar, /#F56600/)
})

test('gesture root and the Reanimated babel preset stay in the right order', () => {
  for (const app of ['rider', 'driver']) {
    const layout = read(`../../../apps/${app}/app/_layout.tsx`)
    const babel = read(`../../../apps/${app}/babel.config.js`)
    const code = babel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.match(layout, /<GestureHandlerRootView/)
    assert.match(layout, /<\/GestureHandlerRootView>/)
    assert.match(code, /presets: \['babel-preset-expo'\]/)
    assert.doesNotMatch(code, /react-native-reanimated\/plugin/)
    assert.doesNotMatch(code, /react-native-worklets\/plugin/)
    assert.doesNotMatch(code, /plugins:/)
  }
})
