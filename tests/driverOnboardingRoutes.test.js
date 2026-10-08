import assert from 'node:assert/strict'
import test from 'node:test'
import {
  handleDriverSignup,
  handleDriverSubmitReview,
} from '../server/driverRoutes.js'
import driverHandler from '../api/driver.js'

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

function createFakeRequest({ method = 'POST', url = '/api/driver?action=signup', body = null } = {}) {
  return {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    body,
  }
}

function mockSb(initialTables = {}) {
  const tables = {
    profiles: [],
    driver_applications: [],
    vehicles: [],
    driver_status: [],
    student_verifications: [],
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
        neq(col, val) {
          filters.push({ col, op: 'neq', val })
          return chain
        },
        order() {
          return chain
        },
        limit(n) {
          limitCount = n
          return chain
        },
        then(resolve) {
          let rows = tables[table].filter((r) =>
            filters.every((f) => {
              if (f.op === 'eq') return r[f.col] === f.val
              if (f.op === 'neq') return r[f.col] !== f.val
              return true
            })
          )
          if (limitCount != null) rows = rows.slice(0, limitCount)
          resolve({ data: rows, error: null })
        },
        async maybeSingle() {
          const rows = tables[table].filter((r) =>
            filters.every((f) => {
              if (f.op === 'eq') return r[f.col] === f.val
              if (f.op === 'neq') return r[f.col] !== f.val
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
        upsert(rowOrRows, opts = {}) {
          const inserted = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
          for (const item of inserted) {
            const conflictKey = opts.onConflict || 'id'
            const idx = tables[table].findIndex((r) => r[conflictKey] === item[conflictKey])
            if (idx >= 0) {
              tables[table][idx] = { ...tables[table][idx], ...item }
            } else {
              const entry = { id: item.id || `gen-${Math.random().toString(36).slice(2, 9)}`, ...item }
              tables[table].push(entry)
            }
          }
          return {
            select() {
              return {
                single: async () => ({ data: tables[table].at(-1), error: null }),
                maybeSingle: async () => ({ data: tables[table].at(-1), error: null }),
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
            neq(col, val) {
              filters.push({ col, op: 'neq', val })
              return updateChain
            },
            select() {
              return {
                single: async () => {
                  const matched = tables[table].filter((r) =>
                    filters.every((f) => {
                      if (f.op === 'eq') return r[f.col] === f.val
                      if (f.op === 'neq') return r[f.col] !== f.val
                      return true
                    })
                  )
                  for (const row of matched) Object.assign(row, patch)
                  return { data: matched[0] || null, error: null }
                },
                maybeSingle: async () => {
                  const matched = tables[table].filter((r) =>
                    filters.every((f) => {
                      if (f.op === 'eq') return r[f.col] === f.val
                      if (f.op === 'neq') return r[f.col] !== f.val
                      return true
                    })
                  )
                  for (const row of matched) Object.assign(row, patch)
                  return { data: matched[0] || null, error: null }
                },
              }
            },
            then(resolve) {
              const matched = tables[table].filter((r) =>
                filters.every((f) => {
                  if (f.op === 'eq') return r[f.col] === f.val
                  if (f.op === 'neq') return r[f.col] !== f.val
                  return true
                })
              )
              for (const row of matched) Object.assign(row, patch)
              resolve({ data: matched, error: null })
            },
          }
          return updateChain
        },
      }

      return chain
    },
  }
}

test('handleDriverSignup: rejects non-POST, missing sb, unauth, and incomplete quiz', async () => {
  const reqGet = createFakeRequest({ method: 'GET' })
  const resGet = createFakeResponse()
  await handleDriverSignup(reqGet, resGet)
  assert.equal(resGet.statusCode, 405)

  const reqPost = createFakeRequest({ method: 'POST', body: {} })
  const resNoSb = createFakeResponse()
  await handleDriverSignup(reqPost, resNoSb, { sb: null })
  assert.equal(resNoSb.statusCode, 503)

  const resNoUser = createFakeResponse()
  await handleDriverSignup(reqPost, resNoUser, { sb: mockSb(), user: null })
  assert.equal(resNoUser.statusCode, 401)

  // Quiz incomplete (missing hasCar / hasInsurance / attestation)
  const resIncompleteQuiz = createFakeResponse()
  await handleDriverSignup(reqPost, resIncompleteQuiz, {
    sb: mockSb(),
    user: { id: 'u-1', email: 'u1@test.com' },
  })
  assert.equal(resIncompleteQuiz.statusCode, 400)
  assert.equal(resIncompleteQuiz.json.code, 'quiz_incomplete')
})

test('handleDriverSignup: validates full name, phone number, and vehicle specs', async () => {
  const user = { id: 'u-2', email: 'driver@test.com', user_metadata: {} }
  const validQuiz = { hasCar: true, hasInsurance: true, attestationAccepted: true }

  // Missing full name
  const resNoName = createFakeResponse()
  await handleDriverSignup(createFakeRequest({
    body: { ...validQuiz, fullName: '', phone: '8645550199' },
  }), resNoName, { sb: mockSb(), user })
  assert.equal(resNoName.statusCode, 400)
  assert.match(resNoName.json.error, /full name is required/i)

  // Short phone
  const resShortPhone = createFakeResponse()
  await handleDriverSignup(createFakeRequest({
    body: { ...validQuiz, fullName: 'Driver Dave', phone: '123' },
  }), resShortPhone, { sb: mockSb(), user })
  assert.equal(resShortPhone.statusCode, 400)
  assert.match(resShortPhone.json.error, /at least 10 digits/i)

  // Missing vehicle fields
  const resNoVeh = createFakeResponse()
  await handleDriverSignup(createFakeRequest({
    body: { ...validQuiz, fullName: 'Driver Dave', phone: '8645550199', make: '', model: '', plate: '' },
  }), resNoVeh, { sb: mockSb(), user })
  assert.equal(resNoVeh.statusCode, 400)
  assert.match(resNoVeh.json.error, /make, model, and plate are required/i)

  // Missing color
  const resNoColor = createFakeResponse()
  await handleDriverSignup(createFakeRequest({
    body: { ...validQuiz, fullName: 'Driver Dave', phone: '8645550199', make: 'Toyota', model: 'Camry', plate: 'SC123' },
  }), resNoColor, { sb: mockSb(), user })
  assert.equal(resNoColor.statusCode, 400)
  assert.match(resNoColor.json.error, /color is required/i)

  // Invalid year
  const resBadYear = createFakeResponse()
  await handleDriverSignup(createFakeRequest({
    body: { ...validQuiz, fullName: 'Driver Dave', phone: '8645550199', make: 'Toyota', model: 'Camry', plate: 'SC123', color: 'White', year: 'old' },
  }), resBadYear, { sb: mockSb(), user })
  assert.equal(resBadYear.statusCode, 400)
  assert.match(resBadYear.json.error, /Vehicle year must be from/i)
})

test('handleDriverSignup: creates driver application, vehicle, and sets driver status for general rider', async () => {
  const sb = mockSb({
    profiles: [{ id: 'u-gen', email: 'driver@gmail.com', role: 'rider' }],
  })
  const user = { id: 'u-gen', email: 'driver@gmail.com', user_metadata: { full_name: 'Gene Driver' } }

  const req = createFakeRequest({
    body: {
      hasCar: true,
      hasInsurance: true,
      attestationAccepted: true,
      fullName: 'Gene Driver',
      phone: '(864) 555-0199',
      make: 'Honda',
      model: 'Accord',
      plate: 'XYZ789',
      color: 'Silver',
      year: 2022,
      seats: 4,
    },
  })
  const res = createFakeResponse()

  await handleDriverSignup(req, res, { sb, user })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json.ok, true)
  assert.equal(res.json.approved, false)
  assert.equal(res.json.student_verified, false)
  assert.equal(res.json.vehicle.make, 'Honda')
  assert.equal(res.json.vehicle.model, 'Accord')
  assert.equal(res.json.vehicle.year, 2022)

  // Verify application row
  const app = sb._tables.driver_applications.find((a) => a.profile_id === 'u-gen')
  assert.ok(app)
  assert.equal(app.has_car, true)
  assert.equal(app.has_insurance, true)

  // Verify driver_status set to offline
  const status = sb._tables.driver_status.find((s) => s.driver_id === 'u-gen')
  assert.ok(status)
  assert.equal(status.online, false)
})

test('handleDriverSignup: auto-verifies Clemson students and records student verification', async () => {
  const sb = mockSb({
    profiles: [{ id: 'u-clemson', email: 'tiger@clemson.edu', role: 'rider' }],
  })
  const user = { id: 'u-clemson', email: 'tiger@clemson.edu' }

  const req = createFakeRequest({
    body: {
      hasCar: true,
      hasInsurance: true,
      attestationAccepted: true,
      fullName: 'Tiger Student',
      phone: '8645550188',
      make: 'Subaru',
      model: 'Outback',
      plate: 'CU1889',
      color: 'Orange',
      year: '2023',
    },
  })
  const res = createFakeResponse()

  await handleDriverSignup(req, res, { sb, user })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json.ok, true)
  assert.equal(res.json.student_verified, true)

  const profile = sb._tables.profiles.find((p) => p.id === 'u-clemson')
  assert.ok(profile.student_verified_at)

  const sv = sb._tables.student_verifications.find((v) => v.profile_id === 'u-clemson')
  assert.ok(sv)
  assert.equal(sv.email, 'tiger@clemson.edu')
})

test('handleDriverSubmitReview: rejects non-POST, unauth, missing info, and blockers', async () => {
  const user = { id: 'u-rev', email: 'driver@clemson.edu' }

  // 1. Non-POST
  const resGet = createFakeResponse()
  await handleDriverSubmitReview(createFakeRequest({ method: 'GET' }), resGet)
  assert.equal(resGet.statusCode, 405)

  // 2. Missing application info
  const resNoApp = createFakeResponse()
  await handleDriverSubmitReview(createFakeRequest(), resNoApp, { sb: mockSb(), user })
  assert.equal(resNoApp.statusCode, 400)
  assert.match(resNoApp.json.error, /save your driver info before submitting/i)

  // 3. Already approved application returns 200
  const sbApproved = mockSb({
    driver_applications: [{ profile_id: 'u-rev', onboarding_status: 'approved' }],
  })
  const resApproved = createFakeResponse()
  await handleDriverSubmitReview(createFakeRequest(), resApproved, { sb: sbApproved, user })
  assert.equal(resApproved.statusCode, 200)
  assert.equal(resApproved.json.onboarding_status, 'approved')

  // 4. Missing required compliance documents (blockers)
  const sbWithApp = mockSb({
    driver_applications: [{ profile_id: 'u-rev', onboarding_status: 'info_saved' }],
  })
  const resBlockers = createFakeResponse()
  await handleDriverSubmitReview(createFakeRequest(), resBlockers, {
    sb: sbWithApp,
    user,
    loadSubmissionContext: async () => ({ blockers: ['license', 'insurance'], error: null }),
  })
  assert.equal(resBlockers.statusCode, 400)
  assert.match(resBlockers.json.error, /finish every required step/i)
  assert.deepEqual(resBlockers.json.missing, ['license', 'insurance'])

  // 5. Missing vehicle on file
  const resNoVeh = createFakeResponse()
  await handleDriverSubmitReview(createFakeRequest(), resNoVeh, {
    sb: sbWithApp,
    user,
    loadSubmissionContext: async () => ({ blockers: [], error: null }),
  })
  assert.equal(resNoVeh.statusCode, 400)
  assert.match(resNoVeh.json.error, /add your vehicle/i)
})

test('handleDriverSubmitReview: attaches agreement packet, notifies admin, and transitions to pending_review', async () => {
  const user = { id: 'u-submit', email: 'applicant@clemson.edu' }
  const sb = mockSb({
    driver_applications: [{ profile_id: 'u-submit', onboarding_status: 'info_saved', applicant_email: 'applicant@clemson.edu' }],
    vehicles: [{ driver_id: 'u-submit', make: 'Toyota', model: 'RAV4', plate: 'CLEM123', color: 'Purple' }],
    profiles: [{ id: 'u-submit', email: 'applicant@clemson.edu', full_name: 'Alex App' }],
  })

  let packetAttached = false
  let adminNotified = false

  const deps = {
    sb,
    user,
    loadSubmissionContext: async () => ({ blockers: [], error: null }),
    attachUnsignedPacket: async () => {
      packetAttached = true
      return { ok: true }
    },
    notifyAdminOfApplication: async () => {
      adminNotified = true
      return { emailed: true, todo: null }
    },
  }

  const res = createFakeResponse()
  await handleDriverSubmitReview(createFakeRequest(), res, deps)

  assert.equal(res.statusCode, 200)
  assert.equal(res.json.ok, true)
  assert.equal(res.json.onboarding_status, 'pending_review')
  assert.equal(res.json.emailed, true)
  assert.equal(packetAttached, true)
  assert.equal(adminNotified, true)

  const app = sb._tables.driver_applications.find((a) => a.profile_id === 'u-submit')
  assert.equal(app.onboarding_status, 'pending_review')
  assert.ok(app.submitted_at)
})

test('api/driver router: dispatches action=signup and action=submit-review correctly', async () => {
  const sb = mockSb({
    profiles: [{ id: 'u-router', email: 'router@gmail.com' }],
  })
  const user = { id: 'u-router', email: 'router@gmail.com' }

  // Action signup incomplete quiz
  const reqSignup = createFakeRequest({
    url: '/api/driver?action=signup',
    body: {},
  })
  const resSignup = createFakeResponse()
  await driverHandler(reqSignup, resSignup, { sb, user })
  assert.equal(resSignup.statusCode, 400)
  assert.equal(resSignup.json.code, 'quiz_incomplete')

  // Action submit-review missing app
  const reqSubmit = createFakeRequest({
    url: '/api/driver?action=submit-review',
    body: {},
  })
  const resSubmit = createFakeResponse()
  await driverHandler(reqSubmit, resSubmit, { sb, user })
  assert.equal(resSubmit.statusCode, 400)
  assert.match(resSubmit.json.error, /save your driver info/i)
})
