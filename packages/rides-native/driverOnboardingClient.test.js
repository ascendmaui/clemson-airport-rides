import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import {
  BACKGROUND_CONSENT_VERSION,
  WORK_ELIGIBILITY_VERSION,
  W9_FORM_VERSION,
  IC_AGREEMENT_TITLE,
  IC_AGREEMENT_VERSION,
  ONBOARDING_FLOW,
  REQUIRED_DOCUMENTS,
  TAX_CLASSIFICATIONS,
  WORK_ELIGIBILITY_CATEGORIES,
  blockerLabel,
  canOpenStep,
  displayTinLast4,
  flowStep,
  onboardingLabel,
  progressSnapshot,
  stepIsComplete,
  submissionBlockers,
  driverQuizError,
  agreementPlainText,
  fetchMyDriverApplication,
  fetchMyDriverDocuments,
  fetchMyTaxProfile,
  fetchMyAgreement,
  loadApplicantInbox,
  replyApplicantInbox,
  loadOnboarding,
  uploadDriverDocument,
  recordFormSignature,
  saveDriverInfo,
  saveEmploymentVerification,
  saveDriverTaxInfo,
  saveDriverW9,
  signDriverAgreement,
  submitDriverReview,
} from './driverOnboardingClient.js'

// ---------------------------------------------------------------------------
// Helpers: fake fetch, fake supabase, and console spy
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function stubFetch(routes = {}) {
  const fetchCalls = []
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options })
    const urlStr = String(url)

    // Handle local file / blob URIs (e.g. uploadDriverDocument reading file.uri)
    if (urlStr.startsWith('file:') || urlStr.startsWith('ph:') || urlStr.startsWith('blob:') || urlStr.startsWith('data:')) {
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return new Uint8Array([1, 2, 3, 4]).buffer
        },
        async text() {
          return 'mock-file-content'
        },
      }
    }

    // Match route handlers by substring
    for (const [key, handler] of Object.entries(routes)) {
      if (urlStr.includes(key)) {
        if (typeof handler === 'function') {
          const res = await handler(urlStr, options)
          if (res && typeof res.text === 'function') return res
          const status = res?.status ?? 200
          const body = res?.body ?? {}
          const headers = res?.headers ?? {}
          return {
            ok: status >= 200 && status < 300,
            status,
            headers: new Headers(headers),
            async text() {
              return typeof body === 'string' ? body : JSON.stringify(body)
            },
            async json() {
              return typeof body === 'string' ? JSON.parse(body) : body
            },
          }
        }
        const { status = 200, body = {}, headers = {} } = handler
        return {
          ok: status >= 200 && status < 300,
          status,
          headers: new Headers(headers),
          async text() {
            return typeof body === 'string' ? body : JSON.stringify(body)
          },
          async json() {
            return typeof body === 'string' ? JSON.parse(body) : body
          },
        }
      }
    }

    // Default 404 response
    return {
      ok: false,
      status: 404,
      async text() {
        return JSON.stringify({ error: `Not found: ${urlStr}` })
      },
      async json() {
        return { error: `Not found: ${urlStr}` }
      },
    }
  }
  return fetchCalls
}

function spyConsole() {
  const logs = []
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
  const record = (level, args) => {
    logs.push({
      level,
      args,
      text: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
    })
  }
  console.log = (...args) => record('log', args)
  console.info = (...args) => record('info', args)
  console.warn = (...args) => record('warn', args)
  console.error = (...args) => record('error', args)

  return {
    logs,
    restore() {
      console.log = original.log
      console.info = original.info
      console.warn = original.warn
      console.error = original.error
    },
    assertNoTin(tin) {
      const digits = String(tin).replace(/\D/g, '')
      for (const entry of logs) {
        assert.equal(entry.text.includes(tin), false, `TIN "${tin}" was logged to console.${entry.level}`)
        if (digits.length >= 4) {
          assert.equal(entry.text.includes(digits), false, `Raw TIN digits "${digits}" logged to console.${entry.level}`)
        }
      }
    },
  }
}

