import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getHashRoute } from '../src/lib/navigation.js'

const root = new URL('..', import.meta.url)

function routeFor(href) {
  const url = new URL(href, 'https://clemsonrides.com')
  const prev = globalThis.window
  globalThis.window = {
    location: { hash: url.hash, pathname: url.pathname, search: url.search, origin: url.origin, replace() {} },
    sessionStorage: { getItem() { return null }, setItem() {} },
  }
  try { return getHashRoute() } finally {
    if (prev === undefined) delete globalThis.window
    else globalThis.window = prev
  }
}

async function loadAdvertise() {
  const built = await esbuild.build({
    absWorkingDir: fileURLToPath(root),
    entryPoints: ['src/screens/Advertise.jsx'],
    bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', write: false,
    loader: { '.css': 'empty' },
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  })
  const dir = mkdtempSync(join(fileURLToPath(root), '.advertise-links-'))
  const file = join(dir, 'advertise.mjs')
  try {
    writeFileSync(file, built.outputFiles[0].text)
    return await import(pathToFileURL(file).href)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('hero links go to sign-up and the How it works section, not the homepage', async () => {
  const mod = await loadAdvertise()
  const html = renderToStaticMarkup(createElement(mod.Advertise))
  const founding = html.match(/<a[^>]*href="([^"]+)"[^>]*>Become a founding partner<\/a>/)
  const how = html.match(/<a[^>]*href="([^"]+)"[^>]*>How it works<\/a>/)
  assert.ok(founding && how, 'both hero links render')
  assert.equal(founding[1], '/advertise/signup?package=founding-partner')
  assert.equal(how[1], '/advertise?section=how-it-works')
  assert.match(html, /<section id="how-it-works"/, 'the How it works section carries the anchor id')

  const signup = routeFor(founding[1])
  assert.deepEqual([signup.path, signup.params.sub], ['advertise', 'signup'])
  const section = routeFor(how[1])
  assert.deepEqual([section.path, section.params.section], ['advertise', 'how-it-works'])
  // The old bug: a bare #hash is read as a route and falls through to the homepage.
  assert.notEqual(routeFor('/advertise#adv-how').path, 'advertise')
})
