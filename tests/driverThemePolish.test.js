import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { migrateAppearance, readDisplayMode, resolveScheme } from '../apps/driver/lib/appearance.ts'
import { color, motion, motionDuration, radius, type } from '../packages/rides-native/shared/theme.js'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('shared tokens are the rider cream, orange, and purple scale', () => {
  assert.equal(color.surface, '#F7F4F0')
  assert.equal(color.orange, '#F56600')
  assert.equal(color.purple, '#522D80')
  assert.equal(radius.lg, 18)
  assert.equal(radius.xl, 22)
  assert.equal(radius.sheet, 28)
  assert.equal(type.button.letterSpacing, -0.2)
  assert.equal(type.title.letterSpacing, -0.4)
  assert.equal(motionDuration(motion.enterFadeMs, false), 320)
  assert.equal(motionDuration(motion.enterRiseMs, true), 0)
})

test('driver chrome, stack pages, and motion use the shared tokens', () => {
  const chrome = read('apps/driver/components/chrome.tsx')
  const shell = read('apps/driver/components/shell.tsx')
  const enter = read('apps/driver/lib/enterMotion.tsx')
  const day = read('apps/driver/components/day.tsx')
  assert.match(chrome, /rides-native\/shared\/theme\.js/)
  assert.match(chrome, /radius\.lg/)
  assert.match(chrome, /typeScale\.button/)
  assert.match(chrome, /shadowStyle/)
  assert.match(shell, /<Enter/)
  assert.match(shell, /typeScale\.headline/)
  assert.match(enter, /motion\.enterFadeMs/)
  assert.match(enter, /useReduceMotion/)
  assert.match(enter, /Easing\.out\(Easing\.cubic\)/)
  assert.match(day, /<Enter/)
})

test('listed driver surfaces pick up the shared type and radius scale', () => {
  const files = [
    'apps/driver/app/onboarding.tsx',
    'apps/driver/app/documents.tsx',
    'apps/driver/app/safety.tsx',
    'apps/driver/app/(tabs)/earnings.tsx',
    'apps/driver/app/tax.tsx',
    'apps/driver/app/payouts.tsx',
    'apps/driver/app/vehicles.tsx',
    'apps/driver/app/trip.tsx',
    'apps/driver/components/EarningsBoard.tsx',
    'apps/driver/components/RiderConfirmCard.tsx',
    'apps/driver/components/TripEndSummary.tsx',
  ]
  for (const file of files) {
    const source = read(file)
    assert.match(source, /rides-native\/shared\/theme\.js/, file)
  }
  assert.match(read('apps/driver/app/documents.tsx'), /VEHICLE CHECK/)
  assert.match(read('apps/driver/app/safety.tsx'), /radius\.lg/)
  assert.match(read('packages/rides-native/SafetyDeck.jsx'), /useReduceMotion/)
  assert.match(read('packages/rides-native/AudioCaptureCard.jsx'), /radius\.lg/)
})

test('gesture and cluster logic stay in place', () => {
  const home = read('apps/driver/app/(tabs)/index.tsx')
  const shell = read('apps/driver/components/shell.tsx')
  const swipe = read('apps/driver/components/SwipeToStart.tsx')
  assert.match(shell, /\{online \? 'END' : 'GO'\}/)
  assert.match(home, /styles\.clutter/)
  assert.match(home, /withSpring\(homeClutterTranslateY\(true, windowHeight\), HOME_CLUTTER_SPRING\)/)
  assert.match(home, /homeClutterTranslateY\(false\)/)
  // Gesture-handler pan, not a tap. The knob logic stays with the slider.
  assert.match(swipe, /Gesture\.Pan\(\)/)
  assert.match(swipe, /onUpdate/)
  assert.doesNotMatch(swipe, /onPress=/)
  assert.match(home, /useReduceMotion/)
})

