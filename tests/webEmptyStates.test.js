import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const __filename = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename), '..')

function readSource(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8')
}

test('RidesHistory.jsx renders an accessible and actionable empty state', () => {
  const code = readSource('src/screens/RidesHistory.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'RidesHistory parses cleanly')

  // Accessible container attributes
  assert.match(code, /role="status"/, 'empty state has role="status"')
  assert.match(code, /aria-live="polite"/, 'empty state announces politely to screen readers')

  // Informative copy and icon
  assert.match(code, /No completed rides yet/, 'includes helpful empty state heading')
  assert.match(code, /After a trip finishes/, 'explains when rides will appear')

  // Actionable CTA button
  assert.match(code, /Book your first ride/, 'provides actionable CTA button for riders')
  assert.match(code, /navigate\('home'\)/, 'wires CTA button to return to home/booking screen')
})

test('ScheduledRideQueue.jsx provides accessible driver queue empty states', () => {
  const code = readSource('src/components/ScheduledRideQueue.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'ScheduledRideQueue parses cleanly')

  // Status role and label
  assert.match(code, /role="status"/, 'driver empty state has role="status"')
  assert.match(code, /aria-label=\{`\$\{title\}\s+empty`\}/, 'empty state provides descriptive aria-label')

  // Friendly fallback and customizable hint
  assert.match(code, /No scheduled rides available right now/, 'includes default friendly explanation')
  assert.match(code, /emptyHint\s*\|\|/, 'allows callers to customize empty hint text')
  assert.match(code, /emptyAction/, 'supports rendering optional emptyAction CTA')
})

test('CarpoolHub.jsx provides polite waiting and unavailable status announcements', () => {
  const code = readSource('src/screens/CarpoolHub.jsx')

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx'],
  })
  assert.ok(ast, 'CarpoolHub parses cleanly')

  // Waiting queue empty state
  assert.match(code, /result\?\.pool\?\.waiting/, 'checks waiting pool result')
  assert.match(code, /role="status"\s+aria-live="polite"/, 'waiting queue status announces politely')
  assert.match(code, /You are in the queue/, 'indicates user is waiting for carpool matches')

  // Queue unavailable state
  assert.match(code, /result\?\.code === 'queue_unavailable'/, 'handles queue_unavailable response code')
  assert.match(code, /Prices are ready\. The live queue is not\./, 'displays polite service status')
})
