import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@babel/parser'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('native shared chat exposes Report and Block through confirmation and durable storage', () => {
  const code = read('./TripThread.jsx')
  parse(code, { sourceType: 'module', plugins: ['jsx'] })
  assert.match(code, /accessibilityLabel="Report trip chat"/)
  assert.match(code, /onPress=\{confirmBlock\}/)
  assert.match(code, /Alert\.alert\('Report trip chat\?'/)
  assert.match(code, /Alert\.alert\(blocked \? 'Unblock this person\?' : 'Block this person\?'/)
  assert.match(code, /text: 'Cancel', style: 'cancel'/)
  assert.match(code, /CHAT_REPORT_REASONS\.map/)
  assert.match(code, /onLongPress=\{mine \|\| busy \|\| !role \? undefined/)
  assert.match(code, /createChatBlockStore\(secureStoreAdapter\)/)
  assert.match(code, /authedJson\(supabase, '\/api\/support-ticket'/)
  assert.match(code, /rows\.filter\([\s\S]*?blockReady && !blocked/)
  assert.match(code, /async function send[\s\S]*?\|\| !blockReady \|\| blocked\) return/)
  assert.match(code, /mode === 'compose' && role && blockReady && !blocked/)
  assert.match(code, /blocked \? 'Unblock' : 'Block'/)
  assert.match(code, /CHAT_REPORT_CONFIRMATION/)
  assert.match(code, /CHAT_SUPPORT_COPY/)
})

test('rider and driver chat surfaces render the shared moderated native thread', () => {
  for (const path of ['../../apps/rider/components/RideMessages.tsx', '../../apps/driver/app/trip.tsx', '../../apps/driver/app/trip-details.tsx']) {
    assert.match(read(path), /import \{ TripThread \} from 'rides-native\/TripThread.jsx'/)
    assert.match(read(path), /<TripThread/)
  }
})

test('web chat exposes Report and Block through confirm, filters blocked messages and gates sending', () => {
  const code = read('../../src/components/RideChat.jsx')
  parse(code, { sourceType: 'module', plugins: ['jsx'] })
  assert.match(code, /window\.confirm\(`Report trip chat\?/)
  assert.match(code, /window\.confirm\(blocked \? `Unblock this person\?/)
  assert.match(code, /onClick=\{confirmBlock\}/)
  assert.match(code, /CHAT_REPORT_REASONS\.map/)
  assert.match(code, /localStorage\.setItem/)
  assert.match(code, /authedJson\(supabase, '\/api\/support-ticket'/)
  assert.match(code, /messages\.filter\([\s\S]*?blockReady && !blocked/)
  assert.match(code, /async function transmit[\s\S]*?\|\| !blockReady \|\| blocked\) return/)
  assert.match(code, /mode === 'compose' && party && blockReady && !blocked/)
  assert.match(code, /aria-label="Report this message"/)
})