function createFakeSupabase(config = {}) {
  const calls = {
    from: [],
    rpc: [],
    storage: [],
  }

  const queryBuilder = (table, state = {}) => {
    state.table = table
    state.filters = state.filters || []
    state.selectCols = state.selectCols || '*'
    state.operation = state.operation || 'select'
    state.payload = state.payload || null
    state.options = state.options || null

    const execute = () => {
      calls.from.push({ ...state })
      if (config.fromHandler) {
        const handled = config.fromHandler(state)
        if (handled !== undefined) return handled
      }
      const tableConfig = config.tables?.[table]
      if (typeof tableConfig === 'function') {
        return tableConfig(state)
      }
      if (tableConfig && tableConfig.error) {
        return { data: null, error: tableConfig.error }
      }
      const defaultData = tableConfig?.data ?? (state.isSingle || state.isMaybeSingle ? null : [])
      return { data: defaultData, error: null }
    }

    const builder = {
      select(cols = '*') {
        state.selectCols = cols
        return builder
      },
      eq(col, val) {
        state.filters.push({ col, val })
        return builder
      },
      limit(n) {
        state.limit = n
        return builder
      },
      upsert(row, options) {
        state.operation = 'upsert'
        state.payload = row
        state.options = options
        return builder
      },
      update(patch) {
        state.operation = 'update'
        state.payload = patch
        return builder
      },
      insert(row) {
        state.operation = 'insert'
        state.payload = row
        return builder
      },
      async maybeSingle() {
        state.isMaybeSingle = true
        return execute()
      },
      async single() {
        state.isSingle = true
        return execute()
      },
      then(onResolve, onReject) {
        return Promise.resolve(execute()).then(onResolve, onReject)
      },
    }
    return builder
  }

  const client = {
    calls,
    auth: {
      async getSession() {
        return {
          data: {
            session: config.session !== undefined ? config.session : { access_token: 'fake-jwt-token' },
          },
        }
      },
    },
    from(table) {
      return queryBuilder(table)
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args })
      if (config.rpcHandler) {
        const handled = config.rpcHandler(name, args)
        if (handled !== undefined) return handled
      }
      const rpcConfig = config.rpc?.[name]
      if (typeof rpcConfig === 'function') {
        return rpcConfig(args)
      }
      if (rpcConfig) {
        return rpcConfig
      }
      return { data: {}, error: null }
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, bytes, options) {
            calls.storage.push({ bucket, action: 'upload', path, bytes, options })
            if (config.storageHandler) {
              const res = config.storageHandler({ bucket, action: 'upload', path, bytes, options })
              if (res !== undefined) return res
            }
            return { data: { path }, error: null }
          },
          async remove(paths) {
            calls.storage.push({ bucket, action: 'remove', paths })
            if (config.storageHandler) {
              const res = config.storageHandler({ bucket, action: 'remove', paths })
              if (res !== undefined) return res
            }
            return { data: paths, error: null }
          },
        }
      },
    },
  }
  return client
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('constants and shared re-exports match expected values and shapes', () => {
  assert.equal(BACKGROUND_CONSENT_VERSION, 'background-auth-2026-09-24')
  assert.equal(WORK_ELIGIBILITY_VERSION, 'work-eligibility-2026-09-24')
  assert.equal(W9_FORM_VERSION, 'w9-2026-09-24')
  assert.equal(IC_AGREEMENT_VERSION, 'ic-agreement-2026-09-24')
  assert.equal(IC_AGREEMENT_TITLE, 'Clemson RIDES Independent Contractor Agreement')

  assert.ok(Array.isArray(ONBOARDING_FLOW))
  assert.ok(ONBOARDING_FLOW.length >= 8)
  assert.ok(Array.isArray(REQUIRED_DOCUMENTS))
  assert.ok(REQUIRED_DOCUMENTS.length >= 8)
  assert.ok(Array.isArray(TAX_CLASSIFICATIONS))
  assert.ok(TAX_CLASSIFICATIONS.some((c) => c.id === 'individual'))
  assert.ok(Array.isArray(WORK_ELIGIBILITY_CATEGORIES))
  assert.ok(WORK_ELIGIBILITY_CATEGORIES.some((c) => c.id === 'citizen'))

  // Re-exported helper functions
  assert.equal(typeof blockerLabel, 'function')
  assert.equal(typeof canOpenStep, 'function')
  assert.equal(typeof displayTinLast4, 'function')
  assert.equal(typeof flowStep, 'function')
  assert.equal(typeof onboardingLabel, 'function')
  assert.equal(typeof progressSnapshot, 'function')
  assert.equal(typeof stepIsComplete, 'function')
  assert.equal(typeof submissionBlockers, 'function')
  assert.equal(typeof driverQuizError, 'function')

  assert.equal(displayTinLast4('5678'), '••••5678')
})

test('agreementPlainText converts HTML headings and paragraphs into clean plain text', () => {
  const html = '<h1>Agreement</h1><p>First paragraph here.</p><h2>Section 1</h2><p>Second paragraph with <a href="#">link</a> and <strong>bold</strong> text.</p>'
  const plain = agreementPlainText(html)
  assert.equal(plain.includes('<h1>'), false)
  assert.equal(plain.includes('<h2>'), false)
  assert.equal(plain.includes('<p>'), false)
  assert.equal(plain.includes('<strong>'), false)
  assert.ok(plain.includes('Agreement'))
  assert.ok(plain.includes('First paragraph here.'))
  assert.ok(plain.includes('Section 1'))
  assert.ok(plain.includes('Second paragraph with link and bold text.'))

  // Default argument uses IC_AGREEMENT_HTML
  const defaultPlain = agreementPlainText()
  assert.ok(defaultPlain.length > 500)
  assert.equal(defaultPlain.includes('<h1>'), false)
  assert.equal(defaultPlain.includes('</p>'), false)

  // Empty string
  assert.equal(agreementPlainText(''), '')

  // Null returns empty string
  assert.equal(agreementPlainText(null), '')
})

