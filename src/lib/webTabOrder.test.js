import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { WEB_BOTTOM_TABS, webBottomTabIds, webBottomTabLabels } from './webTabOrder.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('web bottom tabs are Rides, Schedule, Friends, Account', () => {
  assert.deepEqual(webBottomTabIds(), ['home', 'schedule', 'friends', 'account'])
  assert.deepEqual(webBottomTabLabels(), ['Rides', 'Schedule', 'Friends', 'Account'])
  assert.deepEqual(
    WEB_BOTTOM_TABS.map((tab) => [tab.id, tab.label, tab.icon]),
    [
      ['home', 'Rides', 'car'],
      ['schedule', 'Schedule', 'schedule'],
      ['friends', 'Friends', 'carpool'],
      ['account', 'Account', 'profile'],
    ],
  )
})

test('BottomTabs renders from the web tab order config', () => {
  const code = readFileSync(path.join(ROOT, 'src/components/BottomTabs.jsx'), 'utf8')
  assert.match(code, /WEB_BOTTOM_TABS/, 'BottomTabs imports the shared tab order')
  assert.match(code, /WEB_BOTTOM_TABS\.map/, 'BottomTabs builds its bar from that order')
  assert.doesNotMatch(code, /id:\s*['"]schedule['"]/, 'BottomTabs does not hardcode a second tab list')
})
