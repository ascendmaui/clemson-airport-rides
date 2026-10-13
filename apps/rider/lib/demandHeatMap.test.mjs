import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  DEMAND_HEAT_COLORS,
  DEMAND_HEAT_STARTS,
  HEAT_BREATH_FRAMES,
  HEAT_BREATH_LOW,
  HEAT_BREATH_MS,
  QUIET_BELOW,
  VERY_BUSY_FROM,
  busynessColor,
  busynessInk,
  busynessLabel,
  demandGlows,
  demandPointsToHeat,
  fieldPlacement,
  framePercents,
  heatBloom,
  heatBreath,
  heatBreathFrame,
  heatBreathOpacity,
  heatRgbaAt,
  hotAreas,
  paintDemandHeat,
  rasterPixel,
  renderDemandHeatFrames,
  renderDemandHeatImage,
} from './demandHeatMap.ts'

const CANONICAL = [...DEMAND_HEAT_COLORS]

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function decodePng(uri) {
  const bytes = Buffer.from(uri.replace(/^data:image\/png;base64,/, ''), 'base64')
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  let offset = 8
  let width = 0
  let height = 0
  const idat = []
  while (offset + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const data = bytes.subarray(offset + 8, offset + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      assert.equal(data[8], 8)
      assert.equal(data[9], 6)
    }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + len
    if (type === 'IEND') break
  }
  const zlib = Buffer.concat(idat)
  assert.equal(zlib[0], 0x78)
  assert.equal(zlib[1], 0x01)
  let z = 2
  const rawParts = []
  while (z + 5 <= zlib.length) {
    const header = zlib[z]
    const len = zlib.readUInt16LE(z + 1)
    const nlen = zlib.readUInt16LE(z + 3)
    assert.equal(nlen, (len ^ 0xffff) & 0xffff)
    rawParts.push(zlib.subarray(z + 5, z + 5 + len))
    z += 5 + len
    if (header === 1) break
  }
  const raw = Buffer.concat(rawParts)
  const rgba = Buffer.alloc(width * height * 4)
  const stride = width * 4
  for (let y = 0; y < height; y += 1) {
    assert.equal(raw[y * (stride + 1)], 0)
    raw.copy(rgba, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1))
  }
  return { width, height, rgba }
}

test('empty demand returns no heat points and the Clemson gradient stops', () => {
  for (const input of [[], null, undefined, 'nope', {}, 4]) {
    const heat = demandPointsToHeat(input)
    assert.deepEqual(heat.points, [])
    assert.deepEqual(heat.gradient.colors, CANONICAL)
    assert.deepEqual(heat.gradient.startPoints, [...DEMAND_HEAT_STARTS])
    assert.equal(heat.gradient.colors.length, heat.gradient.startPoints.length)
    assert.equal(heat.gradient.startPoints[0], 0)
    assert.equal(heat.gradient.startPoints.at(-1), 1)
    assert.equal(heat.gradient.colorMapSize, 256)
    assert.deepEqual(heat.areas, [])
    assert.equal(paintDemandHeat(heat), null)
    assert.equal(renderDemandHeatImage(heat), null)
    assert.deepEqual(renderDemandHeatFrames(heat), [])
  }
})

test('weights scale with demand and a full peak uses orange then purple', () => {
  const heat = demandPointsToHeat([
    { id: 'dorm', lat: 34.6762, lng: -82.8348, intensity: 0.25 },
    { id: 'stadium', lat: 34.6788, lng: -82.843, intensity: 1 },
    { id: 'ave', latitude: 34.6839, longitude: -82.8366, weight: 4 },
    null,
    { lat: Number.NaN, lng: -82.84, intensity: 1 },
  ])
  const byLat = Object.fromEntries(heat.points.map((point) => [point.latitude, point.weight]))
  assert.equal(byLat[34.6762], 0.25)
  assert.equal(byLat[34.6788], 1)
  assert.equal(byLat[34.6839], 0.5)
  assert.ok(byLat[34.6788] > byLat[34.6839])
  assert.ok(byLat[34.6839] > byLat[34.6762])
  assert.deepEqual(heat.gradient.colors, CANONICAL)
  assert.equal(heat.gradient.colors[1], '#F56600')
  assert.equal(heat.gradient.colors.at(-1), '#522D80')
  assert.deepEqual(heatRgbaAt(0), [245, 102, 0, 0])
  assert.deepEqual(heatRgbaAt(0.42), [245, 102, 0, 255])
  assert.deepEqual(heatRgbaAt(1), [82, 45, 128, 255])
})

