import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261009160000_sos_allow_arrived.sql')
const reference = read('supabase/sos_events.sql')
const definition = /create or replace function public\.can_activate_sos\(p_trip_id uuid\)[\s\S]*?\$\$;/
const normalize = (sql) => sql.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim()

test('SOS migration preserves the production function with only arrived added', () => {
  const up = migration.split('-- Down:')[0]
  const actual = up.match(definition)?.[0]
  assert.ok(actual)
  assert.equal(normalize(actual), normalize(`
    create or replace function public.can_activate_sos(p_trip_id uuid)
    returns boolean language sql stable security definer set search_path to 'public'
    as $$ select exists (select 1 from public.trips t where t.id = p_trip_id
      and t.status in ('accepted'::public.trip_status, 'arriving'::public.trip_status,
        'arrived'::public.trip_status, 'in_progress'::public.trip_status)
      and (t.rider_id = auth.uid() or t.driver_id = auth.uid())); $$;
  `))
  assert.equal(normalize(actual), normalize(reference.match(definition)[0]))
  for (const sql of [up, reference]) {
    assert.match(sql, /revoke all on function public\.can_activate_sos\(uuid\) from public;/)
    assert.match(sql, /grant execute on function public\.can_activate_sos\(uuid\) to authenticated;/)
  }
})

test('Down comment restores the previous function and its permissions', () => {
  const down = migration.split('-- Down:')[1]
  assert.ok(down)
  assert.ok(down.trim().split('\n').every((line) => line.startsWith('--')))
  const sql = down.replace(/^-- ?/gm, '').trim()
  const previous = migration.split('-- Down:')[0].match(definition)[0]
    .replace(/\s*'arrived'::public\.trip_status,/, '')
  assert.equal(normalize(sql.match(definition)[0]), normalize(previous))
  assert.match(sql, /revoke all on function public\.can_activate_sos\(uuid\) from public;/)
  assert.match(sql, /grant execute on function public\.can_activate_sos\(uuid\) to authenticated;/)
})
