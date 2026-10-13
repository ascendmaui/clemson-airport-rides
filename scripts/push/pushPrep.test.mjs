import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { deliverTestPush, loadStoredPushTokens, redactToken } from './test-push.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('setup-apns.sh uploads with eas credentials and never builds', () => {
  const script = read('scripts/push/setup-apns.sh')
  assert.match(script, /eas credentials/)
  assert.match(script, /L85AF3V872/)
  assert.match(script, /d02319c9-69ef-4523-a0a5-6712c037d5fa/)
  assert.match(script, /090d10b8-2f52-4502-ac9d-e8bd0fe35033/)
  assert.match(script, /com\.ascendmaui\.clemsonrides\.rider/)
  assert.match(script, /com\.ascendmaui\.clemsonrides\.driver/)
  assert.match(script, /CPH2DULQHJ/)
  assert.match(script, /AuthKey_\(\[A-Z0-9\]\{10\}\)/)
  assert.doesNotMatch(script, /\beas build\b/)
  assert.doesNotMatch(script, /prebuild/)
  assert.match(script, /readFileSync\(process\.argv\[1\]/)
  assert.doesNotMatch(script, /writeFile|sed .*app\.json|> *.*app\.json/)
  const wrongTeam = spawnSync('bash', [
    'scripts/push/setup-apns.sh',
    '--p8', '/tmp/AuthKey.p8',
    '--key-id', 'AB12CD34EF',
    '--team-id', 'OTHERTEAM1',
  ], { cwd: root, encoding: 'utf8' })
  assert.equal(wrongTeam.status, 2)
  assert.match(wrongTeam.stderr, /L85AF3V872/)
  assert.doesNotMatch(`${wrongTeam.stdout}\n${wrongTeam.stderr}`, /eas-cli whoami|eas whoami/)
})

test('the APNs prompt driver walks the credentials menu and refuses a build', () => {
  const result = spawnSync('python3', ['scripts/push/apns_prompts.py', '--self-test'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /self-test ok/)
  const driver = read('scripts/push/apns_prompts.py')
  assert.match(driver, /"credentials", "--platform", "ios"/)
  assert.match(driver, /refusing to run/)
  assert.doesNotMatch(driver, /execvp\(\s*\[.*build/)
})

test('the runbook and receipt migration stay ops-only', () => {
  const runbook = read('docs/push-runbook.md')
  assert.match(runbook, /5 minute/)
  assert.match(runbook, /setup-apns\.sh/)
  assert.match(runbook, /test-push\.ts/)
  assert.match(runbook, /L85AF3V872/)
  assert.match(runbook, /CPH2DULQHJ/)
  assert.match(runbook, /already assigned/)
  assert.match(runbook, /mode/)
  const sql = read('supabase/migrations/20261013270000_expo_push_tickets_OPS_APPLY_.sql')
  assert.match(sql, /OPS_APPLY/)
  assert.match(sql, /grant all on public\.expo_push_tickets to service_role/)
  assert.match(sql, /revoke all on public\.expo_push_tickets from public, anon, authenticated/)
  assert.doesNotMatch(sql, /to authenticated/)
})

function fakeSb(tables) {
  return {
    from(table) {
      const filters = []
      const api = {
        select() { return api },
        eq(col, value) { filters.push([col, value]); return api },
        maybeSingle() {
          const rows = (tables[table] || []).filter((row) => filters.every(([col, value]) => row[col] === value))
          return Promise.resolve({ data: rows[0] || null, error: table === 'driver_status' ? { message: 'schema cache' } : null })
        },
        then(resolve) {
          const rows = (tables[table] || []).filter((row) => filters.every(([col, value]) => row[col] === value))
          resolve({ data: rows, error: null })
        },
      }
      return api
    },
  }
}

test('the test push reads stored tokens, sends, and prints receipts without the raw token', async () => {
  const sb = fakeSb({
    rider_push_tokens: [{ rider_id: 'user-1', token: 'ExponentPushToken[rider]', platform: 'ios' }],
    driver_push_tokens: [{ driver_id: 'user-1', token: 'ExponentPushToken[driver]', platform: 'ios' }],
    driver_status: [{ driver_id: 'user-1', expo_push_token: 'ExponentPushToken[driver]' }],
  })
  const tokens = await loadStoredPushTokens(sb, 'user-1')
  assert.deepEqual(tokens.map((row) => row.source), ['rider_push_tokens', 'driver_push_tokens'])
  assert.equal(redactToken(tokens[0].token).includes('rider'), false)
  let posts = 0
  const report = await deliverTestPush({
    tokens,
    attempts: 2,
    waitMs: 5,
    sleep: async () => {},
    fetchImpl: async (url) => {
      posts += 1
      if (String(url).includes('getReceipts')) {
        return { ok: true, status: 200, json: async () => ({ data: { 'ticket-r': { status: 'ok' }, 'ticket-d': { status: 'ok' } } }) }
      }
      const id = posts === 1 ? 'ticket-r' : 'ticket-d'
      return { ok: true, status: 200, json: async () => ({ data: [{ status: 'ok', id }] }) }
    },
  })
  assert.equal(report.sends.length, 2)
  assert.deepEqual(report.pending, [])
  assert.equal(report.receipts['ticket-r'].status, 'ok')
  assert.equal(JSON.stringify(report).includes('ExponentPushToken'), false)
})
