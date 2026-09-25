import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACTIVE_RIDE_STATUSES,
  ALERT_CHANNELS,
  CUPD_EMAIL,
  CUPD_PHONE_DISPLAY,
  CUPD_PHONE_E164,
  MAX_EMERGENCY_CONTACTS,
  SHARE_ORIGIN,
  SHAREABLE_TRIP_STATUSES,
  SOS_CHANNELS,
  buildSosText,
  contactTel,
  createLocationShare,
  deleteEmergencyContact,
  fetchRecentSosEvents,
  findActiveLocationShare,
  isActiveRideStatus,
  isShareableTripStatus,
  listEmergencyContacts,
  logSosEvent,
  makeShareToken,
  normalizeContactPhone,
  postLocationPoint,
  revokeLocationShare,
  saveEmergencyContact,
  shareUrl,
  sosChannelButton,
  sosChannelHref,
  sosChannelPhrase,
  tripShareMessage,
  validateEmergencyContact,
} from './safety.js'

function memorySupabase(seed = {}) {
  const fail = seed.fail || null
  const tables = {
    location_shares: [...(seed.location_shares || [])],
    location_points: [...(seed.location_points || [])],
    emergency_contacts: [...(seed.emergency_contacts || [])],
    sos_events: [...(seed.sos_events || [])],
  }

  function from(table) {
    const filters = []
    const gtes = []
    let orderBy = null
    let limitN = null
    let mode = 'select'
    let payload = null
    const api = {
      select() { return api },
      eq(col, val) { filters.push([col, val]); return api },
      gte(col, val) { gtes.push([col, val]); return api },
      order(col, opts) {
        orderBy = { col, ascending: !opts || opts.ascending !== false }
        return api
      },
      limit(n) { limitN = n; return api },
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

    function ranged(rows) {
      let next = rows.filter((row) => gtes.every(([col, val]) => {
        const cell = row[col]
        return cell != null && String(cell) >= String(val)
      }))
      if (orderBy) {
        const { col, ascending } = orderBy
        next = [...next].sort((a, b) => {
          const av = a[col]
          const bv = b[col]
          if (av === bv) return 0
          if (av == null) return 1
          if (bv == null) return -1
          if (av < bv) return ascending ? -1 : 1
          return ascending ? 1 : -1
        })
      }
      if (limitN != null) next = next.slice(0, limitN)
      return next
    }

    function finish(one) {
      if (fail && fail.table === table && fail.op === mode) {
        return Promise.resolve({ data: null, error: { message: fail.message || 'failed' } })
      }
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
      const rows = ranged(matched())
      if (one && rows.length > 1) return Promise.resolve({ data: null, error: { message: 'multiple rows' } })
      return Promise.resolve({ data: one ? rows[0] || null : rows, error: null })
    }

    return api
  }

  return { from, tables }
}

function scriptedSupabase(responses) {
  let cursor = 0
  function from() {
    const api = {
      select() { return api },
      eq() { return api },
      gte() { return api },
      order() { return api },
      limit() { return api },
      insert() { return api },
      update() { return api },
      delete() { return api },
      maybeSingle() { return finish() },
      single() { return finish() },
      then(resolve, reject) { return finish().then(resolve, reject) },
    }
    function finish() {
      const next = responses[cursor] || { data: null, error: null }
      cursor += 1
      return Promise.resolve(next)
    }
    return api
  }
  return { from }
}

test('share links use the public /share/:token path', () => {
  assert.equal(shareUrl('abc123'), 'https://clemson-rides.vercel.app/share/abc123')
  assert.equal(shareUrl('a b'), 'https://clemson-rides.vercel.app/share/a%20b')
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

test('published police contacts and share origin stay on the public host', () => {
  assert.equal(SHARE_ORIGIN, 'https://clemson-airport-rides.vercel.app')
  assert.equal(CUPD_PHONE_E164, '+18646562222')
  assert.equal(CUPD_PHONE_DISPLAY, '(864) 656-2222')
  assert.equal(CUPD_EMAIL, 'police@clemson.edu')
  assert.equal(MAX_EMERGENCY_CONTACTS, 5)
  assert.deepEqual(ALERT_CHANNELS, ['tel_911', 'tel_cupd', 'sms', 'mailto', 'web_share'])
  assert.deepEqual(SOS_CHANNELS, [...ALERT_CHANNELS, 'banner'])
})

test('shareable statuses include the wait, and active statuses are the accepted ride', () => {
  assert.deepEqual(SHAREABLE_TRIP_STATUSES, ['searching', 'offered', 'accepted', 'arriving', 'in_progress'])
  assert.deepEqual(ACTIVE_RIDE_STATUSES, ['accepted', 'arriving', 'in_progress'])
  for (const status of ACTIVE_RIDE_STATUSES) {
    assert.equal(isActiveRideStatus(status), true)
    assert.equal(isShareableTripStatus(status), true)
  }
  assert.equal(isShareableTripStatus('searching'), true)
  assert.equal(isShareableTripStatus('offered'), true)
  assert.equal(isActiveRideStatus('searching'), false)
  assert.equal(isActiveRideStatus('offered'), false)
  for (const status of ['completed', 'canceled', 'cancelled_wait', 'scheduled', null, undefined, '']) {
    assert.equal(isShareableTripStatus(status), false, String(status))
    assert.equal(isActiveRideStatus(status), false, String(status))
  }
  // BUG?: 'arrived' is a live status (driver at pickup, between arriving and
  // in_progress). It is missing from SHAREABLE_TRIP_STATUSES and
  // ACTIVE_RIDE_STATUSES, so the safety screen's active-trip query drops the
  // ride and SOS logging turns off while the rider is getting in the car.
  // 'requested' (preferred ride waiting on a named driver) is also missing
  // from the shareable list, unlike 'searching' and 'offered'.
  assert.equal(isShareableTripStatus('arrived'), false)
  assert.equal(isActiveRideStatus('arrived'), false)
  assert.equal(isShareableTripStatus('requested'), false)
  assert.equal(isActiveRideStatus('requested'), false)
})

test('share links trim the token, strip one trailing slash, and encode the path', () => {
  assert.equal(shareUrl(' tok '), `${SHARE_ORIGIN}/share/tok`)
  assert.equal(shareUrl('a/b', 'https://example.com/'), 'https://example.com/share/a%2Fb')
  assert.equal(shareUrl('tok', ''), `${SHARE_ORIGIN}/share/tok`)
  assert.throws(() => shareUrl(), /Share token required/)
  assert.throws(() => shareUrl(null), /Share token required/)
})

test('share tokens are 32 hex chars and fall back when Web Crypto is unavailable', () => {
  const tokens = new Set(Array.from({ length: 8 }, () => makeShareToken()))
  assert.equal(tokens.size, 8)
  for (const token of tokens) assert.match(token, /^[0-9a-f]{32}$/)

  const original = globalThis.crypto
  try {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues() { throw new Error('blocked') } },
    })
    assert.match(makeShareToken(), /^share_[0-9a-z]+_[0-9a-z]+$/)
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined })
    assert.match(makeShareToken(), /^share_[0-9a-z]+_[0-9a-z]+$/)
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
    assert.match(makeShareToken(), /^share_[0-9a-z]+_[0-9a-z]+$/)
  } finally {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original })
  }
})

