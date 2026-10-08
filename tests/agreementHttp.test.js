import assert from 'node:assert/strict'
import test from 'node:test'
import {
  handleCorrectAgreement,
  handleEmailAgreement,
  handleSignAgreement,
  requestClientIp,
} from '../server/agreementHttp.js'
import driverHandler from '../api/driver.js'
import { IC_AGREEMENT_VERSION } from '../shared/icAgreement.js'
import { newSignToken, signingUrl } from '../server/agreementMail.js'

function createFakeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, val) {
      this.headers[key.toLowerCase()] = val
    },
    end(data) {
      this.body = data
    },
    get json() {
      try {
        return JSON.parse(this.body)
      } catch {
        return null
      }
    },
  }
}

function mockSb(initialTables = {}) {
  const tables = {
    profiles: [],
    driver_applications: [],
    vehicles: [],
    driver_documents: [],
    driver_tax_info: [],
    driver_agreement_packets: [],
    driver_agreement_sign_links: [],
    driver_agreement_sends: [],
    driver_agreements: [],
    ...initialTables,
  }

  return {
    _tables: tables,
    from(table) {
      if (!tables[table]) tables[table] = []
      const filters = []
      let limitCount = null

      const chain = {
        select() {
          return chain
        },
        eq(col, val) {
          filters.push({ col, op: 'eq', val })
          return chain
        },
        is(col, val) {
          filters.push({ col, op: 'is', val })
          return chain
        },
        order() {
          return chain
        },
        limit(n) {
          limitCount = n
          return chain
        },
        async maybeSingle() {
          const rows = tables[table].filter((r) =>
            filters.every((f) => {
              if (f.op === 'eq') return r[f.col] === f.val
              if (f.op === 'is') return f.val === null ? r[f.col] == null : r[f.col] === f.val
              return true
            })
          )
          return { data: rows[0] || null, error: null }
        },
        async single() {
          const res = await chain.maybeSingle()
          if (!res.data) return { data: null, error: { message: 'Row not found' } }
          return res
        },
        insert(rowOrRows) {
          const inserted = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
          for (const item of inserted) {
            const entry = { id: item.id || `gen-${Math.random().toString(36).slice(2, 9)}`, ...item }
            tables[table].push(entry)
          }
          return {
            select() {
              return {
                maybeSingle: async () => ({ data: tables[table].at(-1), error: null }),
                single: async () => ({ data: tables[table].at(-1), error: null }),
              }
            },
            then(resolve) {
              resolve({ data: tables[table].at(-1), error: null })
            },
          }
        },
        update(patch) {
          const updateChain = {
            eq(col, val) {
              filters.push({ col, op: 'eq', val })
              return updateChain
            },
            is(col, val) {
              filters.push({ col, op: 'is', val })
              return updateChain
            },
            select() {
              return {
                maybeSingle: async () => ({ data: tables[table][0] || null, error: null }),
              }
            },
            then(resolve) {
              for (const row of tables[table]) {
                const match = filters.every((f) => {
                  if (f.op === 'eq') return row[f.col] === f.val
                  if (f.op === 'is') return f.val === null ? row[f.col] == null : row[f.col] === f.val
                  return true
                })
                if (match) Object.assign(row, patch)
              }
              resolve({ error: null })
            },
          }
          return updateChain
        },
        upsert(rowOrRows, opts = {}) {
          const incoming = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
          const conflictCols = (opts.onConflict || 'id').split(',')
          for (const item of incoming) {
            const idx = tables[table].findIndex((r) =>
              conflictCols.every((col) => r[col] === item[col])
            )
            if (idx >= 0) {
              tables[table][idx] = { ...tables[table][idx], ...item }
            } else {
              tables[table].push({ id: item.id || `gen-${Math.random().toString(36).slice(2, 9)}`, ...item })
            }
          }
          return {
            then(resolve) {
              resolve({ error: null })
            },
          }
        },
        then(resolve) {
          const rows = tables[table].filter((r) =>
            filters.every((f) => {
              if (f.op === 'eq') return r[f.col] === f.val
              if (f.op === 'is') return f.val === null ? r[f.col] == null : r[f.col] === f.val
              return true
            })
          )
          const data = limitCount != null ? rows.slice(0, limitCount) : rows
          resolve({ data, error: null })
        },
      }
      return chain
    },
  }
}

