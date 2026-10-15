/**
 * External TestFlight beta review and App Store review.
 * This is the only script that requests those submissions.
 * Internal TestFlight is `eas submit` and does not call this file.
 * Secret values are never printed.
 */
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const ASC_SECRET_NAMES = ['ASC_API_KEY_ID', 'ASC_API_ISSUER_ID', 'ASC_API_KEY_P8']

const APPS = [
  { id: 'rider', easFile: new URL('../apps/rider/eas.json', import.meta.url) },
  { id: 'driver', easFile: new URL('../apps/driver/eas.json', import.meta.url) },
]

export function missingAscSecrets(env) {
  return ASC_SECRET_NAMES.filter((name) => !String(env?.[name] || '').trim())
}

export function normalizePem(raw) {
  let text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim()
  }
  text = text.replace(/\\n/g, '\n').trim()
  if (!text.includes('-----BEGIN ') || !text.includes('PRIVATE KEY-----')) {
    throw new Error('ASC_API_KEY_P8 is not a PEM private key')
  }
  if (!text.endsWith('\n')) text += '\n'
  return text
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input))
  return buf.toString('base64url')
}

export function ascJwt({ keyId, issuerId, privateKey, now = Math.floor(Date.now() / 1000) }) {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))
  const payload = base64url(JSON.stringify({
    iss: issuerId,
    iat: now,
    exp: now + 60 * 10,
    aud: 'appstoreconnect-v1',
  }))
  const unsigned = `${header}.${payload}`
  const signature = crypto.sign('SHA256', Buffer.from(unsigned), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  })
  return `${unsigned}.${base64url(signature)}`
}

export function betaReviewBody(buildId) {
  return {
    data: {
      type: 'betaAppReviewSubmissions',
      relationships: {
        build: { data: { type: 'builds', id: buildId } },
      },
    },
  }
}

export function reviewSubmissionBody(ascAppId) {
  return {
    data: {
      type: 'reviewSubmissions',
      attributes: { platform: 'IOS' },
      relationships: {
        app: { data: { type: 'apps', id: ascAppId } },
      },
    },
  }
}

export function reviewItemBody(submissionId, versionId) {
  return {
    data: {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    },
  }
}

export function submitReviewBody(submissionId) {
  return {
    data: {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { submitted: true },
    },
  }
}

export function attachBuildBody(buildId) {
  return { data: { type: 'builds', id: buildId } }
}

function appleDetail(body) {
  const errors = Array.isArray(body?.errors) ? body.errors : []
  return errors.map((error) => [error?.title, error?.detail].filter(Boolean).join(': ')).filter(Boolean).join('; ')
}

function alreadyRecorded(status, body) {
  if (status === 409) return true
  const detail = appleDetail(body).toLowerCase()
  return status === 422 && /already|exists|duplicate/.test(detail)
}