test('trip share text fills missing ends and skips blank status and url', () => {
  assert.equal(tripShareMessage({}), 'Follow my Clemson RIDES trip')
  assert.match(tripShareMessage({ pickup: 'Tillman' }), /Tillman → Dropoff/)
  assert.match(tripShareMessage({ dropoff: 'GSP' }), /Pickup → GSP/)
  const statusOnly = tripShareMessage({ status: 'accepted' })
  assert.match(statusOnly, /Status: accepted/)
  assert.equal(statusOnly.includes('http'), false)
  assert.equal(statusOnly.includes('→'), false)
})

test('SOS text omits the map link when either coordinate is missing', () => {
  const text = buildSosText({ lat: 34.6834, lng: -82.8374, tripId: 'trip-123' })
  assert.equal(text, [
    'SOS Clemson RIDES',
    'Trip: trip-123',
    'Location: 34.68340, -82.83740',
    'https://maps.google.com/maps?q=34.68340,-82.83740',
    'Active campus ride. Need help now.',
  ].join('\n'))
  const missing = buildSosText({ lat: null, lng: null, tripId: '' })
  assert.match(missing, /Trip: unknown/)
  assert.match(missing, /GPS unavailable/)
  assert.equal(missing.includes('maps.google.com'), false)
  const partial = buildSosText({ lat: 34.6834, lng: null, tripId: 'trip-1' })
  assert.match(partial, /GPS unavailable/)
  assert.equal(partial.includes('maps.google.com'), false)
})