test('requireClient-style failures: save paths throw clear errors when supabase is missing', async () => {
  await assert.rejects(
    () => uploadDriverDocument(null, 'u1', 'license_front', { uri: 'file://img.jpg' }),
    /Supabase is not configured/,
  )
  await assert.rejects(
    () => saveEmploymentVerification(null, 'u1', { backgroundAuthorized: true, category: 'citizen', signatureName: 'Jane Doe' }),
    /Supabase is not configured/,
  )
  await assert.rejects(
    () => saveDriverTaxInfo(null, { legalName: 'Jane Doe', tin: '123456789', taxClassification: 'individual' }),
    /Supabase is not configured/,
  )
  await assert.rejects(
    () => saveDriverW9(null, 'u1', { legalName: 'Jane Doe', tin: '123456789', taxClassification: 'individual', signatureName: 'Jane Doe' }),
    /Supabase is not configured/,
  )
  await assert.rejects(
    () => signDriverAgreement(null, 'Jane Doe'),
    /Supabase is not configured/,
  )
})

test('fetch paths and recordFormSignature return null/empty when supabase or userId is missing', async () => {
  const fakeSb = createFakeSupabase()

  // BUG?: fetchMy* functions return null / [] instead of throwing requireClient-style errors when supabase is missing
  assert.equal(await fetchMyDriverApplication(null, 'u1'), null)
  assert.equal(await fetchMyDriverApplication(fakeSb, null), null)
  assert.equal(await fetchMyDriverApplication(null, null), null)

  assert.deepEqual(await fetchMyDriverDocuments(null, 'u1'), [])
  assert.deepEqual(await fetchMyDriverDocuments(fakeSb, null), [])
  assert.deepEqual(await fetchMyDriverDocuments(null, null), [])

  assert.equal(await fetchMyTaxProfile(null, 'u1'), null)
  assert.equal(await fetchMyTaxProfile(fakeSb, null), null)
  assert.equal(await fetchMyTaxProfile(null, null), null)

  assert.equal(await fetchMyAgreement(null, 'u1'), null)
  assert.equal(await fetchMyAgreement(fakeSb, null), null)
  assert.equal(await fetchMyAgreement(null, null), null)

  // BUG?: recordFormSignature returns null instead of throwing when supabase or userId is missing
  assert.equal(await recordFormSignature(null, 'u1', { formId: 'w9', formVersion: 'v1' }), null)
  assert.equal(await recordFormSignature(fakeSb, null, { formId: 'w9', formVersion: 'v1' }), null)
})

test('fetchMyDriverApplication queries driver_applications by profile_id and handles errors', async () => {
  const fakeApp = { id: 'app-1', profile_id: 'user-42', onboarding_status: 'pending_docs' }
  const sb = createFakeSupabase({
    tables: {
      driver_applications: { data: fakeApp },
    },
  })

  const result = await fetchMyDriverApplication(sb, 'user-42')
  assert.deepEqual(result, fakeApp)
  assert.equal(sb.calls.from.length, 1)
  assert.equal(sb.calls.from[0].table, 'driver_applications')
  assert.deepEqual(sb.calls.from[0].filters, [{ col: 'profile_id', val: 'user-42' }])

  // Error case
  const errSb = createFakeSupabase({
    tables: {
      driver_applications: { error: { message: 'DB connection failure' } },
    },
  })
  await assert.rejects(
    () => fetchMyDriverApplication(errSb, 'user-42'),
    /DB connection failure/,
  )
})

test('fetchMyDriverDocuments returns rich columns and falls back on schema cache error', async () => {
  const richDocs = [
    { id: 'doc-1', doc_type: 'license_front', storage_path: 'p1', review_status: 'pending', match_status: null },
  ]
  const sb = createFakeSupabase({
    tables: {
      driver_documents: { data: richDocs },
    },
  })

  const result = await fetchMyDriverDocuments(sb, 'user-42')
  assert.deepEqual(result, richDocs)

  // Fallback path: rich query returns error with schema cache or review_status column missing
  let callCount = 0
  const fallbackSb = createFakeSupabase({
    tables: {
      driver_documents: () => {
        callCount++
        if (callCount === 1) {
          return { data: null, error: { message: 'column "review_status" does not exist; schema cache reload needed' } }
        }
        return { data: [{ id: 'doc-1', doc_type: 'license_front', storage_path: 'p1' }], error: null }
      },
    },
  })

  const fallbackResult = await fetchMyDriverDocuments(fallbackSb, 'user-42')
  assert.equal(callCount, 2)
  assert.equal(fallbackResult.length, 1)
  assert.equal(fallbackResult[0].doc_type, 'license_front')
  assert.equal(fallbackResult[0].review_status, undefined)

  // Unrelated error on rich query should throw immediately
  const fatalSb = createFakeSupabase({
    tables: {
      driver_documents: { error: { message: 'connection timeout' } },
    },
  })
  await assert.rejects(
    () => fetchMyDriverDocuments(fatalSb, 'user-42'),
    /connection timeout/,
  )
})

