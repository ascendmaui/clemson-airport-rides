import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { notifyAdminOfApplication } from '../server/driverApproval.js'
import { isAdminUser } from '../server/tripSettle.js'
import {
  KNOWN_OWNER_EMAILS,
  serverIsAdmin,
} from '../server/adminRoster.js'
import { isAdminIdentity } from '../shared/adminAccess.js'
import { ADMIN_ACCESS_REQUIRED } from '../src/lib/adminAccessCopy.js'
import { ownerSavedPlaces, welcomeHeading } from '../src/lib/homePrivacy.js'

const root = new URL('..', import.meta.url)

function read(path) {
  return readFileSync(new URL(path, root), 'utf8')
}

test('john@gmail.com is not an admin', () => {
  const prev = process.env.ADMIN_EMAILS
  process.env.ADMIN_EMAILS = 'john@gmail.com, johnmatveev@gmail.com, lead@clemson.edu'
  try {
    assert.equal(serverIsAdmin({ jwtEmail: 'john@gmail.com' }), false)
    assert.equal(serverIsAdmin({ jwtEmail: '  JOHN@gmail.com ' }), false)
    assert.equal(serverIsAdmin({
      jwtEmail: 'john@gmail.com',
      role: 'admin',
      isAdmin: true,
    }), false)
    assert.equal(serverIsAdmin({
      jwtEmail: 'johnmatveev@gmail.com',
      profileEmail: 'johnmatveyev@gmail.com',
      role: 'ops',
      isAdmin: true,
    }), false)
    assert.equal(isAdminUser({ email: 'john@gmail.com' }, { role: 'admin', is_admin: true }), false)
    assert.equal(isAdminIdentity({ jwtEmail: 'john@gmail.com' }), false)
    assert.equal(serverIsAdmin({ jwtEmail: 'lead@clemson.edu' }), true)
    for (const email of KNOWN_OWNER_EMAILS) {
      assert.equal(serverIsAdmin({ jwtEmail: email }), true, email)
    }
    assert.equal(serverIsAdmin({ jwtEmail: 'ada@clemson.edu', role: 'rider', isAdmin: false }), false)
    assert.equal(serverIsAdmin({ jwtEmail: 'ada@clemson.edu', role: 'admin' }), true)
  } finally {
    if (prev === undefined) delete process.env.ADMIN_EMAILS
    else process.env.ADMIN_EMAILS = prev
  }
})