test('SOS and police channels expose href, button, and phrase', () => {
  const text = buildSosText({ lat: 34.68, lng: -82.84, tripId: 'trip-9' })
  const expected = {
    tel_911: {
      title: 'Call 911',
      detail: 'Emergency voice call',
      href: 'tel:911',
      phrase: 'called 911',
    },
    tel_cupd: {
      title: 'Call Clemson Police',
      detail: '(864) 656-2222 · campus safety',
      href: 'tel:+18646562222',
      phrase: 'called Clemson Police',
    },
    sms: {
      title: 'Text 911',
      detail: 'Lat/lng and trip id · main campus',
      phrase: 'texted 911 with their location',
    },
    mailto: {
      title: 'Email Clemson Police',
      detail: 'police@clemson.edu',
      phrase: 'emailed Clemson Police',
    },
    web_share: {
      title: 'Share location',
      detail: 'Share sheet with lat/lng and trip id',
      href: null,
      phrase: 'shared their live location',
    },
    banner: {
      title: 'Alert the other person',
      detail: 'In-app banner on this trip',
      href: null,
      phrase: 'sent an in-app SOS',
    },
  }
  for (const channel of SOS_CHANNELS) {
    const button = sosChannelButton(channel)
    assert.equal(button.title, expected[channel].title)
    assert.equal(button.detail, expected[channel].detail)
    assert.equal(sosChannelPhrase(channel), expected[channel].phrase)
    if (channel === 'sms') {
      const href = sosChannelHref(channel, text)
      assert.equal(href.startsWith('sms:911?&body='), true)
      assert.match(decodeURIComponent(href), /Trip: trip-9/)
    } else if (channel === 'mailto') {
      const href = sosChannelHref(channel, 'line 1\nline 2')
      assert.equal(href.startsWith(`mailto:${CUPD_EMAIL}?`), true)
      assert.match(href, /subject=SOS%20Clemson%20RIDES/)
      assert.match(decodeURIComponent(href), /line 1\nline 2/)
    } else {
      assert.equal(sosChannelHref(channel, text), expected[channel].href)
    }
    assert.equal(ALERT_CHANNELS.includes(channel), channel !== 'banner')
  }
  assert.equal(sosChannelPhrase('pager'), 'activated SOS (pager)')
  assert.throws(() => sosChannelHref('pager', text), /Unknown SOS channel: pager/)
  assert.throws(() => sosChannelButton('pager'), /Unknown SOS channel: pager/)
})

