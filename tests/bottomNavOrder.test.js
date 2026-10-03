import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

function labels(source) {
  return [...source.matchAll(/label: '([^']+)'/g)].map((match) => match[1])
}

test('web bottom nav is rides, schedule, friends, account', () => {
  const code = read('src/components/BottomTabs.jsx')
  const ids = [...code.matchAll(/id: '([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(ids, ['home', 'schedule', 'friends', 'account'])
  assert.deepEqual(labels(code), ['Rides', 'Schedule', 'Friends', 'Account'])
})

test('web tab pages keep a top-bar back button and the bottom nav', () => {
  const pages = [
    ['src/screens/RiderHome.jsx', 'Back'],
    ['src/screens/ScheduleAirport.jsx', 'Back to home'],
    ['src/screens/FriendsAccount.jsx', 'Back to home'],
    ['src/screens/AccountScreenImpl.jsx', 'Back to home'],
  ]
  for (const [file, label] of pages) {
    const code = read(file)
    assert.match(code, /className="pressable glass-pill nav-back-btn"/, `${file} back button`)
    assert.match(code, new RegExp(`aria-label="${label}"`), `${file} back label`)
    assert.match(code, /<BottomTabs/, `${file} bottom nav`)
    const backAt = code.indexOf('nav-back-btn')
    const scrollAt = code.search(/overflow(?:Y)?:\s*'auto'|overflow:\s*'auto'/)
    assert.ok(backAt !== -1 && scrollAt !== -1 && backAt < scrollAt, `${file} back button stays above the scrolling content`)
  }
})

test('rider bottom nav is rides, schedule, friends, account', () => {
  const code = read('apps/rider/components/MainTabs.tsx')
  assert.deepEqual(labels(code), ['Rides', 'Schedule', 'Friends', 'Account'])
})

test('rider tab pages keep a top-bar back button and the bottom nav', () => {
  const pages = [
    'apps/rider/app/index.tsx',
    'apps/rider/app/schedule.tsx',
    'apps/rider/app/friends.tsx',
    'apps/rider/app/account.tsx',
  ]
  for (const file of pages) {
    const code = read(file)
    assert.match(code, /<TabBackBar/, `${file} back button`)
    assert.match(code, /<MainTabs/, `${file} bottom nav`)
  }
})
