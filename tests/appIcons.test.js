import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const APPS = [
  { name: 'rider', dir: 'apps/rider' },
  { name: 'driver', dir: 'apps/driver' },
]

function readPng(file) {
  const buf = fs.readFileSync(file)
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} is not a PNG`)
  let offset = 8
  let width = 0
  let height = 0
  let colorType = -1
  let hasTrns = false
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'IHDR') {
      width = buf.readUInt32BE(offset + 8)
      height = buf.readUInt32BE(offset + 12)
      colorType = buf[offset + 17]
    } else if (type === 'tRNS') {
      hasTrns = true
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  return { width, height, colorType, hasTrns }
}

function splashImage(config) {
  const plugin = (config.expo.plugins || []).find(
    (entry) => Array.isArray(entry) && entry[0] === 'expo-splash-screen',
  )
  assert.ok(plugin, 'expo-splash-screen plugin')
  return plugin[1].image
}

function pixels(size, scale) {
  return Math.round(Number(size) * Number(String(scale).replace('x', '')))
}

for (const app of APPS) {
  test(`${app.name} Expo icon is a full-bleed 1024 RGB master`, () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, app.dir, 'app.json'), 'utf8'))
    assert.equal(config.expo.icon, './assets/images/icon.png')
    const file = path.join(ROOT, app.dir, config.expo.icon)
    const png = readPng(file)
    assert.equal(png.width, 1024)
    assert.equal(png.height, 1024)
    assert.equal(png.colorType, 2, 'iOS marketing icon must be RGB with no alpha')
    assert.equal(png.hasTrns, false)
    const light = path.join(ROOT, app.dir, config.expo.ios.icon.light)
    const lightHash = createHash('sha256').update(fs.readFileSync(light)).digest('hex')
    const iconHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    assert.equal(lightHash, iconHash)
  })

  test(`${app.name} iOS dark and tinted icons are 1024 RGB`, () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, app.dir, 'app.json'), 'utf8'))
    for (const key of ['dark', 'tinted']) {
      const rel = config.expo.ios.icon[key]
      assert.equal(typeof rel, 'string')
      const png = readPng(path.join(ROOT, app.dir, rel))
      assert.equal(png.width, 1024)
      assert.equal(png.height, 1024)
      assert.equal(png.colorType, 2, key)
      assert.equal(png.hasTrns, false)
    }
  })

  test(`${app.name} AppIcon set includes every size plus dark and tinted`, () => {
    const iconset = path.join(ROOT, app.dir, 'assets/images/AppIcon.appiconset')
    const contents = JSON.parse(fs.readFileSync(path.join(iconset, 'Contents.json'), 'utf8'))
    const idioms = new Set(contents.images.map((image) => image.idiom))
    assert.ok(idioms.has('iphone'))
    assert.ok(idioms.has('ipad'))
    assert.ok(idioms.has('ios-marketing'))
    const appearances = contents.images.flatMap((image) => image.appearances || [])
    assert.ok(appearances.some((item) => item.value === 'dark'))
    assert.ok(appearances.some((item) => item.value === 'tinted'))
    const marketing = contents.images.find((image) => image.idiom === 'ios-marketing')
    assert.equal(marketing.size, '1024x1024')
    for (const image of contents.images) {
      const file = path.join(iconset, image.filename)
      assert.equal(fs.existsSync(file), true, image.filename)
      const png = readPng(file)
      const size = pixels(String(image.size).split('x')[0], image.scale || '1x')
      assert.equal(png.width, size, image.filename)
      assert.equal(png.height, size, image.filename)
      assert.equal(png.colorType, 2, image.filename)
    }
  })

  test(`${app.name} adaptive, splash, and favicon replace the old icon files`, () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, app.dir, 'app.json'), 'utf8'))
    const adaptive = config.expo.android.adaptiveIcon
    const expected = [
      [adaptive.backgroundImage, 1024, 2],
      [adaptive.foregroundImage, 1024, 6],
      [adaptive.monochromeImage, 1024, 6],
      [splashImage(config), 1024, 6],
      [config.expo.web.favicon, 48, 2],
    ]
    for (const [rel, size, colorType] of expected) {
      const png = readPng(path.join(ROOT, app.dir, rel))
      assert.equal(png.width, size, rel)
      assert.equal(png.height, size, rel)
      assert.equal(png.colorType, colorType, rel)
    }
  })

  test(`${app.name} brand SVG is the vector source and has no marks or text`, () => {
    const file = path.join(ROOT, app.dir, 'assets/brand/icon.svg')
    const svg = fs.readFileSync(file, 'utf8')
    assert.match(svg, /#F56600/i)
    assert.match(svg, /id="background"/)
    assert.match(svg, /id="glyph"/)
    assert.match(svg, /id="background-dark"/)
    assert.match(svg, /id="background-tinted"/)
    assert.doesNotMatch(svg, /<text[\s>]/i)
    assert.doesNotMatch(svg, /clemson|tiger|paw|university/i)
    if (app.name === 'driver') assert.match(svg, /#522D80/i)
  })
}

test('rider and driver home icons are distinct', () => {
  const hashes = APPS.map((app) => {
    const bytes = fs.readFileSync(path.join(ROOT, app.dir, 'assets/images/icon.png'))
    return createHash('sha256').update(bytes).digest('hex')
  })
  assert.notEqual(hashes[0], hashes[1])
})