test('contact phones keep a leading plus and dial 10-digit numbers as +1', () => {
  assert.deepEqual(normalizeContactPhone(''), { ok: false, error: 'Enter a phone number with 7 to 15 digits' })
  assert.deepEqual(normalizeContactPhone(null), { ok: false, error: 'Enter a phone number with 7 to 15 digits' })
  assert.deepEqual(normalizeContactPhone('123456'), { ok: false, error: 'Enter a phone number with 7 to 15 digits' })
  assert.deepEqual(normalizeContactPhone('1234567890123456'), { ok: false, error: 'Enter a phone number with 7 to 15 digits' })
  assert.deepEqual(normalizeContactPhone('123-4567'), { ok: true, phone: '1234567' })
  assert.deepEqual(normalizeContactPhone('1'.repeat(15)), { ok: true, phone: '1'.repeat(15) })
  assert.deepEqual(normalizeContactPhone('+44 20 7946 0958'), { ok: true, phone: '+442079460958' })
  assert.deepEqual(normalizeContactPhone('  (864) 656-2222 '), { ok: true, phone: '8646562222' })
  assert.equal(contactTel(), null)
  assert.equal(contactTel(null), null)
  assert.equal(contactTel(''), null)
  assert.equal(contactTel('8646562222'), 'tel:+18646562222')
  assert.equal(contactTel('+44 20 7946 0958'), 'tel:+442079460958')
  assert.equal(contactTel('442079460958'), 'tel:+442079460958')
  assert.equal(normalizeContactPhone('656-2222').phone, '6562222')
  assert.equal(contactTel('656-2222'), 'tel:6562222')
  assert.equal(contactTel('6562222'), 'tel:6562222')
  assert.equal(contactTel('+6562222'), 'tel:+6562222')
})

test('emergency contact validation enforces name and relationship length', () => {
  assert.equal(validateEmergencyContact().ok, false)
  assert.match(validateEmergencyContact().error, /name/i)
  assert.match(validateEmergencyContact({ name: 'A'.repeat(81), phone: '8646562222' }).error, /80/)
  const atCap = validateEmergencyContact({
    name: 'A'.repeat(80),
    phone: '8646562222',
    relationship: 'R'.repeat(40),
  })
  assert.equal(atCap.ok, true)
  assert.equal(atCap.contact.name, 'A'.repeat(80))
  assert.equal(atCap.contact.relationship, 'R'.repeat(40))
  assert.match(
    validateEmergencyContact({ name: 'A', phone: '8646562222', relationship: 'R'.repeat(41) }).error,
    /40/,
  )
  const blankRel = validateEmergencyContact({ name: 'A', phone: '8646562222', relationship: '   ' })
  assert.equal(blankRel.ok, true)
  assert.equal(blankRel.contact.relationship, null)
  assert.equal(blankRel.contact.phone, '8646562222')
  assert.match(validateEmergencyContact({ name: 'A', phone: '12' }).error, /7 to 15/)
})

test('findActiveLocationShare returns the newest active token for the trip', async () => {
  assert.equal(await findActiveLocationShare(null, 'trip-1'), null)
  assert.equal(await findActiveLocationShare(memorySupabase(), ''), null)
  assert.equal(await findActiveLocationShare(memorySupabase(), 'missing'), null)

  const db = memorySupabase({
    location_shares: [
      { id: 'old', trip_id: 'trip-1', token: 'old-token', active: true, created_at: '2026-09-24T00:00:00.000Z' },
      { id: 'newer-off', trip_id: 'trip-1', token: 'off-token', active: false, created_at: '2026-09-24T03:00:00.000Z' },
      { id: 'other', trip_id: 'trip-2', token: 'other-token', active: true, created_at: '2026-09-24T04:00:00.000Z' },
      { id: 'new', trip_id: 'trip-1', token: 'new-token', active: true, created_at: '2026-09-24T02:00:00.000Z' },
      { id: 'blank', trip_id: 'trip-9', token: '', active: true, created_at: '2026-09-24T05:00:00.000Z' },
    ],
  })
  const found = await findActiveLocationShare(db, 'trip-1', 'https://example.com/')
  assert.deepEqual(found, {
    id: 'new',
    token: 'new-token',
    active: true,
    url: 'https://example.com/share/new-token',
  })
  assert.equal(await findActiveLocationShare(db, 'trip-9'), null)

  const objectRow = scriptedSupabase([{ data: { id: 'share-9', token: 'abc', active: true }, error: null }])
  const fromObject = await findActiveLocationShare(objectRow, 'trip-1')
  assert.equal(fromObject.url, shareUrl('abc'))
  const denied = scriptedSupabase([{ data: null, error: { message: 'permission denied' } }])
  await assert.rejects(findActiveLocationShare(denied, 'trip-1'), /permission denied/)
})

