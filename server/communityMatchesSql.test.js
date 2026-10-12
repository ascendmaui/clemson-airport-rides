import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../supabase/migrations/20261012160000_community_profiles.sql', import.meta.url), 'utf8')
const R = '00000000-0000-0000-0000-00000000000a'
const D = '00000000-0000-0000-0000-000000000001'
const D2 = '00000000-0000-0000-0000-000000000002'
const X = '00000000-0000-0000-0000-000000000009'
const T = '00000000-0000-0000-0000-0000000000f1'
const OPEN = '00000000-0000-0000-0000-0000000000f2'

async function fixture(t) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE TABLE auth.ctx (uid uuid);
    INSERT INTO auth.ctx VALUES (NULL);
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT SELECT ON auth.ctx TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.ctx $$;
    CREATE TABLE public.profiles (id uuid PRIMARY KEY);
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    CREATE TABLE public.trips (id uuid PRIMARY KEY, rider_id uuid, driver_id uuid, status text);
    CREATE TABLE public.driver_applications (profile_id uuid, status text);
    GRANT USAGE ON SCHEMA public TO authenticated;
  `)
  await db.exec(migration)
  await db.exec(migration)
  await db.exec(`
    INSERT INTO profiles VALUES ('${R}'),('${D}'),('${D2}'),('${X}');
    INSERT INTO driver_applications VALUES ('${D}','approved'),('${D2}','approved');
    INSERT INTO trips VALUES ('${T}','${R}','${D}','accepted'),('${OPEN}','${R}',NULL,'searching');
    INSERT INTO community_profiles (user_id, hometown, share_hometown, greek_org, share_greek_org, major, share_major, courses, share_courses, grad_year, share_grad_year) VALUES
      ('${R}','Greenville',true,'Sigma Nu',true,'Biology',false,'{CPSC 1010,MATH 1060}',true,2028,true),
      ('${D}','greenville ',true,'Sigma Nu',false,'Biology',true,'{CPSC 1010}',true,2027,true),
      ('${D2}','Greenville',true,NULL,false,NULL,false,'{}',false,NULL,false),
      ('${X}','Greenville',true,NULL,false,NULL,false,'{}',false,NULL,false);
  `)
  return db
}

async function asUser(db, uid, sql) {
  await db.query('UPDATE auth.ctx SET uid = $1', [uid])
  await db.exec('SET ROLE authenticated')
  try { return (await db.query(sql)).rows } finally { await db.exec('RESET ROLE') }
}

test('matches only for fields BOTH opted into; never the other values', async (t) => {
  const db = await fixture(t)
  const rows = await asUser(db, R, `SELECT * FROM community_matches('${T}')`)
  assert.deepEqual(rows.map((r) => r.label), ['Both from Greenville', 'Share a class'])
  const back = await asUser(db, D, `SELECT * FROM community_matches('${T}')`)
  assert.deepEqual(back.map((r) => r.category), ['hometown', 'courses'])
  assert.ok(!JSON.stringify(back).includes('MATH'))
})

test('strangers get nothing; approved drivers see matches on an open offer only', async (t) => {
  const db = await fixture(t)
  assert.deepEqual(await asUser(db, X, `SELECT * FROM community_matches('${T}')`), [])
  assert.deepEqual(await asUser(db, D2, `SELECT * FROM community_matches('${T}')`), [], 'assigned trip belongs to another driver')
  const open = await asUser(db, D2, `SELECT * FROM community_matches('${OPEN}')`)
  assert.deepEqual(open.map((r) => r.label), ['Both from Greenville'])
  assert.deepEqual(await asUser(db, X, `SELECT * FROM community_matches('${OPEN}')`), [], 'not an approved driver')
})

test('RLS: only your own row is readable or writable', async (t) => {
  const db = await fixture(t)
  const mine = await asUser(db, R, 'SELECT user_id FROM community_profiles')
  assert.deepEqual(mine.map((r) => r.user_id), [R])
  await asUser(db, R, `UPDATE community_profiles SET hometown = 'Hacked' WHERE user_id = '${D}'`)
  const d = (await db.query(`SELECT hometown FROM community_profiles WHERE user_id = '${D}'`)).rows[0]
  assert.equal(d.hometown, 'greenville ')
  await assert.rejects(() => asUser(db, R, `INSERT INTO community_profiles (user_id) VALUES ('${X}')`))
  await asUser(db, R, `DELETE FROM community_profiles WHERE user_id = '${R}'`)
  assert.equal((await db.query(`SELECT count(*)::int n FROM community_profiles WHERE user_id = '${R}'`)).rows[0].n, 0)
})

test('defaults off and class times are rejected', async (t) => {
  const db = await fixture(t)
  await db.exec(`INSERT INTO profiles VALUES ('00000000-0000-0000-0000-0000000000aa'); INSERT INTO community_profiles (user_id) VALUES ('00000000-0000-0000-0000-0000000000aa')`)
  const row = (await db.query(`SELECT * FROM community_profiles WHERE user_id = '00000000-0000-0000-0000-0000000000aa'`)).rows[0]
  for (const k of Object.keys(row).filter((k) => k.startsWith('share_'))) assert.equal(row[k], false, k)
  await assert.rejects(() => db.exec(`UPDATE community_profiles SET courses = '{"CPSC 1010 MWF 9:05"}' WHERE user_id = '${R}'`))
})