test('fetchMyTaxProfile queries driver_tax_info by profile_id and handles errors', async () => {
  const taxRow = { legal_name: 'Alice Driver', tin_last4: '1234', tax_classification: 'individual' }
  const sb = createFakeSupabase({
    tables: {
      driver_tax_info: { data: taxRow },
    },
  })

  const result = await fetchMyTaxProfile(sb, 'user-42')
  assert.deepEqual(result, taxRow)
  assert.deepEqual(sb.calls.from[0].filters, [{ col: 'profile_id', val: 'user-42' }])

  const errSb = createFakeSupabase({
    tables: {
      driver_tax_info: { error: { message: 'permission denied' } },
    },
  })
  await assert.rejects(
    () => fetchMyTaxProfile(errSb, 'user-42'),
    /permission denied/,
  )
})

test('fetchMyAgreement queries driver_agreements by profile_id and IC_AGREEMENT_VERSION', async () => {
  const agreementRow = {
    agreement_version: IC_AGREEMENT_VERSION,
    agreement_sha256: 'abc123hash',
    signature_name: 'Alice Driver',
    signed_at: '2026-09-24T12:00:00Z',
    signer_user_id: 'user-42',
  }
  const sb = createFakeSupabase({
    tables: {
      driver_agreements: { data: agreementRow },
    },
  })

  const result = await fetchMyAgreement(sb, 'user-42')
  assert.deepEqual(result, agreementRow)
  assert.deepEqual(sb.calls.from[0].filters, [
    { col: 'profile_id', val: 'user-42' },
    { col: 'agreement_version', val: IC_AGREEMENT_VERSION },
  ])

  const errSb = createFakeSupabase({
    tables: {
      driver_agreements: { error: { message: 'relation does not exist' } },
    },
  })
  await assert.rejects(
    () => fetchMyAgreement(errSb, 'user-42'),
    /relation does not exist/,
  )
})

test('loadOnboarding aggregates expected keys when fakes return empty rows', async () => {
  const sb = createFakeSupabase({
    tables: {
      driver_applications: { data: null },
      driver_documents: { data: [] },
      driver_tax_info: { data: null },
      driver_agreements: { data: null },
    },
  })

  const bundle = await loadOnboarding(sb, 'user-empty')
  assert.equal(bundle.application, null)
  assert.deepEqual(bundle.documents, [])
  assert.equal(bundle.tax, null)
  assert.equal(bundle.agreement, null)

  assert.deepEqual(bundle.ctx, {
    status: null,
    uploaded: [],
    backgroundAuthorized: false,
    workEligibilityAttested: false,
    workEligibilityCategory: null,
    taxSaved: false,
    agreementSigned: false,
    agreementVersion: null,
    registrationMatch: null,
  })

  assert.equal(bundle.stepId, 'account')
  assert.ok(bundle.blockers.length > 0)
  assert.equal(bundle.progress.stepNumber, 1)
  assert.equal(bundle.progress.total, ONBOARDING_FLOW.length)
  assert.equal(bundle.progress.percent, 0)
})

test('loadOnboarding aggregates correctly when onboarding is fully completed', async () => {
  const fullApp = {
    id: 'app-99',
    profile_id: 'user-99',
    onboarding_status: 'pending_docs',
    background_authorized_at: '2026-09-24T00:00:00Z',
    work_eligibility_attested_at: '2026-09-24T00:00:00Z',
    work_eligibility_category: 'citizen',
  }
  const fullDocs = REQUIRED_DOCUMENTS.map((doc) => ({
    id: `doc-${doc.id}`,
    doc_type: doc.id,
    storage_path: `path/${doc.id}`,
    match_status: doc.id === 'registration' ? 'matched' : null,
  }))
  const fullTax = {
    legal_name: 'Complete Driver',
    tin_last4: '9876',
    tax_classification: 'individual',
  }
  const fullAgreement = {
    agreement_version: IC_AGREEMENT_VERSION,
    signed_at: '2026-09-24T00:00:00Z',
    signature_name: 'Complete Driver',
    signer_user_id: 'user-99',
  }

  const sb = createFakeSupabase({
    tables: {
      driver_applications: { data: fullApp },
      driver_documents: { data: fullDocs },
      driver_tax_info: { data: fullTax },
      driver_agreements: { data: fullAgreement },
    },
  })

  // Ready to submit: all 8 prerequisites complete, ready for review step
  const bundle = await loadOnboarding(sb, 'user-99')
  assert.equal(bundle.ctx.backgroundAuthorized, true)
  assert.equal(bundle.ctx.workEligibilityAttested, true)
  assert.equal(bundle.ctx.taxSaved, true)
  assert.equal(bundle.ctx.agreementSigned, true)
  assert.deepEqual(bundle.blockers, [])
  assert.equal(bundle.stepId, 'review')
  assert.equal(bundle.progress.stepNumber, 9)
  assert.equal(bundle.progress.percent, 89)

  // Once submitted (pending_review), progress reaches 100%
  const submittedSb = createFakeSupabase({
    tables: {
      driver_applications: { data: { ...fullApp, onboarding_status: 'pending_review' } },
      driver_documents: { data: fullDocs },
      driver_tax_info: { data: fullTax },
      driver_agreements: { data: fullAgreement },
    },
  })
  const submittedBundle = await loadOnboarding(submittedSb, 'user-99')
  assert.equal(submittedBundle.progress.percent, 100)
  assert.equal(submittedBundle.progress.label, 'Pending review')
})

