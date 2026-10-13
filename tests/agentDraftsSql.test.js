import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const fileName = '20261013250000_agent_drafts.sql'
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

test('agent drafts migration is additive and service role only', async () => {
  const executable = migration.replace(/--.*$/gm, '')
  assert.equal(/drop table/i.test(executable), false)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /grant all on table public\.agent_drafts to service_role/)
  assert.match(migration, /kind in \('marketing', 'affiliate', 'outreach'\)/)
  assert.match(migration, /status in \('draft_ready'\)/)
  assert.match(migration, /source in \('mail', 'schedule'\)/)
  assert.match(fileName, /^20261013250000_/)

  const db = new PGlite()
  try {
    await apply(db)
    const flags = await db.query(`
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'agent_drafts'
    `)
    assert.equal(flags.rows[0].relrowsecurity, true)
    const policies = await db.query(`
      select count(*)::int as n
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      where c.relname = 'agent_drafts'
    `)
    assert.equal(policies.rows[0].n, 0)
    assert.equal((await db.query(`select has_table_privilege('anon', 'public.agent_drafts', 'select') as ok`)).rows[0].ok, false)
    assert.equal((await db.query(`select has_table_privilege('authenticated', 'public.agent_drafts', 'insert') as ok`)).rows[0].ok, false)
    assert.equal((await db.query(`select has_table_privilege('service_role', 'public.agent_drafts', 'insert') as ok`)).rows[0].ok, true)

    await db.exec('set role anon')
    await assert.rejects(() => db.query('select * from public.agent_drafts'), /permission denied/i)
    await db.exec('reset role')

    await db.exec('set role service_role')
    await db.query(`
      insert into public.agent_drafts (kind, subject, body, source, slot, message_id)
      values ('marketing', 'Campus week', 'A draft for approval', 'mail', 'content', '<m1>')
    `)
    const row = await db.query(`select status, kind from public.agent_drafts where message_id = '<m1>'`)
    assert.equal(row.rows[0].status, 'draft_ready')
    assert.equal(row.rows[0].kind, 'marketing')
    await assert.rejects(
      () => db.query(`update public.agent_drafts set status = 'sent' where message_id = '<m1>'`),
      /check constraint|agent_drafts_status_check/i,
    )
    await assert.rejects(
      () => db.query(`
        insert into public.agent_drafts (kind, body, source, slot, message_id)
        values ('marketing', 'again', 'mail', 'content', '<m1>')
      `),
      /duplicate key/i,
    )
    await db.query(`
      insert into public.agent_drafts (kind, body, source, slot)
      values ('outreach', 'sequence', 'schedule', 'sequence')
    `)
    await db.query(`
      insert into public.agent_drafts (kind, body, source, slot)
      values ('outreach', 'sequence again', 'schedule', 'sequence')
    `)
    await db.exec('reset role')
  } finally {
    await db.close()
  }
})
