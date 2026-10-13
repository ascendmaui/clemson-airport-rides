import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(
  new URL('../supabase/migrations/20261006180450_tiger_heat_rls.sql', import.meta.url),
  'utf8',
)

const reservationId = '11111111-1111-4111-8111-111111111111'

async function applyHarness(db) {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role tiger_heat_admin nologin;
    grant authenticated to tiger_heat_admin;
    create function public.is_admin() returns boolean
    language sql stable
    as $$ select current_user = 'tiger_heat_admin' $$;
  `)
  await db.exec(migration)
  await db.exec(migration)
}

test('tiger heat RLS lets service role and admins through and blocks anon', async () => {
  const db = new PGlite()
  try {
    await applyHarness(db)

    const flags = await db.query(`
      select c.relname, c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('tiger_heat_config', 'tiger_heat_ledger')
      order by c.relname
    `)
    assert.deepEqual(flags.rows.map((row) => [row.relname, row.relrowsecurity]), [
      ['tiger_heat_config', true],
      ['tiger_heat_ledger', true],
    ])

    const policies = await db.query(`
      select c.relname, p.polname
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      where c.relname in ('tiger_heat_config', 'tiger_heat_ledger')
      order by c.relname
    `)
    assert.deepEqual(policies.rows.map((row) => `${row.relname}:${row.polname}`), [
      'tiger_heat_config:tiger_heat_config_admin_all',
      'tiger_heat_ledger:tiger_heat_ledger_admin_all',
    ])

    assert.equal((await db.query(`select has_table_privilege('anon', 'public.tiger_heat_config', 'select') as ok`)).rows[0].ok, false)
    assert.equal((await db.query(`select has_table_privilege('anon', 'public.tiger_heat_ledger', 'insert') as ok`)).rows[0].ok, false)
    assert.equal((await db.query(`select has_table_privilege('authenticated', 'public.tiger_heat_ledger', 'select') as ok`)).rows[0].ok, true)
    assert.equal((await db.query(`select has_table_privilege('service_role', 'public.tiger_heat_ledger', 'insert') as ok`)).rows[0].ok, true)
    assert.equal((await db.query(`select count(*)::int as n from public.tiger_heat_config`)).rows[0].n, 1)

    await db.exec('set role anon')
    await assert.rejects(
      () => db.query('select * from public.tiger_heat_config'),
      /permission denied/i,
    )
    await assert.rejects(
      () => db.query(`insert into public.tiger_heat_ledger (reservation_id, status) values ('${reservationId}', 'reserved')`),
      /permission denied/i,
    )
    await db.exec('reset role')

    await db.exec('set role authenticated')
    assert.equal((await db.query('select count(*)::int as n from public.tiger_heat_config')).rows[0].n, 0)
    assert.equal((await db.query('select count(*)::int as n from public.tiger_heat_ledger')).rows[0].n, 0)
    await assert.rejects(
      () => db.query(`insert into public.tiger_heat_ledger (reservation_id, status) values ('${reservationId}', 'reserved')`),
      /row-level security/i,
    )
    const hiddenUpdate = await db.query('update public.tiger_heat_config set min_margin_cents = 999')
    assert.equal(hiddenUpdate.affectedRows, 0)
    await db.exec('reset role')
    assert.equal((await db.query('select min_margin_cents from public.tiger_heat_config where id = 1')).rows[0].min_margin_cents, 0)

    await db.exec('set role service_role')
    await db.query(
      `insert into public.tiger_heat_ledger (reservation_id, status, rider_fare_cents, driver_pay_cents, revenue_cents)
       values ($1, 'reserved', 1798, 2000, 1798)`,
      [reservationId],
    )
    const written = await db.query(
      'select status, driver_pay_cents from public.tiger_heat_ledger where reservation_id = $1',
      [reservationId],
    )
    assert.equal(written.rows[0].status, 'reserved')
    assert.equal(written.rows[0].driver_pay_cents, 2000)
    const config = await db.query('select min_margin_bps from public.tiger_heat_config where id = 1')
    assert.equal(config.rows[0].min_margin_bps, 500)
    await db.exec('reset role')

    await db.exec('set role tiger_heat_admin')
    const adminRead = await db.query(
      'select driver_pay_cents from public.tiger_heat_ledger where reservation_id = $1',
      [reservationId],
    )
    assert.equal(adminRead.rows[0].driver_pay_cents, 2000)
    await db.query('update public.tiger_heat_config set min_margin_cents = 250 where id = 1')
    assert.equal(
      (await db.query('select min_margin_cents from public.tiger_heat_config where id = 1')).rows[0].min_margin_cents,
      250,
    )
    await db.exec('reset role')

    await db.exec('set role authenticated')
    assert.equal((await db.query('select count(*)::int as n from public.tiger_heat_config')).rows[0].n, 0)
    assert.equal((await db.query('select count(*)::int as n from public.tiger_heat_ledger')).rows[0].n, 0)
    await db.exec('reset role')

    assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
    assert.match(migration, /public\.is_admin\(\)/)
    assert.doesNotMatch(migration, /GRANT [^;]*TO anon/i)
    assert.doesNotMatch(migration, /USING \(true\)/)
  } finally {
    await db.exec('reset role').catch(() => {})
    await db.close()
  }
})
