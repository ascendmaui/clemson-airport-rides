import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const fileName = '20261013110000_party_night_scheduling.sql'
const sql = readFileSync(path.join(migrationsDir, fileName), 'utf8')

test('party night migration version is unique and starts at 20261013110000', () => {
  const names = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))
  const versions = names.map((name) => name.slice(0, 14))
  assert.equal(versions.filter((version) => version === '20261013110000').length, 1)
  assert.equal(names.includes(fileName), true)
  assert.equal(fileName.startsWith('20261013110000'), true)
})

test('party night migration only adds tables and stores a pre-auth hold', () => {
  const lowered = sql.toLowerCase()
  assert.match(sql, /create table if not exists public\.party_nights/)
  assert.match(sql, /create table if not exists public\.party_night_members/)
  assert.match(sql, /create table if not exists public\.party_return_queue/)
  assert.match(sql, /hold_kind = 'preauth'/)
  assert.match(sql, /not a deposit/i)
  assert.equal(lowered.includes('drop table'), false)
  assert.equal(lowered.includes('deposit_cents'), false)
  assert.equal(/alter table public\.(trips|friend_rides|payments|profiles|driver_perk_prefs)\b/i.test(sql), false)
  assert.match(sql, /enable row level security/)
  assert.match(sql, /using \(organizer_id = auth\.uid\(\)\)/)
  assert.match(sql, /using \(user_id = auth\.uid\(\)\)/)
  assert.equal(/from public\.party_night_members/i.test(sql), false)
  assert.match(sql, /party_return_queue_waiting_rider_uidx/)
})