function channel(hex, index) {
  const raw = hex.replace('#', '')
  const value = parseInt(raw.slice(index, index + 2), 16) / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function contrast(fg, bg) {
  const lum = (hex) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 2) + 0.0722 * channel(hex, 4)
  const lighter = Math.max(lum(fg), lum(bg))
  const darker = Math.min(lum(fg), lum(bg))
  return (lighter + 0.05) / (darker + 0.05)
}

test('driver appearance follows the system scheme unless Light or Dark is saved', () => {
  assert.equal(readDisplayMode(undefined), 'auto')
  assert.equal(readDisplayMode('light'), 'light')
  assert.equal(resolveScheme('auto', 'dark'), 'dark')
  assert.equal(resolveScheme('auto', null), 'light')
  assert.equal(resolveScheme('dark', 'light'), 'dark')
  const theme = read('apps/driver/lib/theme.tsx')
  const settings = read('apps/driver/app/settings/[section].tsx')
  const index = read('apps/driver/app/settings/index.tsx')
  assert.match(theme, /useColorScheme/)
  assert.match(theme, /displayMode: 'auto'/)
  assert.match(theme, /migrateAppearance\(parsed\)/)
  assert.match(theme, /appearanceMigrated: true/)
  assert.doesNotMatch(theme, /it now opens light/)
  assert.deepEqual(migrateAppearance({ displayMode: 'dark' }), { displayMode: 'auto', appearanceMigrated: true })
  assert.deepEqual(migrateAppearance({ displayMode: 'dark', appearanceMigrated: true }), { displayMode: 'dark', appearanceMigrated: true })
  assert.deepEqual(migrateAppearance(null), { displayMode: 'auto', appearanceMigrated: true })
  assert.match(settings, /System follows this phone/)
  assert.doesNotMatch(index, /sunrise and sunset/)
})

test('driver dark surfaces keep the fare card, checklist, icons, and demand readable', () => {
  assert.ok(contrast('#D4C4F0', '#16121F') >= 3)
  assert.ok(contrast(color.purple, '#FFFFFF') >= 3)
  assert.ok(contrast('#F5F6F8', '#16121F') >= 4.5)
  const home = read('apps/driver/app/(tabs)/index.tsx')
  const surge = read('packages/rides-native/GameDayBoard.jsx')
  const status = read('apps/driver/components/DriverStatusCard.tsx')
  const menu = read('apps/driver/app/(tabs)/menu.tsx')
  const map = read('apps/driver/components/CampusMap.native.tsx')
  assert.match(home, /colors=\{colors\}/)
  assert.ok(home.indexOf('<GameDaySurgeLine') < home.indexOf('<GoButton'))
  assert.match(home, /backgroundColor: colors\.card/)
  assert.match(home, /Busy areas, peak, and live demand/)
  assert.match(surge, /colors\?\.card \|\| TICKET/)
  assert.match(surge, /#F56600|colors\.orange/)
  assert.match(status, /backgroundColor: colors\.card/)
  assert.doesNotMatch(status, /<Card/)
  assert.match(read('apps/driver/components/shell.tsx'), /color=\{colors\.link\}/)
  assert.match(read('apps/driver/components/day.tsx'), /color=\{colors\.link\}/)
  assert.match(menu, /offerSheetBottomInset\(insets\.bottom\)/)
  assert.match(menu, /Busy spots, game days, and boosts/)
  assert.match(map, /color: heat\.title/)
  assert.match(home, /paddingBottom: dockHeight \+ tabClearance/)
  assert.match(home, /marginTop: insets\.top/)
  assert.match(home, /styles\.legendRow/)
  assert.match(home, />Demand</)
  assert.doesNotMatch(home, /maxHeight: 400/)
  const deleteAt = menu.indexOf('>Delete account</Text>')
  const gated = menu.slice(menu.lastIndexOf('{user ? (', deleteAt), deleteAt)
  assert.match(gated, /router\.push\('\/delete-account'\)/)
  assert.match(read('apps/driver/lib/palette.ts'), /legend: '#16121F'/)
  assert.match(read('apps/driver/lib/palette.ts'), /legend: '#FFFFFF'/)
})