test('a quiet peak stays on the orange side of the ramp', () => {
  const heat = demandPointsToHeat([{ lat: 34.68, lng: -82.84, intensity: 0.2, request_count: 8 }])
  assert.equal(heat.points.length, 1)
  assert.equal(heat.points[0].weight, 0.2)
  assert.equal(heat.gradient.colors[0], 'rgba(245,102,0,0)')
  assert.notEqual(heat.gradient.colors.at(-1), '#522D80')
  assert.deepEqual(heat.gradient.startPoints, [...DEMAND_HEAT_STARTS])
})

test('request counts use the same cap as live busy spots', () => {
  assert.equal(demandPointsToHeat([{ lat: 1, lng: 2, request_count: 8 }]).points[0].weight, 1)
  assert.equal(demandPointsToHeat([{ lat: 1, lng: 2, requestCount: 2 }]).points[0].weight, 0.25)
  assert.equal(demandPointsToHeat([{ lat: 1, lng: 2, weight: 0.4 }]).points[0].weight, 0.4)
  assert.deepEqual(demandPointsToHeat([{ lat: 1, lng: 2, intensity: 0 }]).points, [])
})

test('the same corner keeps the hotter demand reading', () => {
  const heat = demandPointsToHeat([
    { lat: 34.6839, lng: -82.8366, intensity: 0.2, source: 'typical' },
    { lat: 34.6839, lng: -82.8366, intensity: 0.7, source: 'preview' },
  ])
  assert.equal(heat.points.length, 1)
  assert.equal(heat.points[0].weight, 0.7)
})

test('demo, simulated, theater, and busy cars never feed the heat', () => {
  const heat = demandPointsToHeat([
    { id: 'demo-marcus', lat: 34.679, lng: -82.843, intensity: 1, source: 'demo', simulated: true, heading: 20 },
    { id: 'demo-jenna', latitude: 34.684, longitude: -82.837, weight: 8 },
    { id: 'preview-2', lat: 34.67, lng: -82.84, intensity: 1, kind: 'theater' },
    { id: 'busy-car-4', lat: 34.681, lng: -82.839, intensity: 1, source: 'busy-car' },
    { id: 'e2e-car', lat: 34.682, lng: -82.838, intensity: 1, e2e: true },
    { id: 'college-ave-core', lat: 34.6839, lng: -82.8366, intensity: 0.2, source: 'typical' },
    { id: 'memorial-stadium', lat: 34.6788, lng: -82.843, intensity: 0.4, source: 'preview', preview: true },
  ])
  assert.deepEqual(heat.points.map((point) => point.weight).sort(), [0.2, 0.4])
  assert.equal(heat.areas.length, 2)
  assert.equal(heat.areas.some((area) => area.latitude === 34.679), false)
  assert.equal(heat.points.some((point) => point.latitude === 34.679), false)
  assert.notEqual(heat.gradient.colors.at(-1), '#522D80')
  assert.deepEqual(demandPointsToHeat([
    { id: 'demo-marcus', lat: 34.68, lng: -82.84, intensity: 1, source: 'demo' },
  ]).points, [])
})

test('heat stays translucent in light and dark map styles', () => {
  const light = demandPointsToHeat([{ lat: 1, lng: 2, intensity: 1 }], { scheme: 'light' })
  const dark = demandPointsToHeat([{ lat: 1, lng: 2, intensity: 1 }], { scheme: 'dark' })
  for (const heat of [light, dark]) {
    assert.ok(heat.opacity > 0 && heat.opacity <= 0.5)
    assert.equal(Number.isInteger(heat.radius), true)
    assert.ok(heat.radius >= 10 && heat.radius <= 50)
  }
  assert.ok(dark.opacity >= light.opacity)
  const hot = heatBloom(1, light.opacity)
  const quiet = heatBloom(0.2, light.opacity)
  assert.equal(hot.coreColor, '#522D80')
  assert.equal(hot.midColor, '#F56600')
  assert.equal(hot.coreOpacity, light.opacity)
  assert.ok(hot.coreOpacity <= 0.5)
  assert.notEqual(quiet.coreColor, '#522D80')
  assert.ok(quiet.coreOpacity < hot.coreOpacity)
  assert.ok(quiet.coreOpacity > 0)
})