test('createLocationShare inserts after a revoke and surfaces client failures', async () => {
  const revoked = memorySupabase({
    location_shares: [{ id: 'share-1', trip_id: 'trip-1', rider_id: 'rider-1', token: 'old', active: false }],
  })
  const created = await createLocationShare(revoked, 'trip-1', 'rider-2', 'https://example.com/')
  assert.equal(revoked.tables.location_shares.length, 2)
  assert.equal(created.active, true)
  assert.match(created.token, /^[0-9a-f]{32}$/)
  assert.equal(created.url, `https://example.com/share/${created.token}`)
  assert.equal(revoked.tables.location_shares[1].rider_id, 'rider-2')
  assert.equal(revoked.tables.location_shares[1].trip_id, 'trip-1')

  await assert.rejects(createLocationShare(null, 'trip-1', 'rider-1'), /Supabase is not configured/)
  await assert.rejects(createLocationShare(memorySupabase(), '', 'rider-1'), /trip and rider required/)
  await assert.rejects(createLocationShare(memorySupabase(), 'trip-1', ''), /trip and rider required/)

  const readFail = memorySupabase({ fail: { table: 'location_shares', op: 'select', message: 'read failed' } })
  await assert.rejects(createLocationShare(readFail, 'trip-1', 'rider-1'), /read failed/)
  assert.equal(readFail.tables.location_shares.length, 0)

  const insertFail = memorySupabase({ fail: { table: 'location_shares', op: 'insert', message: 'insert failed' } })
  await assert.rejects(createLocationShare(insertFail, 'trip-1', 'rider-1'), /insert failed/)
  assert.equal(insertFail.tables.location_shares.length, 0)

  const noToken = scriptedSupabase([
    { data: [], error: null },
    { data: { id: 'x', active: true }, error: null },
  ])
  await assert.rejects(createLocationShare(noToken, 'trip-1', 'rider-1'), /Share created without token/)
})

test('location points reject a missing fix and keep a zero accuracy', async () => {
  await assert.rejects(
    postLocationPoint(null, { shareId: 'share-1', lat: 1, lng: 2 }),
    /Supabase is not configured/,
  )
  await assert.rejects(
    postLocationPoint(memorySupabase(), { shareId: '', lat: 1, lng: 2 }),
    /share required/,
  )
  await assert.rejects(
    postLocationPoint(memorySupabase(), { shareId: 'share-1', lat: Number.NaN, lng: 2 }),
    /GPS coordinates required/,
  )
  await assert.rejects(
    postLocationPoint(memorySupabase(), { shareId: 'share-1', lat: 1, lng: Infinity }),
    /GPS coordinates required/,
  )

  const db = memorySupabase()
  await postLocationPoint(db, { shareId: 'share-1', lat: 0, lng: 0, accuracy: 0 })
  assert.deepEqual(db.tables.location_points[0], {
    id: 'location_points-1',
    created_at: '2026-09-24T00:00:00.000Z',
    share_id: 'share-1',
    lat: 0,
    lng: 0,
    accuracy_m: 0,
  })
  await postLocationPoint(db, { shareId: 'share-1', lat: 34.67, lng: -82.84, accuracy: Number.NaN })
  assert.equal(db.tables.location_points[1].accuracy_m, null)

  const failing = memorySupabase({ fail: { table: 'location_points', op: 'insert', message: 'disk full' } })
  await assert.rejects(
    postLocationPoint(failing, { shareId: 'share-1', lat: 1, lng: 2 }),
    /disk full/,
  )
  assert.equal(failing.tables.location_points.length, 0)
})

