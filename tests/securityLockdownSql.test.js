import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../supabase/migrations/20261014233000_security_lockdown.sql', import.meta.url), 'utf8')
const grants = [...sql.matchAll(/grant execute on function public\.([a-z0-9_]+)\([^)]*\) to ([a-z_, ]+);/g)]
  .map(([, name, roles]) => ({ name, roles: roles.split(',').map((r) => r.trim()) }))

test('only intentionally public definer functions are granted to anon', () => {
  const anon = grants.filter((g) => g.roles.includes('anon')).map((g) => g.name).sort()
  assert.deepEqual(anon, ['get_live_share', 'public_ride_demand_coarse'])
})

test('server-only money / reward functions are service_role only', () => {
  for (const name of ['claim_signup_reward', 'grant_referral_credits', 'merge_trip_metadata', 'trip_wait_apply',
    'claim_driver_cashout', 'settle_driver_cashout', 'grant_rider_social_for_trip', 'apply_trip_flight_status']) {
    const g = grants.filter((x) => x.name === name)
    assert.equal(g.length, 1, name)
    assert.deepEqual(g[0].roles, ['service_role'], name)
  }
})

test('trigger functions get no RPC grant', () => {
  for (const name of ['trg_apply_driver_incentives', 'trg_trips_grant_referral_credits', 'refresh_rider_credit_balance',
    'guard_driver_application', 'enforce_driver_online_approval', 'protect_profile_privileges']) {
    assert.equal(grants.some((g) => g.name === name), false, name)
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\(\\) from service_role;`))
  }
})

test('every revoked function pins search_path', () => {
  const revoked = new Set([...sql.matchAll(/revoke execute on function public\.([a-z0-9_]+)\(/g)].map((m) => m[1]))
  for (const name of revoked) assert.match(sql, new RegExp(`alter function public\\.${name}\\([^)]*\\) set search_path = public,[^;]*pg_temp;`), name)
})

test('sole admin is enforced and caller checks exist', () => {
  assert.match(sql, /admin_users_sole_admin[\s\S]*lower\(email\) = 'johnmatveyev@gmail\.com'/)
  assert.match(sql, /auth\.uid\(\) is distinct from p_profile_id/)
  assert.match(sql, /drop policy if exists payments_rider_insert/)
  assert.match(sql, /drop policy if exists location_shares_select_public_active/)
  assert.match(sql, /revoke all on table public\.profiles from anon/)
})