test('quiet demand paints no wash, and busy glows are organic orange or purple', () => {
  const hot = demandPointsToHeat([{ lat: 34.6788, lng: -82.843, intensity: 1 }], { scheme: 'light' })
  const busy = demandPointsToHeat([{ lat: 34.6788, lng: -82.843, intensity: 0.5 }], { scheme: 'light' })
  const quiet = demandPointsToHeat([{ lat: 34.6788, lng: -82.843, intensity: 0.2 }], { scheme: 'light' })
  assert.equal(paintDemandHeat(quiet), null)
  assert.equal(renderDemandHeatImage(quiet), null)
  assert.equal(quiet.areas[0].label, 'Quiet')
  const hotRaster = paintDemandHeat(hot)
  const busyRaster = paintDemandHeat(busy)
  const hotPixel = rasterPixel(hotRaster, 34.6788, -82.843)
  const busyPixel = rasterPixel(busyRaster, 34.6788, -82.843)
  const corner = rasterPixel(hotRaster, hotRaster.north, hotRaster.west)
  const rim = []
  for (let step = 0; step < 8; step += 1) {
    const theta = (step / 8) * Math.PI * 2
    rim.push(rasterPixel(hotRaster, 34.6788 + Math.sin(theta) * 0.0024, -82.843 + Math.cos(theta) * 0.0024)[3])
  }
  assert.deepEqual(hotPixel.slice(0, 3), [82, 45, 128])
  assert.deepEqual(busyPixel.slice(0, 3), [245, 102, 0])
  assert.ok(hotPixel[3] > busyPixel[3])
  assert.ok(hotPixel[3] > 100 && hotPixel[3] < 160)
  assert.ok(busyPixel[3] > 20)
  assert.ok(Math.max(...rim) - Math.min(...rim) > 20)
  assert.ok(rim.every((alpha) => alpha < hotPixel[3] && alpha > corner[3]))
  assert.ok(corner[3] < 8)
  const mixed = paintDemandHeat(demandPointsToHeat([
    { lat: 34.68, lng: -82.84, intensity: 0.2 },
    { lat: 34.7, lng: -82.8, intensity: 0.9 },
  ]))
  assert.equal(rasterPixel(mixed, 34.68, -82.84)[3], 0)
  assert.deepEqual(rasterPixel(mixed, 34.7, -82.8).slice(0, 3), [82, 45, 128])
  const image = renderDemandHeatImage(hot)
  assert.equal(image.bounds[0][0] > 34.6788, true)
  assert.equal(image.bounds[1][0] < 34.6788, true)
  const decoded = decodePng(image.uri)
  assert.equal(decoded.width, hotRaster.width)
  assert.equal(decoded.height, hotRaster.height)
  const x = Math.round((( -82.843 - hotRaster.west) / (hotRaster.east - hotRaster.west)) * (hotRaster.width - 1))
  const y = Math.round(((hotRaster.north - 34.6788) / (hotRaster.north - hotRaster.south)) * (hotRaster.height - 1))
  const offset = (y * decoded.width + x) * 4
  assert.deepEqual([...decoded.rgba.subarray(offset, offset + 4)], hotPixel)
})

test('a single demand point sits in the middle of the preview frame', () => {
  const heat = demandPointsToHeat([{ lat: 34.68, lng: -82.84, intensity: 0.5 }])
  assert.deepEqual(framePercents(heat.points), [{ left: 50, top: 50 }])
  const spread = demandPointsToHeat([
    { lat: 34.67, lng: -82.85, intensity: 0.2 },
    { lat: 34.69, lng: -82.83, intensity: 0.8 },
  ])
  const frames = framePercents(spread.points)
  assert.equal(frames[0].top > frames[1].top, true)
  assert.equal(frames[0].left < frames[1].left, true)
})