test('saveDriverTaxInfo must NOT log the TIN; assert body shape to RPC and that tin is not printed', async () => {
  const spy = spyConsole()
  try {
    const rawTin = '12-3456789'
    const cleanTin = '123456789'
    let rpcCalledWith = null

    const sb = createFakeSupabase({
      rpc: {
        save_driver_tax_info: (args) => {
          rpcCalledWith = args
          return {
            data: {
              legal_name: args.legal_name,
              tin_last4: '6789',
              tax_classification: args.tax_classification,
            },
            error: null,
          }
        },
      },
    })

    const result = await saveDriverTaxInfo(sb, {
      legalName: 'Test Driver',
      tin: rawTin,
      taxClassification: 'individual',
    })

    // Assert RPC body shape
    assert.deepEqual(rpcCalledWith, {
      legal_name: 'Test Driver',
      tin: cleanTin,
      tax_classification: 'individual',
    })

    // Assert return shape contains last 4 only, never the full TIN
    assert.equal(result.legal_name, 'Test Driver')
    assert.equal(result.tin_last4, '6789')
    assert.equal(result.tax_classification, 'individual')
    assert.equal(result.tin, undefined)

    // Assert TIN was NOT logged
    spy.assertNoTin(rawTin)
    spy.assertNoTin(cleanTin)

    // Validation checks
    await assert.rejects(
      () => saveDriverTaxInfo(sb, { legalName: 'Test', tin: '1234', taxClassification: 'individual' }),
      /Enter a 9-digit TIN/,
    )
    await assert.rejects(
      () => saveDriverTaxInfo(sb, { legalName: 'Test', tin: cleanTin, taxClassification: 'invalid_classification' }),
      /Choose a tax classification/,
    )

    // DB error handling
    const errSb = createFakeSupabase({
      rpc: {
        save_driver_tax_info: { data: null, error: { message: 'TIN verification failed' } },
      },
    })
    await assert.rejects(
      () => saveDriverTaxInfo(errSb, { legalName: 'Test', tin: cleanTin, taxClassification: 'individual' }),
      /TIN verification failed/,
    )
  } finally {
    spy.restore()
  }
})

test('saveDriverW9 handles full 9-digit TIN via RPC, schema fallback, and signature-only mode without logging TIN', async () => {
  const spy = spyConsole()
  try {
    const rawTin = '98-7654321'
    const cleanTin = '987654321'
    let rpcArgs = null

    // 1. Happy path RPC
    const sb = createFakeSupabase({
      rpc: {
        save_driver_w9: (args) => {
          rpcArgs = args
          return {
            data: {
              legal_name: args.legal_name,
              tin_last4: '4321',
              tax_classification: args.tax_classification,
            },
            error: null,
          }
        },
      },
    })

    const res = await saveDriverW9(sb, 'user-w9', {
      legalName: 'W9 Driver',
      tin: rawTin,
      taxClassification: 'llc',
      businessName: 'Driver LLC',
      address: '100 Clemson Blvd',
      signatureName: 'W9 Driver',
      signedOn: '2026-09-24',
    })

    assert.equal(rpcArgs.tin, cleanTin)
    assert.equal(rpcArgs.tax_classification, 'llc')
    assert.equal(res.tin_last4, '4321')
    spy.assertNoTin(cleanTin)

    // 2. RPC PGRST202 fallback path -> falls back to saveDriverTaxInfo + extra update
    let fallbackTaxRpcArgs = null
    const fallbackSb = createFakeSupabase({
      rpc: {
        save_driver_w9: { data: null, error: { message: 'function save_driver_w9 does not exist (PGRST202)' } },
        save_driver_tax_info: (args) => {
          fallbackTaxRpcArgs = args
          return { data: { legal_name: args.legal_name, tin_last4: '4321', tax_classification: args.tax_classification }, error: null }
        },
      },
    })

    const fallbackRes = await saveDriverW9(fallbackSb, 'user-w9', {
      legalName: 'W9 Driver',
      tin: rawTin,
      taxClassification: 'individual',
      businessName: 'Solo',
      signatureName: 'W9 Driver',
      signedOn: '2026-09-24',
    })
    assert.equal(fallbackTaxRpcArgs.tin, cleanTin)
    assert.equal(fallbackRes.tin_last4, '4321')

    // 3. Signature-only mode (tin length !== 9)
    await assert.rejects(
      () => saveDriverW9(sb, 'user-w9', { legalName: 'Short', tin: '123', signatureName: 'X' }),
      /Sign the W-9\./,
    )
    await assert.rejects(
      () => saveDriverW9(sb, null, { legalName: 'Short', tin: '123', signatureName: 'Valid Signer' }),
      /Sign the W-9\./,
    )

    const signOnlyRes = await saveDriverW9(sb, 'user-w9', {
      legalName: 'W9 Signer',
      tin: '0',
      signatureName: 'Valid Signer',
      signedOn: '2026-09-24',
    })
    assert.equal(signOnlyRes.legal_name, 'W9 Signer')
    assert.equal(signOnlyRes.tin_last4, undefined)
  } finally {
    spy.restore()
  }
})

