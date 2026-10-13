import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const root = new URL('..', import.meta.url)

function read(path) {
  return readFileSync(new URL(path, root), 'utf8')
}

function pngSize(path) {
  const buf = readFileSync(new URL(path, root))
  assert.equal(buf.subarray(1, 4).toString('ascii'), 'PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] }
}

test('marketing icons, favicon, and social image match the liquid glass marks', () => {
  const html = read('index.html')
  assert.match(html, /rel="icon" href="\/favicon.ico"/)
  assert.match(html, /rel="icon" href="\/favicon.png"/)
  assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon.png"/)
  assert.match(html, /property="og:image" content="https:\/\/clemsonrides\.com\/og-image\.png"/)
  assert.match(html, /name="twitter:card" content="summary_large_image"/)
  const rider = read('public/brand/rider-icon.svg')
  const driver = read('public/brand/driver-icon.svg')
  assert.match(rider, /#F56600/)
  assert.match(rider, /route pin/)
  assert.match(driver, /#522D80/)
  assert.match(driver, /steering wheel/)
  assert.doesNotMatch(`${rider}\n${driver}`, /paw|tiger|university seal/i)
  assert.deepEqual(pngSize('public/favicon.png'), { width: 32, height: 32, colorType: 2 })
  assert.deepEqual(pngSize('public/apple-touch-icon.png'), { width: 180, height: 180, colorType: 2 })
  assert.deepEqual(pngSize('public/og-image.png'), { width: 1200, height: 630, colorType: 2 })
})

test('liquid glass marketing css keeps blur, a solid fallback, and reduced motion', () => {
  const css = read('src/styles/liquidGlass.css')
  assert.match(css, /#F56600|#f56600/)
  assert.match(css, /#522D80|#522d80/)
  assert.match(css, /#f6f3f8/)
  assert.match(css, /backdrop-filter:\s*blur\(16px\)/)
  assert.match(css, /-webkit-backdrop-filter:\s*blur\(16px\)/)
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/)
  assert.match(css, /background:\s*#f7f4f2/)
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/)
  assert.match(css, /animation:\s*none !important/)
  assert.doesNotMatch(css, /tesla|robotaxi|self-driving/i)
})

test('the marketing home renders the existing headline with glass marks', async () => {
  const built = await esbuild.build({
    absWorkingDir: new URL('..', import.meta.url).pathname,
    entryPoints: ['src/screens/Marketing.jsx'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    write: false,
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  })
  const dir = mkdtempSync(join(fileURLToPath(root), '.liquid-glass-render-'))
  const file = join(dir, 'marketing.mjs')
  let html = ''
  try {
    writeFileSync(file, built.outputFiles[0].text)
    const mod = await import(pathToFileURL(file).href)
    html = renderToStaticMarkup(createElement(mod.Marketing))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  assert.match(html, /Peace of mind, every ride/)
  assert.match(html, /Drivers confirm before they come/)
  assert.match(html, /Book a ride/)
  assert.match(html, /Book a carpool/)
  assert.match(html, /Schedule for later/)
  assert.match(html, /Download the app/)
  assert.match(html, /Why Clemson Rides/)
  assert.match(html, /Safe nights out/)
  assert.match(html, /\/brand\/rider-icon\.svg/)
  assert.match(html, /mkt-glass-glyph/)
  assert.match(html, /clemson-memorial-stadium\.jpg/)
  assert.doesNotMatch(html, /tesla|robotaxi|self-driving/i)
})
