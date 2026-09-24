import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CUPD_EMAIL,
  CUPD_PHONE_E164,
  MAX_EMERGENCY_CONTACTS,
  buildSosText,
  contactTel,
  createLocationShare,
  deleteEmergencyContact,
  isActiveRideStatus,
  isShareableTripStatus,
  logSosEvent,
  postLocationPoint,
  revokeLocationShare,
  saveEmergencyContact,
  shareUrl,
  sosChannelHref,
  tripShareMessage,
  validateEmergencyContact,
} from './safety.js'

function memorySupabase(seed = {}) {
  const tables = {
    location_shares: [...(seed.location_shares || [])],
    location_points: [...(seed.location_points || [])],
    emergency_contacts: [...(seed.emergency_contacts || [])],
    sos_events: [...(seed.sos_events || [])],
  }

  function from(table) {
    const filters = []
    let mode = 'select'
    let payload = null
    const api = {
      select() { return api },
      eq(col, val) { filters.push([col, val]); return api },
      gte() { return api },
      order() { return api },
      limit() { return api },
      insert(row) { mode = 'insert'; payload = { ...row }; return api },
      update(patch) { mode = 'update'; payload = { ...patch }; return api },
      delete() { mode = 'delete'; return api },
      maybeSingle() { return finish(true) },
      single() { return finish(true) },
      then(resolve, reject) { return finish(false).then(resolve, reject) },
    }

    function matched() {
      return tables[table].filter((row) => filters.every(([col, val]) => row[col] === val))
    }

    function finish(one) {
      if (mode === 'insert') {
        const row = {
          id: payload.id || `${table}-${tables[table].length + 1}`,
          created_at: '2026-09-24T00:00:00.000Z',
          ...payload,
        }
        tables[table].push(row)
        return Promise.resolve({ data: one ? row : [row], error: null })
      }
      if (mode === 'update') {
        const rows = matched()
        rows.forEach((row) => Object.assign(row, payload))
        return Promise.resolve({
          data: one ? rows[0] || null : rows,
          error: one && !rows[0] ? { message: 'not found' } : null,
        })
      }
      if (mode === 'delete') {
        const drop = new Set(matched())
        tables[table] = tables[table].filter((row) => !drop.has(row))
        return Promise.resolve({ data: null, error: null })
      }
      const rows = matched()
      if (one && rows.length > 1) return Promise.resolve({ data: null, error: { message: 'multiple rows' } })
      return Promise.resolve({ data: one ? rows[0] || null : rows, error: null })
    }

    return api
  }

  return { from, tables }
}

test('share links use the public /share/:token path', () => {
  assert.equal(shareUrl('abc123'), 'https://clemson-airport-rides.vercel.app/share/abc123')
  assert.equal(shareUrl('a b'), 'https://clemson-airport-rides.vercel.app/share/a%20b')
  assert.throws(() => shareUrl('  '), /Share token required/)
})

test('trip share text includes the live link', () => {
  const text = tripShareMessage({
    pickup: 'Memorial Stadium',
    dropoff: 'GSP Airport',
    status: 'in_progress',
    url: shareUrl('tok'),
  })
  assert.match(text, /Memorial Stadium → GSP Airport/)
  assert.match(text, /in_progress/)
  assert.match(text, /\/share\/tok/)
})

test('SOS text and channels match the web control', () => {
  const text = buildSosText({ lat: 34.6834, lng: -82.8374, tripId: 'trip-123' })
  assert.match(text, /Trip: trip-123/)
  assert.match(text, /34\.68340, -82\.83740/)
  assert.equal(sosChannelHref('tel_911', text), 'tel:911')
  assert.equal(sosChannelHref('tel_cupd', text), `tel:${CUPD_PHONE_E164}`)
  assert.match(sosChannelHref('mailto', text), new RegExp(`^mailto:${CUPD_EMAIL}\\?`))
  assert.equal(sosChannelHref('web_share', text), null)
  assert.equal(isActiveRideStatus('in_progress'), true)
  assert.equal(isActiveRideStatus('searching'), false)
  assert.equal(isShareableTripStatus('searching'), true)
  assert.equal(isShareableTripStatus('completed'), false)
})