async function ascRequest(token, method, pathname, body, fetchImpl) {
  const response = await fetchImpl(`https://api.appstoreconnect.apple.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let parsed = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }
  return { status: response.status, body: parsed }
}

function fail(status, body, action) {
  const detail = appleDetail(body)
  throw new Error(`App Store Connect ${action} failed (${status})${detail ? `: ${detail}` : ''}`)
}

export async function findAscBuild({ request, ascAppId, buildVersion, attempts = 30, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const query = `/v1/builds?filter[app]=${encodeURIComponent(ascAppId)}&filter[version]=${encodeURIComponent(buildVersion)}&filter[processingState]=VALID&sort=-uploadedDate&limit=1`
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await request('GET', query)
    if (res.status !== 200) fail(res.status, res.body, 'build lookup')
    const id = res.body?.data?.[0]?.id
    if (id) return id
    if (attempt < attempts - 1) await sleep(30_000)
  }
  throw new Error(`No processed App Store Connect build for app ${ascAppId} version ${buildVersion}`)
}

async function requireOk(res, action, ok) {
  if (!ok(res.status)) fail(res.status, res.body, action)
  return res
}

export async function submitExternalAndAppStore({ request, ascAppId, appVersion, buildVersion, attempts, sleep }) {
  const buildId = await findAscBuild({ request, ascAppId, buildVersion, attempts, sleep })
  const beta = await request('POST', '/v1/betaAppReviewSubmissions', betaReviewBody(buildId))
  if (!(beta.status === 201 || beta.status === 200 || alreadyRecorded(beta.status, beta.body))) {
    fail(beta.status, beta.body, 'external TestFlight beta review')
  }

  const versions = await requireOk(
    await request('GET', `/v1/apps/${encodeURIComponent(ascAppId)}/appStoreVersions?filter[platform]=IOS&filter[appStoreState]=PREPARE_FOR_SUBMISSION&limit=10`),
    'App Store version lookup',
    (status) => status === 200,
  )
  const rows = Array.isArray(versions.body?.data) ? versions.body.data : []
  const match = rows.find((row) => row?.attributes?.versionString === appVersion) || rows[0]
  if (!match?.id) {
    throw new Error(`No App Store version in Prepare for Submission for app ${ascAppId}`)
  }
  const attached = await request('PATCH', `/v1/appStoreVersions/${encodeURIComponent(match.id)}/relationships/build`, attachBuildBody(buildId))
  if (!(attached.status === 204 || attached.status === 200 || alreadyRecorded(attached.status, attached.body))) {
    fail(attached.status, attached.body, 'attach build to App Store version')
  }

  const created = await request('POST', '/v1/reviewSubmissions', reviewSubmissionBody(ascAppId))
  let submissionId = created.body?.data?.id
  if (!(created.status === 201 || created.status === 200 || alreadyRecorded(created.status, created.body))) {
    fail(created.status, created.body, 'App Store review submission')
  }
  if (!submissionId) {
    const existing = await requireOk(
      await request('GET', `/v1/apps/${encodeURIComponent(ascAppId)}/reviewSubmissions?filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&limit=1`),
      'open App Store review lookup',
      (status) => status === 200,
    )
    submissionId = existing.body?.data?.[0]?.id
  }
  if (!submissionId) throw new Error(`App Store review submission id missing for app ${ascAppId}`)

  const item = await request('POST', '/v1/reviewSubmissionItems', reviewItemBody(submissionId, match.id))
  if (!(item.status === 201 || item.status === 200 || alreadyRecorded(item.status, item.body))) {
    fail(item.status, item.body, 'App Store review item')
  }
  const submitted = await request('PATCH', `/v1/reviewSubmissions/${encodeURIComponent(submissionId)}`, submitReviewBody(submissionId))
  if (!(submitted.status === 200 || submitted.status === 204 || alreadyRecorded(submitted.status, submitted.body))) {
    fail(submitted.status, submitted.body, 'submit App Store review')
  }
  return { buildId, versionId: match.id, submissionId }
}

export async function ascAppIdFromEas(fileUrl) {
  const json = JSON.parse(await readFile(fileUrl, 'utf8'))
  const id = json?.submit?.production?.ios?.ascAppId
  if (!id) throw new Error(`missing submit.production.ios.ascAppId in ${fileUrl.pathname || fileUrl}`)
  return String(id)
}

async function main() {
  const missing = missingAscSecrets(process.env)
  if (missing.length) {
    console.error(`Missing App Store Connect secrets: ${missing.join(', ')}`)
    process.exit(1)
  }
  const metaPaths = process.argv.slice(2)
  if (!metaPaths.length) {
    console.error('usage: store-release-submit.mjs <rider-build-meta.json> <driver-build-meta.json>')
    process.exit(1)
  }
  const key = normalizePem(process.env.ASC_API_KEY_P8)
  const token = ascJwt({
    keyId: process.env.ASC_API_KEY_ID.trim(),
    issuerId: process.env.ASC_API_ISSUER_ID.trim(),
    privateKey: key,
  })
  const request = (method, pathname, body) => ascRequest(token, method, pathname, body, fetch)
  for (const metaPath of metaPaths) {
    const meta = JSON.parse(await readFile(metaPath, 'utf8'))
    const app = APPS.find((item) => item.id === meta.app)
    if (!app) throw new Error(`unexpected app in ${metaPath}`)
    if (!meta.appBuildVersion) throw new Error(`${meta.app} build metadata is missing appBuildVersion`)
    const ascAppId = await ascAppIdFromEas(app.easFile)
    const result = await submitExternalAndAppStore({
      request,
      ascAppId,
      appVersion: meta.appVersion,
      buildVersion: meta.appBuildVersion,
    })
    console.log(`${meta.app}: external TestFlight and App Store review submitted for build ${result.buildId}`)
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  main().catch((error) => {
    console.error(error?.message || 'store release failed')
    process.exit(1)
  })
}