test('signDriverAgreement validates supabase, executes RPC, and records signature', async () => {
  let rpcArgs = null
  const sb = createFakeSupabase({
    rpc: {
      sign_driver_agreement: (args) => {
        rpcArgs = args
        return {
          data: {
            agreement_version: IC_AGREEMENT_VERSION,
            signer_user_id: 'user-77',
            signature_name: args.signature_name,
          },
          error: null,
        }
      },
    },
  })

  const res = await signDriverAgreement(sb, 'Alice Signature', { userId: 'user-77' })
  assert.equal(rpcArgs.signature_name, 'Alice Signature')
  assert.equal(res.signer_user_id, 'user-77')

  // Check form signature recorded
  const formSigCall = sb.calls.from.find((c) => c.table === 'driver_form_signatures')
  assert.ok(formSigCall)
  assert.equal(formSigCall.payload.form_id, 'ic_agreement')
  assert.equal(formSigCall.payload.form_version, IC_AGREEMENT_VERSION)

  // RPC error throws
  const errSb = createFakeSupabase({
    rpc: {
      sign_driver_agreement: { data: null, error: { message: 'Already signed' } },
    },
  })
  await assert.rejects(
    () => signDriverAgreement(errSb, 'Alice Signature'),
    /Already signed/,
  )
})

test('submitDriverReview: happy path via authedJson to /api/driver?action=submit-review', async () => {
  const fetchCalls = stubFetch({
    '/api/driver?action=submit-review': {
      status: 200,
      body: { ok: true, onboarding_status: 'pending_review' },
    },
  })

  const sb = createFakeSupabase()
  const result = await submitDriverReview(sb, 'user-100')
  assert.equal(result.ok, true)
  assert.equal(result.onboarding_status, 'pending_review')
  assert.equal(fetchCalls.length, 1)
  assert.ok(fetchCalls[0].url.includes('/api/driver?action=submit-review'))
  assert.equal(fetchCalls[0].options.method, 'POST')
})

test('submitDriverReview: auth-missing and API unavailable direct fallback paths', async () => {
  const sb = createFakeSupabase({
    tables: {
      driver_applications: { data: null },
      driver_documents: { data: [] },
      driver_tax_info: { data: null },
      driver_agreements: { data: null },
    },
  })

  // 1. API unavailable (503) and userId missing
  stubFetch({
    '/api/driver?action=submit-review': {
      status: 503,
      body: { error: 'Service Unavailable' },
    },
  })

  // BUG?: submitDriverReview rethrows raw 503 / unavailable error when userId is missing rather than a user-friendly auth error
  await assert.rejects(
    () => submitDriverReview(sb, null),
    (err) => err.unavailable === true,
  )

  // 2. API unavailable (503), userId present, but onboarding incomplete -> throws blockers error
  await assert.rejects(
    () => submitDriverReview(sb, 'user-incomplete'),
    (err) => {
      assert.match(err.message, /Finish every required step before submitting for review/)
      assert.ok(Array.isArray(err.payload?.missing))
      return true
    },
  )

  // 3. API unavailable (network error), userId present, onboarding complete -> submits directly
  stubFetch({
    '/api/driver?action=submit-review': () => {
      throw new Error('Connection refused')
    },
  })

  const fullApp = {
    id: 'app-ready',
    profile_id: 'user-ready',
    onboarding_status: 'pending_docs',
    background_authorized_at: '2026-09-24T00:00:00Z',
    work_eligibility_attested_at: '2026-09-24T00:00:00Z',
    work_eligibility_category: 'citizen',
  }
  const fullDocs = REQUIRED_DOCUMENTS.map((doc) => ({
    id: `doc-${doc.id}`,
    doc_type: doc.id,
    storage_path: `path/${doc.id}`,
    match_status: doc.id === 'registration' ? 'matched' : null,
  }))
  const fullTax = {
    legal_name: 'Ready Driver',
    tin_last4: '5555',
    tax_classification: 'individual',
  }
  const fullAgreement = {
    agreement_version: IC_AGREEMENT_VERSION,
    signed_at: '2026-09-24T00:00:00Z',
    signature_name: 'Ready Driver',
    signer_user_id: 'user-ready',
  }

  const readySb = createFakeSupabase({
    tables: {
      driver_applications: (state) => {
        if (state.operation === 'update') {
          return { data: { ...fullApp, onboarding_status: 'pending_review' }, error: null }
        }
        return { data: fullApp, error: null }
      },
      driver_documents: { data: fullDocs },
      driver_tax_info: { data: fullTax },
      driver_agreements: { data: fullAgreement },
    },
  })

  const directRes = await submitDriverReview(readySb, 'user-ready')
  assert.equal(directRes.ok, true)
  assert.equal(directRes.direct, true)
  assert.equal(directRes.onboarding_status, 'pending_review')

  // 4. API returns 400 Bad Request (non-network, non-unavailable) -> rethrows without falling back
  stubFetch({
    '/api/driver?action=submit-review': {
      status: 400,
      body: { error: 'Invalid state' },
    },
  })
  await assert.rejects(
    () => submitDriverReview(readySb, 'user-ready'),
    /Invalid state/,
  )
})