test('busyness labels follow density thresholds and move from soft orange to purple', () => {
  assert.equal(busynessLabel(0), 'Quiet')
  assert.equal(busynessLabel(QUIET_BELOW - 0.001), 'Quiet')
  assert.equal(busynessLabel(QUIET_BELOW), 'Busy')
  assert.equal(busynessLabel(0.5), 'Busy')
  assert.equal(busynessLabel(VERY_BUSY_FROM - 0.001), 'Busy')
  assert.equal(busynessLabel(VERY_BUSY_FROM), 'Very busy')
  assert.equal(busynessLabel(1), 'Very busy')
  assert.equal(busynessLabel(4), 'Very busy')
  assert.equal(busynessLabel(Number.NaN), 'Quiet')
  assert.equal(busynessLabel(-0.2), 'Quiet')
  assert.equal(busynessColor('Quiet'), null)
  assert.equal(busynessColor('Busy'), '#F56600')
  assert.equal(busynessColor('Very busy'), '#522D80')
  assert.equal(busynessInk('Quiet'), '#1F1208')
  assert.equal(busynessInk('Busy'), '#1F1208')
  assert.equal(busynessInk('Very busy'), '#1F1208')
  assert.equal(demandGlows(0), false)
  assert.equal(demandGlows(QUIET_BELOW - 0.001), false)
  assert.equal(demandGlows(QUIET_BELOW), true)
  assert.equal(demandGlows(VERY_BUSY_FROM), true)
})

test('hot areas keep the hotter reading, glow only when busy, and skip demo cars', () => {
  const merged = hotAreas([
    { latitude: 34.68, longitude: -82.84, weight: 0.3 },
    { latitude: 34.681, longitude: -82.8404, weight: 0.8 },
  ])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].label, 'Very busy')
  assert.equal(merged[0].weight, 0.8)
  assert.equal(merged[0].busiest, true)
  assert.ok(merged[0].spanLat > 0.0017)
  const split = hotAreas([
    { latitude: 34.68, longitude: -82.84, weight: 0.5 },
    { latitude: 34.683, longitude: -82.84, weight: 0.2 },
  ])
  assert.equal(split.length, 2)
  assert.equal(split[0].label, 'Busy')
  assert.equal(split[0].busiest, true)
  assert.equal(split[1].label, 'Quiet')
  assert.equal(split[1].busiest, false)
  assert.equal(demandGlows(split[0].weight), true)
  assert.equal(demandGlows(split[1].weight), false)
  const alone = hotAreas([{ latitude: 1, longitude: 2, weight: 0.2 }])
  assert.equal(alone[0].label, 'Quiet')
  assert.equal(paintDemandHeat(demandPointsToHeat([{ lat: 1, lng: 2, intensity: 0.2 }])), null)
  const heat = demandPointsToHeat([
    { lat: 34.68, lng: -82.84, intensity: QUIET_BELOW },
    { lat: 34.7, lng: -82.8, intensity: VERY_BUSY_FROM },
    { id: 'demo-marcus', lat: 34.66, lng: -82.86, intensity: 1, source: 'demo', simulated: true },
  ])
  assert.deepEqual(heat.areas.map((area) => area.label), ['Very busy', 'Busy'])
  assert.equal(heat.areas[0].busiest, true)
  assert.equal(heat.points.length, 2)
  assert.equal(heat.areas.some((area) => area.latitude === 34.66), false)
})