test('requestClientIp extracts client IP with headers, truncation, and socket fallback', () => {
  assert.equal(requestClientIp(null), null)
  assert.equal(requestClientIp({}), null)

  // x-forwarded-for with multiple proxy IPs takes the first one
  const forwardedReq = {
    headers: {
      'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178',
    },
  }
  assert.equal(requestClientIp(forwardedReq), '203.0.113.195')

  // Case-insensitive header lookup
  const upperReq = {
    headers: {
      'X-Forwarded-For': '  198.51.100.44  ',
    },
  }
  assert.equal(requestClientIp(upperReq), '198.51.100.44')

  // Truncates long IP strings to 80 chars
  const longReq = {
    headers: {
      'x-forwarded-for': 'a'.repeat(120),
    },
  }
  assert.equal(requestClientIp(longReq).length, 80)

  // Falls back to req.socket.remoteAddress
  const socketReq = {
    headers: {},
    socket: { remoteAddress: '192.168.1.10' },
  }
  assert.equal(requestClientIp(socketReq), '192.168.1.10')
})

test('handleCorrectAgreement bounds: validation, updates, and packet generation', async () => {
  const driverId = '11111111-2222-3333-4444-555555555555'
  const sb = mockSb({
    profiles: [{ id: driverId, full_name: 'Alex Driver', email: 'alex@clemson.edu', phone: '8645550100' }],
    driver_applications: [{ profile_id: driverId, applicant_email: 'alex.driver@example.com', work_eligibility_category: 'citizen' }],
    vehicles: [{ id: 'veh-1', driver_id: driverId, make: 'Toyota', model: 'Camry', color: 'Silver', plate: 'SC123', seats: 4 }],
    driver_tax_info: [{ profile_id: driverId, legal_name: 'Alexander Driver', address_line: '123 Tiger Way', tin_last4: '1234', tax_classification: 'individual' }],
  })

  // Missing profileId -> 400
  const res1 = createFakeResponse()
  await handleCorrectAgreement(sb, res1, {})
  assert.equal(res1.statusCode, 400)
  assert.match(res1.json.error, /profileId is required/i)

  // Empty particulars -> 400
  const res2 = createFakeResponse()
  await handleCorrectAgreement(sb, res2, { profileId: driverId, particulars: {} })
  assert.equal(res2.statusCode, 400)
  assert.match(res2.json.error, /No application fields to correct/i)

  // Non-object particulars -> 400
  const res3 = createFakeResponse()
  await handleCorrectAgreement(sb, res3, { profileId: driverId, particulars: 'bad' })
  assert.equal(res3.statusCode, 400)

  // Valid updates -> 200 and regenerates prefill
  const res4 = createFakeResponse()
  await handleCorrectAgreement(sb, res4, {
    profileId: driverId,
    particulars: {
      legal_name: 'Alexander T. Driver',
      vehicle_make: 'Honda',
      vehicle_model: 'Accord',
      vehicle_seats: 5,
    },
  })
  assert.equal(res4.statusCode, 200)
  assert.equal(res4.json.ok, true)
  assert.equal(res4.json.prefill.legal_name, 'Alexander T. Driver')
  assert.equal(res4.json.prefill.vehicle_make, 'Honda')
  assert.equal(res4.json.prefill.vehicle_model, 'Accord')
  assert.equal(res4.json.prefill.vehicle_seats, '5')
  assert.ok(res4.json.html_snapshot)
  assert.ok(res4.json.html_sha256)

  // Updated rows in database
  const taxRow = sb._tables.driver_tax_info.find((t) => t.profile_id === driverId)
  assert.equal(taxRow.legal_name, 'Alexander T. Driver')
  const vehRow = sb._tables.vehicles.find((v) => v.id === 'veh-1')
  assert.equal(vehRow.make, 'Honda')
  assert.equal(vehRow.seats, 5)
})

