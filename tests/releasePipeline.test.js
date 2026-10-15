import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createApp, resolveDownloadFile } from '../server/selfHost.mjs'
import { getHashRoute } from '../src/lib/navigation.js'
import { qrMatrix } from '../src/lib/qrMatrix.js'
import {
  CLEMSON_ORANGE,
  CLEMSON_PURPLE,
  DRIVER_APK_NAME,
  RIDER_APK_NAME,
  clientPlatform,
  installOffer,
  redirectTarget,
} from '../shared/installLinks.js'
import {
  artifactName,
  buildMeta,
  parseEasOutput,
  selectBuild,
} from '../scripts/eas-artifact.mjs'
import {
  ascJwt,
  betaReviewBody,
  missingAscSecrets,
  normalizePem,
  reviewItemBody,
  reviewSubmissionBody,
  submitExternalAndAppStore,
  submitReviewBody,
} from '../scripts/store-release-submit.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFile(new URL(`../${rel}`, import.meta.url), 'utf8')
}

function jobBlock(source, name) {
  const marker = `\n  ${name}:`
  const start = source.indexOf(marker)
  assert.ok(start >= 0, `missing job ${name}`)
  const rest = source.slice(start + 1)
  const next = rest.slice(1).search(/\n  [a-z]/)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

test('release workflow builds rider and driver on EAS and keeps store approval separate', async () => {
  const workflow = await read('.github/workflows/release.yml')
  const riderEas = JSON.parse(await read('apps/rider/eas.json'))
  const driverEas = JSON.parse(await read('apps/driver/eas.json'))
  assert.equal(riderEas.build.preview.android.buildType, 'apk')
  assert.equal(riderEas.build.production.android.buildType, 'app-bundle')
  assert.equal(driverEas.build.preview.android.buildType, 'apk')
  assert.equal(driverEas.build.production.android.buildType, 'app-bundle')
  assert.equal(riderEas.submit.production.ios.ascAppId, '6815430021')
  assert.equal(driverEas.submit.production.ios.ascAppId, '6815445517')

  assert.match(workflow, /tags:\s*\n\s*- 'v\*'/ )
  assert.doesNotMatch(workflow, /workflow_dispatch/)
  assert.doesNotMatch(workflow, /apps\/mobile/)
  assert.doesNotMatch(workflow, /auto-submit/)
  assert.doesNotMatch(workflow, /git tag/)
  assert.doesNotMatch(workflow, /npm run build|vite build|docker build/)
  assert.match(workflow, /secrets\.EXPO_TOKEN/)
  assert.match(workflow, /secrets\.VPS_SSH_KEY/)

  const build = jobBlock(workflow, 'build')
  assert.match(build, /working-directory: \$\{\{ matrix\.dir \}\}/)
  assert.match(build, /eas build/)
  assert.doesNotMatch(build, /eas submit/)
  for (const line of [
    'app: rider',
    'app: driver',
    'dir: apps/rider',
    'dir: apps/driver',
    'platform: ios',
    'platform: android',
    'profile: preview',
    'profile: production',
    'extension: apk',
    'extension: aab',
    'extension: ipa',
  ]) {
    assert.match(build, new RegExp(line.replace(/[.]/g, '\\.')))
  }

  const release = jobBlock(workflow, 'github-release')
  assert.match(release, /-name '\*\.apk'/)
  assert.match(release, /-name '\*\.aab'/)
  assert.doesNotMatch(release, /\.ipa/)
  assert.match(release, /gh release upload/)

  const internal = jobBlock(workflow, 'testflight-internal')
  assert.match(internal, /eas submit --platform ios/)
  assert.match(internal, /--non-interactive/)
  assert.doesNotMatch(internal, /store-release-submit/)
  assert.doesNotMatch(internal, /betaAppReviewSubmissions/)
  assert.doesNotMatch(internal, /environment:/)
  assert.match(internal, /apps\/\$\{app\}/)

  const external = jobBlock(workflow, 'store-release')
  assert.match(external, /environment: store-release/)
  assert.match(external, /scripts\/store-release-submit\.mjs/)
  assert.doesNotMatch(external, /eas submit/)
  assert.doesNotMatch(external, /platform android/)

  const copy = jobBlock(workflow, 'publish-downloads')
  assert.match(copy, /scripts\/copy-downloads\.sh/)
  assert.match(copy, /mobile-\*-android-preview/)
  assert.doesNotMatch(copy, /eas build|eas submit|npm ci/)
})

test('VPS copy script only uploads APKs and the compose volume is read-only', async () => {
  const script = await read('scripts/copy-downloads.sh')
  const compose = await read('deploy/docker-compose.yml')
  execFileSync('bash', ['-n', path.join(ROOT, 'scripts/copy-downloads.sh')])
  assert.match(script, /\/opt\/clemson-rides\/downloads/)
  assert.doesNotMatch(script, /\b(npm|vite|eas)\b|docker build|docker compose/)
  assert.match(script, /prepare-ssh\.sh/)
  assert.match(compose, /\/opt\/clemson-rides\/downloads:\/downloads:ro/)
  for (const service of ['web:', 'web_next:', 'staging:', 'staging_next:']) {
    const block = compose.slice(compose.indexOf(`\n  ${service}`))
    const next = block.slice(service.length + 3).search(/\n  [a-z]/)
    const body = next === -1 ? block : block.slice(0, next + service.length + 3)
    assert.match(body, /volumes: \*downloads-volume/, service)
  }
})

test('install links show App Store coming soon, the APK until Play exists, and phones redirect', () => {
  assert.equal(CLEMSON_ORANGE, '#F56600')
  assert.equal(CLEMSON_PURPLE, '#522D80')
  const rider = installOffer('rider', {
    riderAppStore: '',
    driverAppStore: '',
    riderPlay: '',
    driverPlay: '',
    riderApk: '',
    driverApk: '',
  })
  const driver = installOffer('driver', {
    riderAppStore: '',
    driverAppStore: '',
    riderPlay: '',
    driverPlay: '',
    riderApk: '',
    driverApk: '',
  })
  assert.equal(rider.pagePath, '/download')
  assert.equal(rider.pageUrl, 'https://clemsonrides.com/download')
  assert.equal(rider.iosHref, null)
  assert.equal(rider.iosState, 'coming-soon')
  assert.equal(rider.androidKind, 'apk')
  assert.equal(rider.androidHref, `https://clemsonrides.com/downloads/${RIDER_APK_NAME}`)
  assert.equal(driver.pagePath, '/driver/download')
  assert.equal(driver.iosHref, null)
  assert.equal(driver.iosState, 'coming-soon')
  assert.equal(driver.androidHref, `https://clemsonrides.com/downloads/${DRIVER_APK_NAME}`)

  const hidden = installOffer('rider', {
    riderAppStore: 'https://example.com/not-the-app-store',
    riderPlay: 'https://expo.dev/nope',
    riderApk: 'https://evil.example/rider.apk',
    driverAppStore: '',
    driverPlay: '',
    driverApk: '',
  })
  assert.equal(hidden.iosHref, null)
  assert.equal(hidden.iosState, 'coming-soon')
  assert.equal(hidden.androidKind, 'apk')
  assert.equal(hidden.androidHref, `https://clemsonrides.com/downloads/${RIDER_APK_NAME}`)

  const play = installOffer('driver', {
    riderAppStore: '',
    driverAppStore: '',
    riderPlay: '',
    driverPlay: 'https://play.google.com/store/apps/details?id=com.ascendmaui.clemsonrides.driver',
    riderApk: '',
    driverApk: 'https://clemsonrides.com/downloads/custom-driver.apk',
  })
  assert.equal(play.androidKind, 'play')
  assert.match(play.androidHref, /^https:\/\/play\.google\.com\//)
  assert.equal(play.apkHref, 'https://clemsonrides.com/downloads/custom-driver.apk')

  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8)'
  assert.equal(clientPlatform(iphone), 'ios')
  assert.equal(clientPlatform(android), 'android')
  assert.equal(clientPlatform('Mozilla/5.0 (Macintosh)'), 'other')
  assert.equal(redirectTarget(rider, iphone), null)
  assert.equal(redirectTarget(rider, iphone, { stay: false }), null)
  const listed = installOffer('rider', { riderAppStore: 'https://apps.apple.com/app/id123', driverAppStore: '', riderPlay: '', driverPlay: '', riderApk: '', driverApk: '' })
  assert.equal(listed.iosState, 'app-store')
  assert.equal(redirectTarget(listed, iphone), 'https://apps.apple.com/app/id123')
  const testflightOverride = installOffer('rider', { riderAppStore: 'https://testflight.apple.com/join/DXcYmBQg', driverAppStore: '', riderPlay: '', driverPlay: '', riderApk: '', driverApk: '' })
  assert.equal(testflightOverride.iosHref, null)
  assert.equal(redirectTarget(rider, android), rider.androidHref)
  assert.equal(redirectTarget(rider, 'desktop'), null)
  assert.equal(redirectTarget(rider, iphone, { stay: true }), null)
  assert.equal(redirectTarget(hidden, iphone), null)
  assert.equal(qrMatrix(rider.pageUrl).size >= 21, true)
  assert.equal(qrMatrix(rider.androidHref).size >= 21, true)
})

test('download routes are public paths and do not open the driver desk', () => {
  const previous = globalThis.window
  function route(location) {
    globalThis.window = {
      location,
      sessionStorage: { getItem() { return null }, setItem() {} },
    }
    return getHashRoute()
  }
  try {
    assert.equal(route({ hash: '', pathname: '/download', search: '', origin: 'https://clemsonrides.com' }).path, 'download')
    assert.equal(route({ hash: '', pathname: '/driver/download', search: '?stay=1', origin: 'https://clemsonrides.com' }).path, 'driver-download')
    assert.equal(route({ hash: '', pathname: '/driver/download', search: '?stay=1', origin: 'https://clemsonrides.com' }).params.stay, '1')
    assert.equal(route({ hash: '', pathname: '/driver', search: '', origin: 'https://clemsonrides.com' }).path, 'driver')
    assert.equal(route({ hash: '#/download', pathname: '/', search: '', origin: 'https://clemsonrides.com' }).path, 'download')
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
})

test('download pages are wired into the site shell', async () => {
  const app = await read('src/App.jsx')
  const page = await read('src/screens/AppDownload.jsx')
  const routes = app.slice(app.indexOf('const SITE_ROUTES'), app.indexOf('function Screen'))
  assert.match(routes, /'download'/)
  assert.match(routes, /'driver-download'/)
  assert.match(app, /case 'download':\s*return <AppDownloadPage appId="rider" \/>/)
  assert.match(app, /case 'driver-download':\s*return <AppDownloadPage appId="driver" \/>/)
  assert.match(app, /case 'driver':[\s\S]*<RequireAuth>/)
  assert.match(page, /#F56600|#522D80|CLEMSON_ORANGE|CLEMSON_PURPLE/)
  assert.match(page, /Coming soon/)
  assert.match(page, /redirectTarget/)
  assert.match(page, /offer\.pageUrl/)
  assert.match(page, /offer\.androidHref/)
})

test('EAS output parsing keeps the finished build id and does not require a printed URL', () => {
  const payload = parseEasOutput('warning\n[{"id":"build-9","status":"FINISHED","appVersion":"1.1.0","appBuildVersion":"20","artifacts":{"buildUrl":"https://expo.dev/artifacts/private"}}]')
  const build = selectBuild(payload)
  assert.equal(buildMeta(build, { app: 'rider', platform: 'ios', profile: 'production' }).easBuildId, 'build-9')
  assert.equal(artifactName('driver', 'apk'), 'driver.apk')
  assert.equal(artifactName('rider', 'aab'), 'rider.aab')
  assert.throws(() => selectBuild([{ status: 'ERRORED' }]), /did not finish/)
  assert.throws(() => artifactName('mobile', 'apk'), /unexpected app/)
})

test('store release script builds the external and App Store calls without printing key material', async () => {
  assert.deepEqual(missingAscSecrets({}), ['ASC_API_KEY_ID', 'ASC_API_ISSUER_ID', 'ASC_API_KEY_P8'])
  assert.throws(() => normalizePem('not-a-key'), (error) => {
    assert.equal(error.message.includes('not-a-key'), false)
    return true
  })
  const pem = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' })
  const escaped = pem.replace(/\n/g, '\\n')
  const token = ascJwt({
    keyId: 'KEY123',
    issuerId: 'issuer-1',
    privateKey: normalizePem(escaped),
    now: 1_700_000_000,
  })
  assert.equal(token.split('.').length, 3)
  assert.equal(token.includes('BEGIN'), false)
  const [headerPart, payloadPart] = token.split('.')
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString())
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString())
  assert.equal(header.kid, 'KEY123')
  assert.equal(header.alg, 'ES256')
  assert.equal(payload.aud, 'appstoreconnect-v1')
  assert.equal(payload.iss, 'issuer-1')
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const signed = ascJwt({
    keyId: 'KEY123',
    issuerId: 'issuer-1',
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    now: 1_700_000_000,
  })
  const [signedHeader, signedPayload, signedSig] = signed.split('.')
  assert.equal(crypto.verify(
    'SHA256',
    Buffer.from(`${signedHeader}.${signedPayload}`),
    { key: pair.publicKey, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signedSig, 'base64url'),
  ), true)

  const calls = []
  const request = async (method, pathname, body) => {
    calls.push({ method, pathname, body })
    if (pathname.startsWith('/v1/builds')) return { status: 200, body: { data: [{ id: 'asc-build' }] } }
    if (pathname === '/v1/betaAppReviewSubmissions') return { status: 409, body: { errors: [{ title: 'Conflict', detail: 'already submitted' }] } }
    if (pathname.includes('/appStoreVersions')) {
      return { status: 200, body: { data: [{ id: 'ver-1', attributes: { versionString: '1.1.0' } }] } }
    }
    if (pathname.includes('/relationships/build')) return { status: 204, body: null }
    if (pathname === '/v1/reviewSubmissions') return { status: 201, body: { data: { id: 'sub-1' } } }
    if (pathname === '/v1/reviewSubmissionItems') return { status: 201, body: { data: { id: 'item-1' } } }
    if (pathname.startsWith('/v1/reviewSubmissions/')) return { status: 200, body: { data: { id: 'sub-1' } } }
    return { status: 500, body: { errors: [{ title: 'Unexpected' }] } }
  }
  const result = await submitExternalAndAppStore({
    request,
    ascAppId: '6815430021',
    appVersion: '1.1.0',
    buildVersion: '20',
    attempts: 1,
    sleep: async () => {},
  })
  assert.equal(result.buildId, 'asc-build')
  assert.equal(result.submissionId, 'sub-1')
  assert.deepEqual(calls[1].body, betaReviewBody('asc-build'))
  assert.deepEqual(calls.find((call) => call.pathname === '/v1/reviewSubmissions').body, reviewSubmissionBody('6815430021'))
  assert.deepEqual(calls.find((call) => call.pathname === '/v1/reviewSubmissionItems').body, reviewItemBody('sub-1', 'ver-1'))
  assert.deepEqual(calls.at(-1).body, submitReviewBody('sub-1'))
  const source = await read('scripts/store-release-submit.mjs')
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*ASC_API_KEY_P8/)
  assert.doesNotMatch(source, /console\.(log|error)\([^)]*privateKey/)
})

