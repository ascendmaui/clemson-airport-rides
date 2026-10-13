/**
 * Read `eas build --json` output, download the binary, and write build metadata.
 * The artifact URL can be signed, so this script does not print it.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function parseEasOutput(text) {
  const raw = String(text || '').trim()
  if (!raw) throw new Error('EAS build did not return JSON')
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.search(/[\[{]/)
    if (start === -1) throw new Error('EAS build did not return JSON')
    return JSON.parse(raw.slice(start))
  }
}

export function selectBuild(payload) {
  const builds = Array.isArray(payload) ? payload : [payload]
  const finished = builds.filter((build) => build && String(build.status || '').toUpperCase() === 'FINISHED')
  if (!finished.length) {
    const status = builds.map((build) => build?.status || 'missing').join(', ')
    throw new Error(`EAS build did not finish (${status})`)
  }
  return finished[0]
}

export function artifactUrl(build) {
  const url = build?.artifacts?.buildUrl || build?.artifacts?.applicationArchiveUrl || ''
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
    throw new Error('EAS build finished without an https artifact URL')
  }
  return url
}

export function buildMeta(build, { app, platform, profile }) {
  if (!build?.id) throw new Error('EAS build finished without an id')
  return {
    app,
    platform,
    profile,
    easBuildId: build.id,
    appVersion: build.appVersion || null,
    appBuildVersion: build.appBuildVersion == null ? null : String(build.appBuildVersion),
  }
}

export function artifactName(app, extension) {
  if (!/^(rider|driver)$/.test(app)) throw new Error(`unexpected app ${app}`)
  if (!/^(apk|aab|ipa)$/.test(extension)) throw new Error(`unexpected extension ${extension}`)
  return `${app}.${extension}`
}

export async function downloadArtifact(url, dest) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`artifact download failed (${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length) throw new Error('artifact download was empty')
  await writeFile(dest, bytes)
  return bytes.length
}

async function main() {
  const [jsonPath, destDir, app, extension, platform, profile] = process.argv.slice(2)
  if (!jsonPath || !destDir || !app || !extension) {
    console.error('usage: eas-artifact.mjs <eas-json> <dest-dir> <rider|driver> <apk|aab|ipa> <platform> <profile>')
    process.exit(1)
  }
  const { readFile } = await import('node:fs/promises')
  const payload = parseEasOutput(await readFile(jsonPath, 'utf8'))
  const build = selectBuild(payload)
  const meta = buildMeta(build, { app, platform, profile })
  const name = artifactName(app, extension)
  await mkdir(destDir, { recursive: true })
  const bytes = await downloadArtifact(artifactUrl(build), path.join(destDir, name))
  await writeFile(path.join(destDir, 'build-meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
  console.log(`saved ${name} (${bytes} bytes) easBuildId=${meta.easBuildId}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message || String(error))
    process.exit(1)
  })
}
