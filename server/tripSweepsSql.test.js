import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const sql = read('20261009150000_trip_sweeps_cron.sql')

test('trip sweeps cron uses the existing secured Vault and pg_net pattern', () => {
  const reference = read('20261004151000_matching_rebroadcast_cron.sql')
  const normalize = (value) => value.replace(/^--.*$/gm, '').replace(/\s+/g, ' ').trim()
  const expected = reference.replaceAll('matching_rebroadcast', 'trip_sweeps')
    .replaceAll('matching-rebroadcast', 'trip-sweeps').replaceAll('rebroadcast-offers', 'trip-sweeps')
  assert.equal(normalize(sql), normalize(expected))
  assert.match(sql, /security definer\s+set search_path = ''/i)
  assert.match(sql, /name = 'clemson_cron_secret'/)
  assert.match(sql, /https:\/\/clemsonrides.com\/api\/driver\?action=trip-sweeps/)
  assert.match(sql, /revoke all on function private\.trigger_trip_sweeps\(\) from public/)
  assert.match(sql, /cron\.unschedule\('trip-sweeps'\)/)
  assert.match(sql, /cron\.schedule\(\s*'trip-sweeps',\s*'\* \* \* \* \*'/)
})

test('trip sweeps cron includes a reversible Down comment', () => {
  assert.match(sql, /-- Down:\s*-- select cron\.unschedule\('trip-sweeps'\);\s*-- drop function if exists private\.trigger_trip_sweeps\(\);/)
})