test('application notices use ADMIN_NOTIFY_EMAIL and no hardcoded inbox', async () => {
  const prevNotify = process.env.ADMIN_NOTIFY_EMAIL
  const prevKey = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  try {
    delete process.env.ADMIN_NOTIFY_EMAIL
    const empty = await notifyAdminOfApplication({ profile: { full_name: 'Ada', email: 'ada@clemson.edu' } })
    assert.equal(empty.emailed, false)
    assert.equal(empty.to, null)
    assert.equal(JSON.stringify(empty).includes('john@gmail.com'), false)

    process.env.ADMIN_NOTIFY_EMAIL = 'john@gmail.com, johnmatveev@gmail.com'
    const denied = await notifyAdminOfApplication({ profile: { full_name: 'Ada' } })
    assert.equal(denied.emailed, false)
    assert.equal(denied.to, null)

    process.env.ADMIN_NOTIFY_EMAIL = 'johnmatveyev@gmail.com'
    const owner = await notifyAdminOfApplication({ profile: { full_name: 'Ada' } })
    assert.equal(owner.emailed, false)
    assert.equal(owner.to, 'johnmatveyev@gmail.com')
  } finally {
    if (prevNotify === undefined) delete process.env.ADMIN_NOTIFY_EMAIL
    else process.env.ADMIN_NOTIFY_EMAIL = prevNotify
    if (prevKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = prevKey
  }
})

test('admin screens ship Admin access required and no email addresses', () => {
  assert.equal(ADMIN_ACCESS_REQUIRED, 'Admin access required')
  const files = [
    'src/components/AdminAccessDenied.jsx',
    'src/screens/AdminDesk.jsx',
    'src/screens/AdminDrivers.jsx',
    'src/screens/IncentivesAdmin.jsx',
    'src/App.jsx',
    'src/lib/adminAccessCopy.js',
    'src/lib/driverOnboarding.js',
    'src/lib/driverIncentiveMath.js',
    'shared/adminAccess.js',
    'shared/driverOnboarding.js',
  ]
  const leaked = /john@gmail\.com|johnmatveev@gmail\.com|johnmatveyev@gmail\.com|ascendmaui@gmail\.com|jmat2019@icloud\.com|SEEDED_ADMIN_EMAILS|ADMIN_EMAIL\b/
  for (const file of files) {
    const source = read(file)
    assert.equal(leaked.test(source), false, file)
  }
  const denied = read('src/components/AdminAccessDenied.jsx')
  assert.match(denied, /ADMIN_ACCESS_REQUIRED/)
  assert.equal(denied.includes('@'), false)
  assert.match(read('src/lib/adminAccessCopy.js'), /Admin access required/)
  assert.match(read('src/screens/AdminDesk.jsx'), /AdminAccessDenied/)
  assert.match(read('src/screens/AdminDrivers.jsx'), /AdminAccessDenied/)
})

test('home greeting uses the signed-in name and drops other people saved places', () => {
  assert.equal(welcomeHeading(''), 'Welcome')
  assert.equal(welcomeHeading(null, undefined), 'Welcome')
  assert.equal(welcomeHeading('Demo Rider'), 'Welcome, Demo')
  assert.equal(welcomeHeading('', 'Demo Rider'), 'Welcome, Demo')
  assert.equal(welcomeHeading('John Matveyev'), 'Welcome, John')
  assert.notEqual(welcomeHeading('Demo Rider'), 'Welcome, John')

  const demoId = 'demo-rider'
  const johnId = 'john-owner'
  const rows = [
    { id: 'p1', user_id: johnId, label: 'Home', subtitle: 'Simpsonville' },
    { id: 'p2', user_id: demoId, label: 'Library', subtitle: 'Cooper Library' },
  ]
  assert.deepEqual(ownerSavedPlaces(rows, demoId), [
    { id: 'p2', label: 'Library', sub: 'Cooper Library', icon: '📍' },
  ])
  assert.deepEqual(ownerSavedPlaces(rows, 'clean-profile'), [])
  assert.deepEqual(ownerSavedPlaces(rows, ''), [])
  assert.equal(JSON.stringify(ownerSavedPlaces(rows, demoId)).includes('Simpsonville'), false)

  const home = read('src/screens/RiderHome.jsx')
  assert.equal(home.includes('Simpsonville'), false)
  assert.equal(home.includes("riderName = 'John'"), false)
  assert.equal(home.includes('Welcome, John'), false)
  assert.match(home, /\.eq\('id', user\.id\)/)
  assert.match(home, /\.eq\('user_id', user\.id\)/)
  assert.match(home, /ownerSavedPlaces\(data, user\.id\)/)
  assert.match(home, /welcomeHeading\(profileName, user\?\.user_metadata\?\.full_name\)/)

  const shortcuts = read('packages/rides-native/places.js')
  assert.equal(/Simpsonville/.test(shortcuts), false)
})

test('saved places and admin roster SQL stay scoped to the signed-in user', () => {
  const sql = read('supabase/migrations/20261005060000_admin_roster_and_saved_places.sql')
  assert.match(sql, /CREATE POLICY saved_places_select_own/)
  assert.match(sql, /CREATE POLICY saved_places_insert_own/)
  assert.match(sql, /CREATE POLICY saved_places_update_own/)
  assert.match(sql, /CREATE POLICY saved_places_delete_own/)
  assert.match(sql, /USING \(user_id = auth\.uid\(\)\)/)
  assert.match(sql, /WITH CHECK \(user_id = auth\.uid\(\)\)/)
  assert.equal(sql.includes('USING (true)'), false)
  assert.match(sql, /REVOKE ALL ON public\.saved_places FROM anon/)
  assert.match(sql, /DELETE FROM public\.admin_users/)
  assert.match(sql, /'john@gmail.com', 'johnmatveev@gmail.com'/)
  assert.match(sql, /'ascendmaui@gmail.com', 'admin', 'Owner'/)

  const seed = read('supabase/migrations/20260924190000_admin_support.sql')
  const insert = seed.slice(seed.indexOf('INSERT INTO public.admin_users'), seed.indexOf('ON CONFLICT'))
  assert.equal(insert.includes('john@gmail.com'), false)
  assert.equal(insert.includes('johnmatveev@gmail.com'), false)
  assert.match(insert, /ascendmaui@gmail.com/)

  for (const file of [
    'supabase/migrations/20261004160000_matching_decline_offline.sql',
    'supabase/migrations/20261004220000_tesla_model_3_fleet.sql',
    'supabase/driver_onboarding_approval.sql',
    'supabase/driver_incentives.sql',
    'server/staffAccess.js',
    'server/driverApproval.js',
  ]) {
    const source = read(file)
    assert.equal(source.includes('johnmatveev@gmail.com'), file.endsWith('driver_onboarding_approval.sql'), file)
    if (file.endsWith('driver_onboarding_approval.sql')) {
      assert.match(source, /not in \('john@gmail.com', 'johnmatveev@gmail.com'\)/)
      assert.equal(source.includes("= 'john@gmail.com'"), false)
    } else if (file.endsWith('.sql') && file.includes('driver_incentives')) {
      assert.equal(source.includes('john@gmail.com'), false)
    } else if (file.endsWith('.sql')) {
      assert.equal(source.includes('john@gmail.com'), false)
      assert.equal(source.includes('johnmatveev@gmail.com'), false)
    }
  }
})