test('saveDriverInfo validates quiz, calls API signup, and falls back to direct database save', async () => {
  const sb = createFakeSupabase({
    tables: {
      driver_applications: { data: { onboarding_status: 'pending_info' } },
      vehicles: { data: [] },
    },
  })

  // 1. Missing user.id
  await assert.rejects(
    () => saveDriverInfo(sb, null, {}),
    /Sign in required/,
  )
  await assert.rejects(
    () => saveDriverInfo(sb, {}, {}),
    /Sign in required/,
  )

  // 2. Driver quiz failures
  await assert.rejects(
    () => saveDriverInfo(sb, { id: 'u1' }, { hasCar: false }),
    /A car is required to apply as a driver\./,
  )
  await assert.rejects(
    () => saveDriverInfo(sb, { id: 'u1' }, { hasCar: true, hasInsurance: false }),
    /Current auto insurance is required\./,
  )
  await assert.rejects(
    () => saveDriverInfo(sb, { id: 'u1' }, { hasCar: true, hasInsurance: true, attestationAccepted: false }),
    /Confirm that you carry valid auto insurance\./,
  )

  const validPayload = {
    hasCar: true,
    hasInsurance: true,
    attestationAccepted: true,
    fullName: 'Clemson Driver',
    phone: '864-555-0199',
    make: 'Honda',
    model: 'Civic',
    plate: 'ABC-123',
    isTesla: true,
  }

  // 3. API happy path
  stubFetch({
    '/api/driver?action=signup': {
      status: 200,
      body: { ok: true, direct: false },
    },
  })

  const apiRes = await saveDriverInfo(sb, { id: 'u1', email: 'driver@clemson.edu' }, validPayload)
  assert.equal(apiRes.ok, true)

  // 4. API unavailable (503) -> direct save fallback
  stubFetch({
    '/api/driver?action=signup': {
      status: 503,
      body: { error: 'API down' },
    },
  })

  const directSb = createFakeSupabase({
    tables: {
      driver_applications: { data: { onboarding_status: 'pending_info' } },
      vehicles: { data: [] },
    },
  })

  const directRes = await saveDriverInfo(
    directSb,
    { id: 'u-clemson', email: 'tiger@clemson.edu' },
    validPayload,
  )
  assert.equal(directRes.ok, true)
  assert.equal(directRes.direct, true)
  assert.equal(directRes.onboarding_status, 'pending_docs')

  // Verify clemson email sets student_verified_at in profiles upsert
  const profileUpsert = directSb.calls.from.find((c) => c.table === 'profiles' && c.operation === 'upsert')
  assert.ok(profileUpsert)
  assert.ok(profileUpsert.payload.student_verified_at)

  // 5. Non-network 400 error rethrows without direct fallback
  stubFetch({
    '/api/driver?action=signup': {
      status: 400,
      body: { error: 'Invalid phone format' },
    },
  })
  await assert.rejects(
    () => saveDriverInfo(directSb, { id: 'u1' }, validPayload),
    /Invalid phone format/,
  )
})

test('uploadDriverDocument validates inputs, uploads to storage, and upserts driver_documents', async () => {
  const sb = createFakeSupabase({
    tables: {
      driver_documents: { data: null },
    },
  })

  // Missing userId
  await assert.rejects(
    () => uploadDriverDocument(sb, null, 'license_front', { uri: 'file://x.jpg' }),
    /Sign in required/,
  )

  // Unknown docType
  await assert.rejects(
    () => uploadDriverDocument(sb, 'u1', 'passport', { uri: 'file://x.jpg' }),
    /Unknown document type/,
  )

  // Missing file uri
  await assert.rejects(
    () => uploadDriverDocument(sb, 'u1', 'license_front', {}),
    /Choose a file/,
  )

  // File size > 8MB
  await assert.rejects(
    () => uploadDriverDocument(sb, 'u1', 'license_front', { uri: 'file://x.jpg', size: 9 * 1024 * 1024 }),
    /Each file must be 8MB or smaller/,
  )

  // Invalid mime types
  await assert.rejects(
    () => uploadDriverDocument(sb, 'u1', 'license_front', { uri: 'file://x.pdf', mimeType: 'application/pdf' }),
    /Upload a photo of the license\./,
  )
  await assert.rejects(
    () => uploadDriverDocument(sb, 'u1', 'insurance_front', { uri: 'file://x.mp4', mimeType: 'video/mp4' }),
    /Upload a photo or PDF/,
  )

  // Happy path
  stubFetch()
  const uploadRes = await uploadDriverDocument(
    sb,
    'u1',
    'license_front',
    { uri: 'file://license.jpg', name: 'license.jpg', mimeType: 'image/jpeg', size: 50_000 },
    { reviewStatus: 'pending_manual_review' },
  )

  assert.equal(uploadRes.doc_type, 'license_front')
  assert.ok(uploadRes.storage_path.startsWith('u1/license_front/'))
  assert.equal(uploadRes.reviewStatus, 'pending_manual_review')

  // Storage upload called
  assert.equal(sb.calls.storage.length, 1)
  assert.equal(sb.calls.storage[0].action, 'upload')
  assert.equal(sb.calls.storage[0].bucket, 'driver-documents')

  // Document upsert called
  const docUpsert = sb.calls.from.find((c) => c.table === 'driver_documents' && c.operation === 'upsert')
  assert.ok(docUpsert)
  assert.equal(docUpsert.payload.doc_type, 'license_front')
})

