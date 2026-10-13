import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const sql = readFileSync(new URL('../supabase/migrations/20261009030000_driver_push_tokens.sql', import.meta.url), 'utf8')

test('push storage is additive, private, and supports the shipped upsert', () => {
  assert.match(sql, /create table if not exists public\.driver_push_tokens/i)
  assert.match(sql, /driver_id uuid primary key references auth\.users\(id\) on delete cascade/i)
  assert.match(sql, /token text not null/i)
  assert.match(sql, /platform text/i)
  for (const col of ['updated_at', 'created_at']) assert.match(sql, new RegExp(`${col} timestamptz not null default now\\(\\)`, 'i'))
  assert.match(sql, /enable row level security/i)
  for (const op of ['select', 'insert', 'update', 'delete']) {
    assert.match(sql, new RegExp(`drop policy if exists driver_push_tokens_own_${op}`, 'i'))
    const condition = op === 'insert' ? 'with check' : 'using'
    assert.match(sql, new RegExp(`for ${op} to authenticated ${condition} \\(driver_id = auth\\.uid\\(\\)\\)`, 'i'))
  }
  assert.match(sql, /for update[^;]*with check \(driver_id = auth\.uid\(\)\)/i)
  assert.match(sql, /revoke all on public\.driver_push_tokens from public, anon/i)
  assert.match(sql, /grant select, insert, update, delete on public\.driver_push_tokens to authenticated/i)
  assert.match(sql, /grant all on public\.driver_push_tokens to service_role/i)
  assert.doesNotMatch(sql, /alter table public\.driver_status|expo_push_token/i)
  assert.doesNotMatch(sql, /add table public\.driver_push_tokens/i)
})

test('trips realtime addition checks table, publication, and existing membership', () => {
  assert.match(sql, /to_regclass\('public\.trips'\) is null/i)
  assert.match(sql, /if exists \(select 1 from pg_publication where pubname = 'supabase_realtime'\)/i)
  assert.match(sql, /and not exists\s*\([\s\S]*pg_publication_tables[\s\S]*schemaname = 'public'[\s\S]*tablename = 'trips'/i)
  assert.match(sql, /alter publication supabase_realtime add table public\.trips/i)
})