test('handleEmailAgreement bounds: profile validation, packet reuse, and signing token generation', async () => {
  const adminUser = { id: 'admin-1', email: 'ops@clemsonrides.com' }
  const driverId = '22222222-3333-4444-5555-666666666666'
  const sb = mockSb({
    profiles: [{ id: driverId, full_name: 'Taylor Driver', email: 'taylor@clemson.edu', phone: '8645550200' }],
    driver_applications: [{ profile_id: driverId, applicant_email: 'taylor.app@example.com', work_eligibility_category: 'citizen' }],
    vehicles: [{ id: 'veh-2', driver_id: driverId, make: 'Ford', model: 'Escape', color: 'White', plate: 'SC456', seats: 4 }],
    driver_tax_info: [{ profile_id: driverId, legal_name: 'Taylor Driver', address_line: '456 College Ave', tin_last4: '5678', tax_classification: 'individual' }],
  })

  // Missing profileId -> 400
  const res1 = createFakeResponse()
  await handleEmailAgreement(sb, res1, adminUser, {})
  assert.equal(res1.statusCode, 400)
  assert.match(res1.json.error, /profileId is required/i)

  // Valid send: creates signing link and send record (503 when Resend unset, with copyable signing_url)
  const res2 = createFakeResponse()
  await handleEmailAgreement(sb, res2, adminUser, { profileId: driverId })
  assert.equal(res2.statusCode, 503)
  assert.equal(res2.json.emailed, false)
  assert.equal(res2.json.copyable, true)
  assert.ok(res2.json.signing_url)
  assert.match(res2.json.signing_url, /#\/sign-agreement\?token=/)

  const link = sb._tables.driver_agreement_sign_links.find((l) => l.profile_id === driverId)
  assert.ok(link)
  assert.equal(link.agreement_version, IC_AGREEMENT_VERSION)
  assert.equal(link.created_by, adminUser.id)

  const send = sb._tables.driver_agreement_sends.find((s) => s.profile_id === driverId)
  assert.ok(send)
  assert.equal(send.to_address, 'taylor.app@example.com')
})

test('handleSignAgreement bounds: GET preview, POST submit, method 405, and viewer isolation', async () => {
  const driverId = '33333333-4444-5555-6666-777777777777'
  const otherDriverId = '44444444-5555-6666-7777-888888888888'
  const driverUser = { id: driverId, email: 'driver3@clemson.edu' }

  const { token, tokenHash } = newSignToken()
  const expiresAt = new Date(Date.now() + 86400000).toISOString()
  const packetSha256 = 'abc123sha256'

  const sb = mockSb({
    profiles: [
      { id: driverId, full_name: 'Morgan Driver', email: 'driver3@clemson.edu' },
      { id: otherDriverId, full_name: 'Other Driver', email: 'other@clemson.edu' },
    ],
    driver_agreement_packets: [
      {
        profile_id: driverId,
        agreement_version: IC_AGREEMENT_VERSION,
        prefill: { legal_name: 'Morgan Driver' },
        html_snapshot: '<h1>Contractor Agreement</h1>',
        html_sha256: packetSha256,
      },
    ],
    driver_agreement_sign_links: [
      {
        id: 'link-3',
        profile_id: driverId,
        agreement_version: IC_AGREEMENT_VERSION,
        packet_sha256: packetSha256,
        token_hash: tokenHash,
        expires_at: expiresAt,
        used_at: null,
        revoked_at: null,
      },
    ],
  })

  // 1. Method bounds: DELETE -> 405
  const deleteRes = createFakeResponse()
  await handleSignAgreement({ method: 'DELETE', url: '/api/driver?action=sign-agreement' }, deleteRes, sb, driverUser)
  assert.equal(deleteRes.statusCode, 405)

  // 2. GET preview with valid token by the owning driver -> 200
  const getRes = createFakeResponse()
  await handleSignAgreement({
    method: 'GET',
    url: `/api/driver?action=sign-agreement&token=${token}`,
  }, getRes, sb, driverUser)
  assert.equal(getRes.statusCode, 200)
  assert.equal(getRes.json.agreement_version, IC_AGREEMENT_VERSION)
  assert.equal(getRes.json.html_snapshot, '<h1>Contractor Agreement</h1>')
  assert.equal(getRes.json.html_sha256, packetSha256)

  // 3. GET preview with valid token by a DIFFERENT driver -> 403 (owner isolation)
  const otherRes = createFakeResponse()
  await handleSignAgreement({
    method: 'GET',
    url: `/api/driver?action=sign-agreement&token=${token}`,
  }, otherRes, sb, { id: otherDriverId })
  assert.equal(otherRes.statusCode, 403)
  assert.match(otherRes.json.error, /belongs to another driver/i)

  // 4. POST with missing acceptance terms -> 400
  const noAcceptRes = createFakeResponse()
  await handleSignAgreement({
    method: 'POST',
    url: '/api/driver?action=sign-agreement',
    body: { token, signatureName: 'Morgan Driver', accepted: false },
  }, noAcceptRes, sb, driverUser)
  assert.equal(noAcceptRes.statusCode, 400)
  assert.match(noAcceptRes.json.error, /accept the agreement/i)

  // 5. POST with valid acceptance and signature name -> 200
  const signRes = createFakeResponse()
  await handleSignAgreement({
    method: 'POST',
    url: '/api/driver?action=sign-agreement',
    headers: { 'x-forwarded-for': '198.51.100.99', 'user-agent': 'TigerRideApp/1.0' },
    body: { token, signatureName: 'Morgan Driver', accepted: true },
  }, signRes, sb, driverUser)
  assert.equal(signRes.statusCode, 200)
  assert.equal(signRes.json.ok, true)

  // Verify link marked used
  const linkRow = sb._tables.driver_agreement_sign_links.find((l) => l.id === 'link-3')
  assert.ok(linkRow.used_at)

  // Verify signature record created
  const sigRow = sb._tables.driver_agreements.find((s) => s.profile_id === driverId)
  assert.ok(sigRow)
  assert.equal(sigRow.signature_name, 'Morgan Driver')
  assert.equal(sigRow.agreement_version, IC_AGREEMENT_VERSION)

  // 6. POST reuse of already-used link -> 403
  const reuseRes = createFakeResponse()
  await handleSignAgreement({
    method: 'POST',
    url: '/api/driver?action=sign-agreement',
    body: { token, signatureName: 'Morgan Driver', accepted: true },
  }, reuseRes, sb, driverUser)
  assert.equal(reuseRes.statusCode, 403)
  assert.match(reuseRes.json.error, /already used/i)
})

test('api/driver action=sign-agreement route integration: preflight, auth, and 503 missing sb', async () => {
  const driverUser = { id: 'driver-route-test', email: 'driver@clemson.edu' }

  // 1. OPTIONS preflight -> 204
  const optRes = createFakeResponse()
  await driverHandler({ method: 'OPTIONS', url: '/api/driver?action=sign-agreement' }, optRes)
  assert.equal(optRes.statusCode, 204)

  // 2. Missing service role key -> 503
  const noSbRes = createFakeResponse()
  await driverHandler({
    method: 'GET',
    url: '/api/driver?action=sign-agreement&token=any',
  }, noSbRes, { sb: null, user: driverUser })
  assert.equal(noSbRes.statusCode, 503)
  assert.match(noSbRes.json.error, /SUPABASE_SERVICE_ROLE_KEY not configured/i)

  // 3. Unauthenticated user -> 401
  const unauthRes = createFakeResponse()
  await driverHandler({
    method: 'GET',
    url: '/api/driver?action=sign-agreement&token=any',
  }, unauthRes, { sb: mockSb(), user: null })
  assert.equal(unauthRes.statusCode, 401)
  assert.match(unauthRes.json.error, /Sign in required/i)
})