test('uploadDriverDocument removes old storage file when replacing a document', async () => {
  stubFetch()
  const previousPath = 'u1/license_front/old_123.jpg'
  const sb = createFakeSupabase({
    tables: {
      driver_documents: (state) => {
        if (state.operation === 'select') {
          return { data: { storage_path: previousPath }, error: null }
        }
        return { data: {}, error: null }
      },
    },
  })

  await uploadDriverDocument(sb, 'u1', 'license_front', {
    uri: 'file://new_license.jpg',
    name: 'new.jpg',
    mimeType: 'image/jpeg',
  })

  const removeCall = sb.calls.storage.find((c) => c.action === 'remove')
  assert.ok(removeCall)
  assert.deepEqual(removeCall.paths, [previousPath])
})

test('saveEmploymentVerification validates input, updates application, and records form signatures', async () => {
  const sb = createFakeSupabase({
    tables: {
      driver_applications: { data: { background_authorized_at: '2026-09-24T00:00:00Z' } },
    },
  })

  // Validations
  await assert.rejects(
    () => saveEmploymentVerification(sb, null, {}),
    /Sign in required/,
  )
  await assert.rejects(
    () => saveEmploymentVerification(sb, 'u1', { backgroundAuthorized: false }),
    /Sign the background-check authorization to continue\./,
  )
  await assert.rejects(
    () => saveEmploymentVerification(sb, 'u1', { backgroundAuthorized: true, category: 'unknown_category' }),
    /Select your eligibility to work\./,
  )
  await assert.rejects(
    () => saveEmploymentVerification(sb, 'u1', { backgroundAuthorized: true, category: 'citizen', signatureName: ' ' }),
    /Type your legal name to sign\./,
  )

  // Happy path
  const res = await saveEmploymentVerification(sb, 'u1', {
    backgroundAuthorized: true,
    category: 'citizen',
    signatureName: 'John Hancock',
  })
  assert.ok(res)

  // Check form signatures recorded
  const formSigCalls = sb.calls.from.filter((c) => c.table === 'driver_form_signatures')
  assert.equal(formSigCalls.length, 2)
  const formIds = formSigCalls.map((c) => c.payload.form_id)
  assert.ok(formIds.includes('background_authorization'))
  assert.ok(formIds.includes('work_eligibility'))
})

test('recordFormSignature handles missing table gracefully and throws on real errors', async () => {
  // Gracefully handles missing table / schema cache error
  const missingTableSb = createFakeSupabase({
    tables: {
      driver_form_signatures: {
        error: { message: 'relation "driver_form_signatures" does not exist' },
      },
    },
  })

  const swallowed = await recordFormSignature(missingTableSb, 'u1', {
    formId: 'test_form',
    formVersion: 'v1',
    signatureName: 'Signer',
    signedOn: '2026-09-24',
  })
  assert.equal(swallowed, null)

  // Fatal DB error throws
  const fatalSb = createFakeSupabase({
    tables: {
      driver_form_signatures: {
        error: { message: 'server closed connection unexpectedly' },
      },
    },
  })

  await assert.rejects(
    () => recordFormSignature(fatalSb, 'u1', {
      formId: 'test_form',
      formVersion: 'v1',
      signatureName: 'Signer',
      signedOn: '2026-09-24',
    }),
    /server closed connection unexpectedly/,
  )
})

test('loadApplicantInbox and replyApplicantInbox call /api/driver?action=inbox with proper auth headers and payload', async () => {
  const fetchCalls = stubFetch({
    '/api/driver?action=inbox': (url, options) => {
      if (options.method === 'POST') {
        const parsed = JSON.parse(options.body)
        return {
          status: 200,
          body: { ok: true, echo: parsed.body },
        }
      }
      return {
        status: 200,
        body: { threads: [{ id: 1, subject: 'Welcome' }] },
      }
    },
  })

  const sb = createFakeSupabase({
    session: { access_token: 'valid-test-token' },
  })

  // 1. loadApplicantInbox (GET)
  const inbox = await loadApplicantInbox(sb)
  assert.deepEqual(inbox, { threads: [{ id: 1, subject: 'Welcome' }] })
  assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer valid-test-token')
  assert.equal(fetchCalls[0].options.method, 'GET')

  // 2. replyApplicantInbox (POST)
  const reply = await replyApplicantInbox(sb, 'I have uploaded my documents.')
  assert.deepEqual(reply, { ok: true, echo: 'I have uploaded my documents.' })
  assert.equal(fetchCalls[1].options.headers.Authorization, 'Bearer valid-test-token')
  assert.equal(fetchCalls[1].options.method, 'POST')
  assert.deepEqual(JSON.parse(fetchCalls[1].options.body), { body: 'I have uploaded my documents.' })
})
