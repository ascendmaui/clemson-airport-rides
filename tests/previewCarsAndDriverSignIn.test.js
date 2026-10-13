import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('preview fleet cars on the rider map never carry a Busy label', () => {
  for (const file of ['apps/rider/components/CampusMap.native.tsx', 'apps/rider/components/CampusMap.tsx']) {
    const src = read(file)
    assert.doesNotMatch(src, />Busy</, file)
    // The approved demo fleet stays, with its Preview cars badge.
    assert.match(src, /SIMULATED_FLEET_BADGE/, file)
  }
})

test('driver email sign-in subtitle describes email sign-in', () => {
  const src = read('apps/driver/app/sign-in.tsx')
  assert.doesNotMatch(src, /account owner confirms/)
  assert.match(src, /subtitle="Sign in with the email and password on your driver account\."/)
})
