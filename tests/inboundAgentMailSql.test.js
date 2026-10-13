import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const fileName = '20261013230000_inbound_agent_mail.sql'
const migration = readFileSync(new URL(`../supabase/migrations/${fileName}`, import.meta.url), 'utf8')

async function apply(db) {
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
    end $$;
  `)
  await db.exec(migration)
  await db.exec(migration)
}

test('inbound agent mail migration is additive, unique, and service role only', async () => {
  const executable = migration.replace(/--.*$/gm, '')
  assert.equal(/drop table/i.test(executable), false)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /grant all on table public\.inbound_agent_mail to service_role/)
  assert.match(migration, /constraint inbound_agent_mail_message_id_key unique \(message_id\)/)
  assert.match(migration, /status text not null default 'new'/)
  assert.match(fileName, /^20261013230000_/)

  const db = new PGlite()
  try {
    await apply(db)

    const flags = await db.query(`
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'inbound_agent_mail'
    `)
    assert.equal(flags.rows[0].relrowsecurity, true)

    const policies = await db.query(`
      select count(*)::int as n
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      where c.relname = 'inbound_agent_mail'
    `)
    assert.equal(policies.rows[0].n, 0)

    const columns = await db.query(`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'inbound_agent_mail'
      order by ordinal_position
    `)
    assert.deepEqual(columns.rows.map((row) => row.column_name), [
      'id',
      'received_at',
      'message_id',
      'from',
      'to',
      'subject',
      'snippet',
      'raw',
      'status',
    ])

    assert.equal((await db.query(`select has_table_privilege('anon', 'public.inbound_agent_mail', 'select') as ok`)).rows[0].ok, false)
    assert.equal((await db.query(`select has_table_privilege('authenticated', 'public.inbound_agent_mail', 'insert') as ok`)).rows[0].ok, false)
    assert.equal((await db.query(`select has_table_privilege('service_role', 'public.inbound_agent_mail', 'select') as ok`)).rows[0].ok, true)
    assert.equal((await db.query(`select has_table_privilege('service_role', 'public.inbound_agent_mail', 'insert') as ok`)).rows[0].ok, true)
    assert.equal((await db.query(`select has_table_privilege('service_role', 'public.inbound_agent_mail', 'update') as ok`)).rows[0].ok, true)
    assert.equal((await db.query(`select has_table_privilege('service_role', 'public.inbound_agent_mail', 'delete') as ok`)).rows[0].ok, true)

    await db.exec('set role anon')
    await assert.rejects(() => db.query('select * from public.inbound_agent_mail'), /permission denied/i)
    await db.exec('reset role')

    await db.exec('set role authenticated')
    await assert.rejects(() => db.query('select * from public.inbound_agent_mail'), /permission denied/i)
    await db.exec('reset role')

    await db.exec('set role service_role')
    await db.query(`
      insert into public.inbound_agent_mail (message_id, "from", "to", subject, snippet, raw)
      values ('<id@example>', 'ada@example.com', 'agents@clemsonrides.com', 'Hi', 'Hello', '{"event":"message.received"}'::jsonb)
    `)
    const row = await db.query(`
      select status, "from", "to", received_at is not null as has_received
      from public.inbound_agent_mail
      where message_id = '<id@example>'
    `)
    assert.equal(row.rows[0].status, 'new')
    assert.equal(row.rows[0].from, 'ada@example.com')
    assert.equal(row.rows[0].to, 'agents@clemsonrides.com')
    assert.equal(row.rows[0].has_received, true)
    await assert.rejects(
      () => db.query(`
        insert into public.inbound_agent_mail (message_id, raw)
        values ('<id@example>', '{}'::jsonb)
      `),
      /duplicate key/i,
    )
    await db.exec('reset role')
  } finally {
    await db.close()
  }
})
