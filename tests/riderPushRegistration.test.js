import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RIDER_PUSH_CHANNEL } from '../server/tripStatusNotices.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('rider app ships expo-notifications and registers into rider_push_tokens', () => {
  const app = JSON.parse(read('apps/rider/app.json')).expo
  assert.ok(app.plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-notifications'))
  assert.match(JSON.parse(read('apps/rider/package.json')).dependencies['expo-notifications'], /^~57\./)
  const push = read('apps/rider/lib/push.ts')
  assert.match(push, /from\('rider_push_tokens'\)\.upsert\(\{\s*rider_id: riderId,/)
  assert.match(push, new RegExp(`TRIP_STATUS_CHANNEL_ID = '${RIDER_PUSH_CHANNEL}'`))
  assert.doesNotMatch(push, /driver_push_tokens/)
})

test('a tapped ride push opens that trip once, and the requested screen asks for permission', () => {
  const layout = read('apps/rider/app/_layout.tsx')
  assert.match(layout, /<RiderPushBridge \/>/)
  assert.match(layout, /handledPushes\.has\(id\)/)
  assert.match(layout, /pathname: '\/requested', params: \{ trip: tripId \}/)
  assert.match(read('apps/rider/app/requested.tsx'), /registerRiderPush\(supabase, user\.id, \{ prompt: true \}\)/)
})