test('the heat breathes slowly from a soft rest to full intensity', () => {
  assert.ok(Math.abs(heatBreath(0)) < 1e-9)
  assert.ok(Math.abs(heatBreath(HEAT_BREATH_MS / 2) - 1) < 1e-9)
  assert.ok(Math.abs(heatBreath(HEAT_BREATH_MS)) < 1e-9)
  assert.ok(Math.abs(heatBreath(HEAT_BREATH_MS / 4) - 0.5) < 1e-9)
  assert.equal(heatBreath(Number.NaN), 0)
  assert.equal(heatBreathFrame(0), 0)
  assert.equal(heatBreathFrame(HEAT_BREATH_MS / 2), HEAT_BREATH_FRAMES - 1)
  assert.equal(heatBreathFrame(HEAT_BREATH_MS), 0)
  assert.ok(HEAT_BREATH_MS >= 4000)
  assert.equal(heatBreathOpacity(0.34, 0), 0.245)
  assert.equal(heatBreathOpacity(0.34, 1), 0.34)
  assert.ok(heatBreathOpacity(0.34, 0) < heatBreathOpacity(0.34, 0.5))
  assert.ok(heatBreathOpacity(0.34, 0.5) < heatBreathOpacity(0.34, 1))
  assert.equal(heatBreathOpacity(0.42, 1), 0.42)
  assert.ok(heatBreathOpacity(0.42, 1) <= 0.5)
  assert.equal(HEAT_BREATH_LOW, 0.72)
  const hot = demandPointsToHeat([{ lat: 34.6788, lng: -82.843, intensity: 1 }], { scheme: 'light' })
  const frames = renderDemandHeatFrames(hot)
  assert.equal(frames.length, HEAT_BREATH_FRAMES)
  const place = fieldPlacement(hot.areas[0], frames[0].bounds)
  assert.ok(place.left > 40 && place.left < 60)
  assert.ok(place.top > 40 && place.top < 60)
  assert.ok(place.width >= 18)
  assert.ok(place.height >= 14)
  const rest = decodePng(frames[0].uri)
  const peak = decodePng(frames[frames.length - 1].uri)
  const north = frames[0].bounds[0][0]
  const east = frames[0].bounds[0][1]
  const south = frames[0].bounds[1][0]
  const west = frames[0].bounds[1][1]
  const x = Math.round(((-82.843 - west) / (east - west)) * (rest.width - 1))
  const y = Math.round(((north - 34.6788) / (north - south)) * (rest.height - 1))
  const offset = (y * rest.width + x) * 4
  assert.ok(rest.rgba[offset + 3] > 0)
  assert.ok(rest.rgba[offset + 3] < peak.rgba[offset + 3])
  assert.deepEqual([...rest.rgba.subarray(offset, offset + 3)], [...peak.rgba.subarray(offset, offset + 3)])
  const full = renderDemandHeatImage(hot)
  const decoded = decodePng(full.uri)
  assert.deepEqual([...decoded.rgba.subarray(offset, offset + 4)], [...peak.rgba.subarray(offset, offset + 4)])
})

test('the rider map heat layer does not read demo cars or paint demand circles', () => {
  const nativeMap = read('../components/CampusMap.native.tsx')
  const webMap = read('../components/CampusMap.tsx')
  const nativeLayer = read('../components/DemandHeatLayer.native.tsx')
  const webLayer = read('../components/DemandHeatLayer.tsx')
  assert.match(nativeMap, /DemandHeatLayer/)
  assert.match(webMap, /DemandHeatLayer/)
  assert.equal(nativeMap.includes('heatColor'), false)
  assert.equal(webMap.includes('heatColor'), false)
  assert.equal(webMap.includes('styles.blob'), false)
  assert.match(nativeLayer, /<Overlay/)
  assert.match(nativeLayer, /renderDemandHeatFrames/)
  assert.match(nativeLayer, /area\.label === 'Quiet'/)
  assert.match(nativeLayer, /area\.label/)
  assert.equal(nativeLayer.includes('<Heatmap'), false)
  assert.equal(nativeLayer.includes('<Polygon'), false)
  assert.equal(nativeLayer.includes('<Circle'), false)
  assert.equal(nativeLayer.includes('busiestOutline'), false)
  assert.equal(webLayer.includes('<Circle'), false)
  assert.equal(webLayer.includes('<Ellipse'), false)
  assert.equal(webLayer.includes('<Polygon'), false)
  assert.equal(webLayer.includes('fill="none"'), false)
  assert.match(webLayer, /renderDemandHeatImage/)
  assert.match(webLayer, /HEAT_BREATH_MS/)
  assert.match(webLayer, /area\.label === 'Quiet'/)
  assert.match(webLayer, /area\.label/)
  assert.match(webLayer, /backgroundColor: 'transparent'/)
  for (const src of [nativeLayer, webLayer]) {
    assert.equal(src.includes('useSimulatedFleet'), false)
    assert.equal(src.includes('simulatedFleet'), false)
    assert.equal(src.includes('demo-'), false)
  }
  assert.match(nativeMap, /useSimulatedFleet\(showSimulatedFleet \|\| searchMotion\)/)
  assert.match(nativeMap, /SIMULATED_FLEET_BADGE/)
})