function httpRequest(port, { method = 'GET', path: reqPath = '/' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method, path: reqPath }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const body = Buffer.concat(chunks)
        resolve({ status: res.statusCode, headers: res.headers, body, text: body.toString('utf8') })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

test('the node server serves APKs from the downloads volume and rejects escapes', async () => {
  const downloadsDir = await mkdtemp(path.join(tmpdir(), 'clemson-downloads-'))
  const distDir = await mkdtemp(path.join(tmpdir(), 'clemson-dist-'))
  const outside = await mkdtemp(path.join(tmpdir(), 'clemson-outside-'))
  await writeFile(path.join(downloadsDir, 'rider.apk'), 'apk-bytes')
  await writeFile(path.join(downloadsDir, 'notes.txt'), 'nope')
  await writeFile(path.join(outside, 'secret.apk'), 'secret')
  await symlink(path.join(outside, 'secret.apk'), path.join(downloadsDir, 'linked.apk'))
  await writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>Clemson</title>')
  const listener = await createApp({
    distDir,
    downloadsDir,
    routes: new Map(),
    rewrites: [],
    log() {},
  })
  const server = http.createServer(listener)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    assert.equal(resolveDownloadFile(downloadsDir, '/downloads/rider.apk').endsWith(`${path.sep}rider.apk`), true)
    assert.equal(resolveDownloadFile(downloadsDir, '/downloads/../secret.apk'), null)
    assert.equal(resolveDownloadFile(downloadsDir, '/downloads/..%2Fsecret.apk'), null)
    assert.equal(resolveDownloadFile(downloadsDir, '/downloads/%2e%2e%2fsecret.apk'), null)
    assert.equal(resolveDownloadFile(downloadsDir, '/downloads/notes.txt'), null)
    assert.equal(resolveDownloadFile(downloadsDir, '/downloads/'), null)
    assert.equal(resolveDownloadFile(downloadsDir, '/download'), null)

    const apk = await httpRequest(port, { path: '/downloads/rider.apk' })
    assert.equal(apk.status, 200)
    assert.equal(apk.text, 'apk-bytes')
    assert.match(String(apk.headers['content-type']), /vnd\.android\.package-archive/)
    assert.match(String(apk.headers['content-disposition']), /attachment; filename="rider\.apk"/)
    assert.match(String(apk.headers['x-content-type-options']), /nosniff/)

    const head = await httpRequest(port, { method: 'HEAD', path: '/downloads/rider.apk' })
    assert.equal(head.status, 200)
    assert.equal(head.body.length, 0)

    const page = await httpRequest(port, { path: '/download' })
    assert.equal(page.status, 200)
    assert.match(page.text, /Clemson/)
    assert.match(String(page.headers['content-type']), /text\/html/)

    for (const reqPath of ['/downloads', '/downloads/', '/downloads/notes.txt', '/downloads/linked.apk', '/downloads/..%2Fsecret.apk', '/downloads/missing.apk']) {
      const hit = await httpRequest(port, { path: reqPath })
      assert.equal(hit.status, 404, reqPath)
      assert.equal(hit.text.includes('secret'), false)
    }
    const posted = await httpRequest(port, { method: 'POST', path: '/downloads/rider.apk' })
    assert.equal(posted.status, 405)
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
    await rm(downloadsDir, { recursive: true, force: true })
    await rm(distDir, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