test('createLocationShare reuses an active token and otherwise inserts one', async () => {
  const existing = memorySupabase({
    location_shares: [{ id: 'share-1', trip_id: 'trip-1', rider_id: 'rider-1', token: 'deadbeef', active: true }],
  })
  const again = await createLocationShare(existing, 'trip-1', 'rider-1')
  assert.equal(again.token, 'deadbeef')
  assert.equal(again.url, shareUrl('deadbeef'))
  assert.equal(existing.tables.location_shares.length, 1)

  const fresh = memorySupabase()
  const created = await createLocationShare(fresh, 'trip-2', 'rider-1')
  assert.equal(fresh.tables.location_shares.length, 1)
  assert.equal(fresh.tables.location_shares[0].trip_id, 'trip-2')
  assert.equal(fresh.tables.location_shares[0].rider_id, 'rider-1')
  assert.equal(fresh.tables.location_shares[0].active, true)
  assert.equal(created.url, shareUrl(created.token))
})

test('location points and revoke update the live share tables', async () => {
  const db = memorySupabase({
    location_shares: [{ id: 'share-1', trip_id: 'trip-1', token: 'abc', active: true }],
  })
  await postLocationPoint(db, { shareId: 'share-1', lat: 34.67, lng: -82.84, accuracy: 12 })
  assert.equal(db.tables.location_points[0].share_id, 'share-1')
  assert.equal(db.tables.location_points[0].accuracy_m, 12)
  await revokeLocationShare(db, 'share-1')
  assert.equal(db.tables.location_shares[0].active, false)
  assert.ok(db.tables.location_shares[0].revoked_at)
})

test('emergency contacts validate, save, edit, cap, and delete', async () => {
  const bad = validateEmergencyContact({ name: ' ', phone: '123' })
  assert.equal(bad.ok, false)
  assert.equal(contactTel('8646562222'), 'tel:+18646562222')
  assert.equal(contactTel('+18646562222'), 'tel:+18646562222')

  const db = memorySupabase()
  const saved = await saveEmergencyContact(db, 'rider-1', {
    name: 'Avery',
    phone: '(864) 656-2222',
    relationship: 'Roommate',
  })
  assert.equal(saved.ok, true)
  assert.equal(saved.contact.phone, '8646562222')
  assert.equal(saved.contact.user_id, 'rider-1')

  const edited = await saveEmergencyContact(db, 'rider-1', {
    id: saved.contact.id,
    name: 'Avery Chen',
    phone: saved.contact.phone,
    relationship: 'Roommate',
  })
  assert.equal(edited.ok, true)
  assert.equal(edited.contact.name, 'Avery Chen')
  assert.equal(db.tables.emergency_contacts.length, 1)

  for (let i = db.tables.emergency_contacts.length; i < MAX_EMERGENCY_CONTACTS; i += 1) {
    db.tables.emergency_contacts.push({
      id: `extra-${i}`,
      user_id: 'rider-1',
      name: `Person ${i}`,
      phone: '8646562222',
      relationship: null,
    })
  }
  const capped = await saveEmergencyContact(db, 'rider-1', { name: 'Sixth', phone: '8646561111' })
  assert.equal(capped.ok, false)
  assert.match(capped.error, /5 emergency contacts/)

  const removed = await deleteEmergencyContact(db, 'rider-1', saved.contact.id)
  assert.equal(removed.ok, true)
  assert.equal(db.tables.emergency_contacts.some((row) => row.id === saved.contact.id), false)
})

test('SOS log rejects an unknown channel and stores a banner', async () => {
  const db = memorySupabase()
  const bad = await logSosEvent(db, { tripId: 'trip-1', userId: 'rider-1', channel: 'fat-finger' })
  assert.equal(bad.ok, false)
  const ok = await logSosEvent(db, {
    tripId: 'trip-1',
    userId: 'rider-1',
    lat: 34.68,
    lng: -82.84,
    channel: 'banner',
  })
  assert.equal(ok.ok, true)
  assert.equal(db.tables.sos_events[0].channel, 'banner')
  assert.equal(db.tables.sos_events[0].trip_id, 'trip-1')
})