test('revoke is a no-op without a client or id and does not clear a different share', async () => {
  const db = memorySupabase({
    location_shares: [
      { id: 'keep', trip_id: 'trip-1', token: 'a', active: true },
      { id: 'drop', trip_id: 'trip-1', token: 'b', active: true },
    ],
  })
  await revokeLocationShare(null, 'drop')
  await revokeLocationShare(db, '')
  assert.equal(db.tables.location_shares.every((row) => row.active === true), true)
  await revokeLocationShare(db, 'drop')
  const dropped = db.tables.location_shares.find((row) => row.id === 'drop')
  assert.equal(dropped.active, false)
  assert.match(dropped.revoked_at, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(db.tables.location_shares.find((row) => row.id === 'keep').active, true)

  const failing = memorySupabase({
    location_shares: [{ id: 'drop', active: true }],
    fail: { table: 'location_shares', op: 'update', message: 'revoke failed' },
  })
  await assert.rejects(revokeLocationShare(failing, 'drop'), /revoke failed/)
  assert.equal(failing.tables.location_shares[0].active, true)
})

test('SOS log stores finite coordinates and refuses a client or an unsigned trip', async () => {
  assert.deepEqual(
    await logSosEvent(null, { tripId: 'trip-1', userId: 'rider-1', channel: 'tel_911' }),
    { ok: false, error: 'Supabase is not configured' },
  )
  assert.deepEqual(
    await logSosEvent(memorySupabase(), { tripId: '', userId: 'rider-1', channel: 'sms' }),
    { ok: false, error: 'Sign in on an active trip to save this SOS' },
  )
  assert.deepEqual(
    await logSosEvent(memorySupabase(), { tripId: 'trip-1', userId: '', channel: 'sms' }),
    { ok: false, error: 'Sign in on an active trip to save this SOS' },
  )

  const db = memorySupabase()
  const unknown = await logSosEvent(db, { tripId: 'trip-1', userId: 'rider-1', channel: 'pager' })
  assert.equal(unknown.ok, false)
  assert.equal(db.tables.sos_events.length, 0)

  const partial = await logSosEvent(db, {
    tripId: 'trip-1',
    userId: 'rider-1',
    lat: 34.5,
    lng: Number.NaN,
    channel: 'tel_cupd',
  })
  assert.equal(partial.ok, true)
  assert.equal(partial.event.lat, 34.5)
  assert.equal(partial.event.lng, null)
  assert.equal(partial.event.channel, 'tel_cupd')
  assert.equal(db.tables.sos_events[0].user_id, 'rider-1')

  const zero = await logSosEvent(db, {
    tripId: 'trip-1',
    userId: 'rider-1',
    lat: 0,
    lng: 0,
    channel: 'mailto',
  })
  assert.equal(zero.event.lat, 0)
  assert.equal(zero.event.lng, 0)

  const failing = memorySupabase({ fail: { table: 'sos_events', op: 'insert', message: 'rls' } })
  assert.deepEqual(
    await logSosEvent(failing, { tripId: 'trip-1', userId: 'rider-1', channel: 'web_share' }),
    { ok: false, error: 'rls' },
  )
  assert.equal(failing.tables.sos_events.length, 0)
})

test('recent SOS reads are limited to this trip, the last six hours, and 20 rows', async () => {
  assert.deepEqual(await fetchRecentSosEvents(null, 'trip-1'), [])
  assert.deepEqual(await fetchRecentSosEvents(memorySupabase(), ''), [])

  const now = Date.now()
  const db = memorySupabase({
    sos_events: [
      { id: 'old', trip_id: 'trip-1', user_id: 'a', channel: 'banner', created_at: new Date(now - 7 * 60 * 60 * 1000).toISOString() },
      { id: 'other', trip_id: 'trip-2', user_id: 'a', channel: 'banner', created_at: new Date(now - 1000).toISOString() },
      { id: 'mid', trip_id: 'trip-1', user_id: 'b', channel: 'sms', lat: 1, lng: 2, created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString() },
      { id: 'new', trip_id: 'trip-1', user_id: 'a', channel: 'tel_911', created_at: new Date(now - 60 * 1000).toISOString() },
    ],
  })
  const rows = await fetchRecentSosEvents(db, 'trip-1')
  assert.deepEqual(rows.map((row) => row.id), ['new', 'mid'])

  const many = memorySupabase({
    sos_events: Array.from({ length: 22 }, (_, i) => ({
      id: `e${i}`,
      trip_id: 'trip-1',
      user_id: 'a',
      channel: 'banner',
      created_at: new Date(now - (22 - i) * 60 * 1000).toISOString(),
    })),
  })
  const limited = await fetchRecentSosEvents(many, 'trip-1')
  assert.equal(limited.length, 20)
  assert.equal(limited[0].id, 'e21')
  assert.equal(limited.at(-1).id, 'e2')

  const failing = memorySupabase({
    sos_events: [{ id: 'hidden', trip_id: 'trip-1', user_id: 'a', channel: 'banner', created_at: new Date(now).toISOString() }],
    fail: { table: 'sos_events', op: 'select', message: 'down' },
  })
  assert.deepEqual(await fetchRecentSosEvents(failing, 'trip-1'), [])
})

test('emergency contact list is per user and ordered oldest first', async () => {
  assert.deepEqual(await listEmergencyContacts(null, 'rider-1'), {
    contacts: [],
    error: 'Supabase is not configured',
  })
  assert.deepEqual(await listEmergencyContacts(memorySupabase(), ''), { contacts: [], error: null })

  const db = memorySupabase({
    emergency_contacts: [
      { id: 'b', user_id: 'rider-1', name: 'B', phone: '8646562222', created_at: '2026-09-24T02:00:00.000Z' },
      { id: 'a', user_id: 'rider-1', name: 'A', phone: '8646561111', created_at: '2026-09-24T01:00:00.000Z' },
      { id: 'c', user_id: 'other', name: 'C', phone: '8646563333', created_at: '2026-09-24T00:00:00.000Z' },
    ],
  })
  const listed = await listEmergencyContacts(db, 'rider-1')
  assert.equal(listed.error, null)
  assert.deepEqual(listed.contacts.map((row) => row.id), ['a', 'b'])

  const failing = memorySupabase({ fail: { table: 'emergency_contacts', op: 'select', message: 'nope' } })
  assert.deepEqual(await listEmergencyContacts(failing, 'rider-1'), { contacts: [], error: 'nope' })
})

test('saving an emergency contact blocks bad input, other users, and a full list', async () => {
  const invalid = await saveEmergencyContact(memorySupabase(), 'rider-1', { name: '', phone: '8646562222' })
  assert.equal(invalid.ok, false)
  assert.match(invalid.error, /name/i)

  assert.deepEqual(
    await saveEmergencyContact(null, 'rider-1', { name: 'A', phone: '8646562222' }),
    { ok: false, error: 'Supabase is not configured' },
  )
  assert.deepEqual(
    await saveEmergencyContact(memorySupabase(), '', { name: 'A', phone: '8646562222' }),
    { ok: false, error: 'Sign in to save an emergency contact' },
  )

  const db = memorySupabase({
    emergency_contacts: Array.from({ length: 5 }, (_, i) => ({
      id: `other-${i}`,
      user_id: 'other',
      name: 'Other',
      phone: '8646562222',
      created_at: `2026-09-24T00:0${i}:00.000Z`,
    })),
  })
  const saved = await saveEmergencyContact(db, 'rider-1', {
    name: 'Mine',
    phone: '+1 864 656 1111',
    relationship: 'Parent',
  })
  assert.equal(saved.ok, true)
  assert.equal(saved.contact.phone, '+18646561111')
  assert.equal(saved.contact.relationship, 'Parent')
  assert.equal(saved.contact.user_id, 'rider-1')

  for (let i = 0; i < 4; i += 1) {
    db.tables.emergency_contacts.push({
      id: `mine-${i}`,
      user_id: 'rider-1',
      name: 'Extra',
      phone: '8646562222',
      created_at: `2026-09-24T01:0${i}:00.000Z`,
    })
  }
  const edited = await saveEmergencyContact(db, 'rider-1', {
    id: saved.contact.id,
    name: 'Mine Edited',
    phone: '8646561111',
    relationship: '',
  })
  assert.equal(edited.ok, true)
  assert.equal(edited.contact.name, 'Mine Edited')
  assert.equal(edited.contact.relationship, null)
  assert.equal(db.tables.emergency_contacts.filter((row) => row.user_id === 'rider-1').length, 5)
  const blocked = await saveEmergencyContact(db, 'rider-1', { name: 'Sixth', phone: '8646562222' })
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /5 emergency contacts/)

  const stolen = await saveEmergencyContact(db, 'stranger', {
    id: saved.contact.id,
    name: 'Hijack',
    phone: '8646561111',
  })
  assert.equal(stolen.ok, false)
  assert.equal(db.tables.emergency_contacts.find((row) => row.id === saved.contact.id).name, 'Mine Edited')

  const missing = await saveEmergencyContact(
    scriptedSupabase([{ data: null, error: null }]),
    'rider-1',
    { id: 'gone', name: 'A', phone: '8646562222' },
  )
  assert.deepEqual(missing, { ok: false, error: 'Contact not found' })

  const listFail = memorySupabase({ fail: { table: 'emergency_contacts', op: 'select', message: 'list down' } })
  assert.deepEqual(
    await saveEmergencyContact(listFail, 'rider-1', { name: 'A', phone: '8646562222' }),
    { ok: false, error: 'list down' },
  )
  const writeFail = memorySupabase({ fail: { table: 'emergency_contacts', op: 'insert', message: 'write down' } })
  assert.deepEqual(
    await saveEmergencyContact(writeFail, 'rider-1', { name: 'A', phone: '8646562222' }),
    { ok: false, error: 'write down' },
  )
  assert.equal(writeFail.tables.emergency_contacts.length, 0)
})

