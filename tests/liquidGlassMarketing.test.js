import assert from 'node:assert/strict'
import test from 'node:test'
import { planReveals, revealDelay } from '../src/lib/glassMotion.js'
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

test('scroll reveals stagger by sibling and stay visible above the fold', () => {
  assert.equal(revealDelay(0), '0ms')
  assert.equal(revealDelay(1), '70ms')
  assert.equal(revealDelay(2), '140ms')
  assert.equal(revealDelay(9), '280ms')
  const parent = {}
  const other = {}
  const plan = planReveals([
    { top: 10, parentKey: parent },
    { top: 800, parentKey: parent },
    { top: 900, parentKey: parent },
    { top: 40, parentKey: other },
  ], 700)
  assert.equal(plan[0].hide, false)
  assert.equal(plan[0].delay, '0ms')
  assert.equal(plan[1].hide, true)
  assert.equal(plan[1].delay, '70ms')
  assert.equal(plan[2].hide, true)
  assert.equal(plan[2].delay, '140ms')
  assert.equal(plan[3].hide, false)
  assert.equal(plan[3].delay, '0ms')
})

test('glass motion uses IntersectionObserver and animates transform and opacity only', () => {
  const js = read('src/lib/glassMotion.js')
  assert.match(js, /IntersectionObserver/)
  assert.match(js, /prefers-reduced-motion/)
  const css = read('src/styles/liquidGlass.css')
  const frames = [...css.matchAll(/@keyframes glass-[\w-]+ \{[\s\S]*?\n\}/g)].map((match) => match[0]).join('\n')
  assert.match(frames, /@keyframes glass-rise/)
  assert.match(frames, /@keyframes glass-fade/)
  assert.match(frames, /@keyframes glass-sweep/)
  assert.match(frames, /translate3d/)
  assert.match(frames, /opacity/)
  assert.doesNotMatch(frames, /filter:|box-shadow:|background-position:|margin-|width:|left:|top:/)
  const reduceAt = css.indexOf('@media (prefers-reduced-motion: reduce)')
  assert.ok(reduceAt > 0)
  const reduce = css.slice(reduceAt)
  assert.match(reduce, /animation:\s*none !important/)
  assert.match(reduce, /transition:\s*none !important/)
  assert.match(reduce, /opacity:\s*1 !important/)
  assert.match(reduce, /transform:\s*none !important/)
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