test('deleteEmergencyContact refuses a missing client and leaves another user alone', async () => {
  assert.deepEqual(await deleteEmergencyContact(null, 'rider-1', 'mine'), {
    ok: false,
    error: 'Supabase is not configured',
  })
  assert.deepEqual(await deleteEmergencyContact(memorySupabase(), '', 'mine'), {
    ok: false,
    error: 'Contact required',
  })
  assert.deepEqual(await deleteEmergencyContact(memorySupabase(), 'rider-1', ''), {
    ok: false,
    error: 'Contact required',
  })

  const db = memorySupabase({
    emergency_contacts: [
      { id: 'mine', user_id: 'rider-1', name: 'A', phone: '8646562222' },
      { id: 'theirs', user_id: 'other', name: 'B', phone: '8646563333' },
    ],
  })
  const wrongUser = await deleteEmergencyContact(db, 'rider-1', 'theirs')
  assert.equal(wrongUser.ok, true)
  assert.deepEqual(db.tables.emergency_contacts.map((row) => row.id), ['mine', 'theirs'])
  assert.deepEqual(await deleteEmergencyContact(db, 'rider-1', 'mine'), { ok: true })
  assert.deepEqual(db.tables.emergency_contacts.map((row) => row.id), ['theirs'])

  const failing = memorySupabase({
    emergency_contacts: [{ id: 'mine', user_id: 'rider-1', name: 'A', phone: '8646562222' }],
    fail: { table: 'emergency_contacts', op: 'delete', message: 'nope' },
  })
  assert.deepEqual(await deleteEmergencyContact(failing, 'rider-1', 'mine'), { ok: false, error: 'nope' })
  assert.equal(failing.tables.emergency_contacts.length, 1)
})
