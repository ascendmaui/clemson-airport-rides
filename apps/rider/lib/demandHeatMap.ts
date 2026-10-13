/**
 * Rider-map demand heat.
 *
 * Busy spots and Tiger Heat zones become weighted points on a Clemson ramp:
 * transparent, soft orange #F56600, purple #522D80 at the hottest demand.
 * Demo, simulated, and theater cars are dropped before any weight is read.
 *
 * Nearby points collapse into hot areas. Each area is Quiet, Busy, or Very
 * busy from its density, and the single hottest area carries a soft outline.
 * The field breathes on a slow sine so the wash pulses instead of sitting still.
 *
 * react-native-maps Heatmap is the Google heatmap. Android's default provider
 * is Google, so the native layer can mount it. iOS defaults to Apple Maps,
 * which throws if Heatmap is mounted, so that platform paints the same points
 * into a translucent image overlay.
 */

export const DEMAND_HEAT_COLORS = ['rgba(245,102,0,0)', '#F56600', '#522D80'] as const
export const DEMAND_HEAT_STARTS = [0, 0.42, 1] as const
export const DEMAND_HEAT_RADIUS = 46

/** Density below this is Quiet. From here up to VERY_BUSY_FROM is Busy. */
export const QUIET_BELOW = 0.4
/** Density at or above this is Very busy. */
export const VERY_BUSY_FROM = 0.72
export const HEAT_BREATH_MS = 5600
export const HEAT_BREATH_LOW = 0.72
export const HEAT_BREATH_FRAMES = 8

/** Live demand in loadBusySpots uses intensity = min(1, weight / 8). */
const DEMAND_WEIGHT_SCALE = 8
const LIGHT_OPACITY = 0.34
const DARK_OPACITY = 0.42

const RASTER_SIZE = 256
const SIGMA_DEG = 0.0022
const SIGMA_PAD = 3.4
const AREA_MERGE_DEG = 0.0024
const BUSY_GLOW_MIN_DEG = 0.0017

const DEMO_SOURCES = new Set([
  'demo',
  'simulated',
  'theater',
  'preview-car',
  'busy-car',
  'busycar',
])

export type DemandPoint = {
  id?: string
  lat?: number
  lng?: number
  latitude?: number
  longitude?: number
  intensity?: number
  weight?: number
  demand?: number
  count?: number
  request_count?: number
  requestCount?: number
  source?: string
  kind?: string
  demo?: boolean
  simulated?: boolean
  e2e?: boolean
}

export type WeightedHeatPoint = {
  latitude: number
  longitude: number
  weight: number
}

export type BusynessLabel = 'Quiet' | 'Busy' | 'Very busy'

export type HotArea = {
  latitude: number
  longitude: number
  weight: number
  label: BusynessLabel
  busiest: boolean
  spanLat: number
  spanLng: number
}

export type FieldPlacement = {
  left: number
  top: number
  width: number
  height: number
}

export type DemandHeatGradient = {
  colors: string[]
  startPoints: number[]
  colorMapSize: number
}

export type DemandHeatModel = {
  points: WeightedHeatPoint[]
  areas: HotArea[]
  gradient: DemandHeatGradient
  opacity: number
  radius: number
}

export type HeatRaster = {
  width: number
  height: number
  rgba: Uint8Array
  north: number
  south: number
  east: number
  west: number
}

export type DemandHeatImage = {
  uri: string
  bounds: [[number, number], [number, number]]
}

export type HeatBloom = {
  size: number
  coreColor: string
  coreOpacity: number
  midColor: string
  midOpacity: number
}

type Rgba = [number, number, number, number]
type Scheme = 'light' | 'dark'

const PARSED_STOPS: Rgba[] = DEMAND_HEAT_COLORS.map(parseColor)

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function finite(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function roundWeight(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function roundOpacity(value: number): number {
  return Math.round(value * 1000) / 1000
}

function isRecord(value: unknown): value is DemandPoint {
  return Boolean(value) && typeof value === 'object'
}

function parseColor(input: string): Rgba {
  if (input.startsWith('#')) {
    const hex = input.slice(1)
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      255,
    ]
  }
  const match = input.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)/)
  if (!match) return [0, 0, 0, 0]
  const alpha = match[4] == null ? 1 : Number(match[4])
  return [Number(match[1]), Number(match[2]), Number(match[3]), Math.round(clamp01(alpha) * 255)]
}

function rgbHex(r: number, g: number, b: number): string {
  const channel = (value: number) => value.toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

function rgbaCss(color: Rgba): string {
  const [r, g, b, a] = color
  if (a >= 255) return rgbHex(r, g, b)
  return `rgba(${r},${g},${b},${roundOpacity(a / 255)})`
}

function canonicalGradient(): DemandHeatGradient {
  return {
    colors: [...DEMAND_HEAT_COLORS],
    startPoints: [...DEMAND_HEAT_STARTS],
    colorMapSize: 256,
  }
}

function opacityFor(scheme: Scheme): number {
  switch (scheme) {
    case 'light':
      return LIGHT_OPACITY
    case 'dark':
      return DARK_OPACITY
    default: {
      const unexpected: never = scheme
      return unexpected
    }
  }
}

export function heatRgbaAt(amount: number): Rgba {
  const t = clamp01(amount)
  const stops = DEMAND_HEAT_STARTS
  let index = 0
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (t >= stops[i] && t <= stops[i + 1]) index = i
  }
  const span = stops[index + 1] - stops[index] || 1
  const u = (t - stops[index]) / span
  const from = PARSED_STOPS[index]
  const to = PARSED_STOPS[index + 1]
  return [
    Math.round(from[0] + (to[0] - from[0]) * u),
    Math.round(from[1] + (to[1] - from[1]) * u),
    Math.round(from[2] + (to[2] - from[2]) * u),
    Math.round(from[3] + (to[3] - from[3]) * u),
  ]
}

function gradientForPeak(peak: number): DemandHeatGradient {
  if (!(peak > 0) || peak >= 0.999) return canonicalGradient()
  const hot = Math.min(1, peak)
  return {
    colors: [0, DEMAND_HEAT_STARTS[1], 1].map((stop) => rgbaCss(heatRgbaAt(stop * hot))),
    startPoints: [...DEMAND_HEAT_STARTS],
    colorMapSize: 256,
  }
}

export function isDemoDemandPoint(point: DemandPoint): boolean {
  if (point.demo === true || point.simulated === true || point.e2e === true) return true
  const id = String(point.id ?? '')
  if (id.startsWith('demo-') || id.startsWith('preview-')) return true
  const source = String(point.source ?? '').toLowerCase()
  const kind = String(point.kind ?? '').toLowerCase()
  return DEMO_SOURCES.has(source) || DEMO_SOURCES.has(kind)
}

function coordinate(point: DemandPoint): { latitude: number; longitude: number } | null {
  const latitude = finite(point.lat) ?? finite(point.latitude)
  const longitude = finite(point.lng) ?? finite(point.longitude)
  if (latitude == null || longitude == null) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

function demandWeight(point: DemandPoint): number | null {
  const intensity = finite(point.intensity)
  if (intensity != null) {
    if (intensity <= 0) return null
    return clamp01(intensity)
  }
  const count = finite(point.requestCount) ?? finite(point.request_count) ?? finite(point.count) ?? finite(point.demand)
  const raw = finite(point.weight) ?? count
  if (raw == null || raw <= 0) return null
  if (raw <= 1) return raw
  return clamp01(raw / DEMAND_WEIGHT_SCALE)
}

export function busynessLabel(density: number): BusynessLabel {
  const value = typeof density === 'number' && Number.isFinite(density) ? density : 0
  if (value >= VERY_BUSY_FROM) return 'Very busy'
  if (value >= QUIET_BELOW) return 'Busy'
  return 'Quiet'
}

export function busynessColor(label: BusynessLabel): string {
  switch (label) {
    case 'Quiet':
      return '#F8A15A'
    case 'Busy':
      return '#F56600'
    case 'Very busy':
      return '#522D80'
    default: {
      const unexpected: never = label
      return unexpected
    }
  }
}

export function busynessInk(label: BusynessLabel): string {
  switch (label) {
    case 'Quiet':
    case 'Busy':
      return '#1F1208'
    case 'Very busy':
      return '#FFFFFF'
    default: {
      const unexpected: never = label
      return unexpected
    }
  }
}

function degreesApart(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  return Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude)
}

export function hotAreas(points: WeightedHeatPoint[]): HotArea[] {
  const seeds = [...points].sort((a, b) => b.weight - a.weight || a.latitude - b.latitude || a.longitude - b.longitude)
  const groups: Array<{ center: WeightedHeatPoint; spanLat: number; spanLng: number }> = []
  for (const point of seeds) {
    const group = groups.find((item) => degreesApart(item.center, point) <= AREA_MERGE_DEG)
    if (!group) {
      groups.push({ center: point, spanLat: BUSY_GLOW_MIN_DEG, spanLng: BUSY_GLOW_MIN_DEG })
      continue
    }
    group.spanLat = roundWeight(Math.max(group.spanLat, Math.abs(point.latitude - group.center.latitude) * 2.2))
    group.spanLng = roundWeight(Math.max(group.spanLng, Math.abs(point.longitude - group.center.longitude) * 2.2))
  }
  return groups.map((group, index) => ({
    latitude: group.center.latitude,
    longitude: group.center.longitude,
    weight: group.center.weight,
    label: busynessLabel(group.center.weight),
    busiest: index === 0,
    spanLat: group.spanLat,
    spanLng: group.spanLng,
  }))
}

export function busiestOutline(area: HotArea, scale = 1, steps = 36): Array<{ latitude: number; longitude: number }> {
  const count = Math.max(12, Math.floor(steps))
  const lat = area.spanLat * (scale > 0 ? scale : 1)
  const lng = area.spanLng * (scale > 0 ? scale : 1)
  const ring: Array<{ latitude: number; longitude: number }> = []
  for (let step = 0; step < count; step += 1) {
    const theta = (step / count) * Math.PI * 2
    ring.push({
      latitude: roundWeight(area.latitude + Math.sin(theta) * lat),
      longitude: roundWeight(area.longitude + Math.cos(theta) * lng),
    })
  }
  return ring
}

export function busiestGlowColor(label: BusynessLabel, breath: number, band: 'wide' | 'tight' = 'tight'): string {
  const [red, green, blue] = parseColor(busynessColor(label))
  const wave = clamp01(breath)
  let alpha: number
  switch (band) {
    case 'wide':
      alpha = 0.1 + 0.18 * wave
      break
    case 'tight':
      alpha = 0.28 + 0.36 * wave
      break
    default: {
      const unexpected: never = band
      return unexpected
    }
  }
  return `rgba(${red},${green},${blue},${roundOpacity(alpha)})`
}

/** 0 at the rest of the breath, 1 at the peak. One full cycle is HEAT_BREATH_MS. */
export function heatBreath(elapsedMs: number): number {
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) return 0
  const turns = elapsedMs / HEAT_BREATH_MS
  const wrapped = turns - Math.floor(turns)
  return 0.5 - 0.5 * Math.cos(wrapped * Math.PI * 2)
}

export function heatBreathFrame(elapsedMs: number, frames = HEAT_BREATH_FRAMES): number {
  const count = Math.max(1, Math.floor(frames))
  if (count === 1) return 0
  const index = Math.round(heatBreath(elapsedMs) * (count - 1))
  return Math.min(count - 1, Math.max(0, index))
}

export function heatBreathOpacity(base: number, breath: number): number {
  const scale = HEAT_BREATH_LOW + (1 - HEAT_BREATH_LOW) * clamp01(breath)
  return roundOpacity(base * scale)
}

export function demandPointsToHeat(input: unknown, options?: { scheme?: Scheme }): DemandHeatModel {
  const scheme: Scheme = options?.scheme === 'dark' ? 'dark' : 'light'
  const rows = Array.isArray(input) ? input : []
  const merged = new Map<string, WeightedHeatPoint>()
  const order: string[] = []
  for (const row of rows) {
    if (!isRecord(row) || isDemoDemandPoint(row)) continue
    const at = coordinate(row)
    const weight = demandWeight(row)
    if (!at || weight == null) continue
    const key = `${at.latitude.toFixed(4)},${at.longitude.toFixed(4)}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { latitude: at.latitude, longitude: at.longitude, weight: roundWeight(weight) })
      order.push(key)
      continue
    }
    existing.weight = roundWeight(Math.max(existing.weight, weight))
  }
  const points = order.map((key) => merged.get(key)).filter((point): point is WeightedHeatPoint => Boolean(point))
  const peak = points.reduce((max, point) => Math.max(max, point.weight), 0)
  return {
    points,
    areas: hotAreas(points),
    gradient: gradientForPeak(peak),
    opacity: opacityFor(scheme),
    radius: DEMAND_HEAT_RADIUS,
  }
}

export function framePercents(points: WeightedHeatPoint[]): Array<{ left: number; top: number }> {
  if (!points.length) return []
  let north = -Infinity
  let south = Infinity
  let east = -Infinity
  let west = Infinity
  for (const point of points) {
    north = Math.max(north, point.latitude)
    south = Math.min(south, point.latitude)
    east = Math.max(east, point.longitude)
    west = Math.min(west, point.longitude)
  }
  const latSpan = Math.max(0.004, north - south)
  const lngSpan = Math.max(0.004, east - west)
  const midLat = (north + south) / 2
  const midLng = (east + west) / 2
  north = midLat + latSpan / 2
  south = midLat - latSpan / 2
  east = midLng + lngSpan / 2
  west = midLng - lngSpan / 2
  return points.map((point) => {
    const x = (point.longitude - west) / (east - west)
    const y = (north - point.latitude) / (north - south)
    const clamp = (value: number) => Math.min(0.88, Math.max(0.12, value))
    return {
      left: Math.round(clamp(x) * 1000) / 10,
      top: Math.round(clamp(y) * 1000) / 10,
    }
  })
}

export function fieldPlacement(
  area: Pick<HotArea, 'latitude' | 'longitude' | 'spanLat' | 'spanLng'>,
  bounds: [[number, number], [number, number]],
): FieldPlacement {
  const north = bounds[0][0]
  const east = bounds[0][1]
  const south = bounds[1][0]
  const west = bounds[1][1]
  const latSpan = Math.max(1e-6, north - south)
  const lngSpan = Math.max(1e-6, east - west)
  const round = (value: number) => Math.round(value * 10) / 10
  return {
    left: round(((area.longitude - west) / lngSpan) * 100),
    top: round(((north - area.latitude) / latSpan) * 100),
    width: round(Math.max(18, ((area.spanLng * 2) / lngSpan) * 100)),
    height: round(Math.max(14, ((area.spanLat * 2) / latSpan) * 100)),
  }
}

export function heatBloom(weight: number, opacity: number): HeatBloom {
  const core = heatRgbaAt(weight)
  const mid = heatRgbaAt(weight * DEMAND_HEAT_STARTS[1])
  return {
    size: Math.round(108 + clamp01(weight) * 72),
    coreColor: rgbHex(core[0], core[1], core[2]),
    coreOpacity: roundOpacity((core[3] / 255) * opacity),
    midColor: rgbHex(mid[0], mid[1], mid[2]),
    midOpacity: roundOpacity((mid[3] / 255) * opacity),
  }
}

export function nativeDemandHeatSupported(platform: string): boolean {
  return platform === 'android'
}

export function paintDemandHeat(model: DemandHeatModel): HeatRaster | null {
  if (!model.points.length) return null
  let north = -Infinity
  let south = Infinity
  let east = -Infinity
  let west = Infinity
  for (const point of model.points) {
    north = Math.max(north, point.latitude)
    south = Math.min(south, point.latitude)
    east = Math.max(east, point.longitude)
    west = Math.min(west, point.longitude)
  }
  const pad = SIGMA_DEG * SIGMA_PAD
  north += pad
  south -= pad
  east += pad
  west -= pad
  const latSpan = Math.max(1e-6, north - south)
  const lngSpan = Math.max(1e-6, east - west)
  const width = RASTER_SIZE
  const height = RASTER_SIZE
  const sigmaPx = Math.max(8, (SIGMA_DEG / latSpan) * (height - 1))
  const field = new Float64Array(width * height)
  const radius = Math.ceil(sigmaPx * 3)
  const denom = 2 * sigmaPx * sigmaPx
  for (const point of model.points) {
    const x = ((point.longitude - west) / lngSpan) * (width - 1)
    const y = ((north - point.latitude) / latSpan) * (height - 1)
    const x0 = Math.max(0, Math.floor(x - radius))
    const x1 = Math.min(width - 1, Math.ceil(x + radius))
    const y0 = Math.max(0, Math.floor(y - radius))
    const y1 = Math.min(height - 1, Math.ceil(y + radius))
    for (let py = y0; py <= y1; py += 1) {
      const dy = py - y
      for (let px = x0; px <= x1; px += 1) {
        const dx = px - x
        field[py * width + px] += point.weight * Math.exp(-(dx * dx + dy * dy) / denom)
      }
    }
  }
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < field.length; i += 1) {
    const density = field[i]
    if (density <= 0) continue
    const ratio = Math.min(1, density)
    const [r, g, b] = heatRgbaAt(ratio)
    // Alpha follows the gaussian, so the core fades instead of sitting as a flat disk.
    const alpha = Math.round(model.opacity * ratio * 255)
    if (alpha < 2) continue
    const offset = i * 4
    rgba[offset] = r
    rgba[offset + 1] = g
    rgba[offset + 2] = b
    rgba[offset + 3] = Math.min(255, alpha)
  }
  return { width, height, rgba, north, south, east, west }
}

export function rasterPixel(raster: HeatRaster, latitude: number, longitude: number): Rgba | null {
  if (latitude > raster.north || latitude < raster.south || longitude < raster.west || longitude > raster.east) return null
  const x = Math.round(((longitude - raster.west) / (raster.east - raster.west)) * (raster.width - 1))
  const y = Math.round(((raster.north - latitude) / (raster.north - raster.south)) * (raster.height - 1))
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return null
  const offset = (y * raster.width + x) * 4
  return [raster.rgba[offset], raster.rgba[offset + 1], raster.rgba[offset + 2], raster.rgba[offset + 3]]
}

function heatImage(raster: HeatRaster, rgba: Uint8Array): DemandHeatImage {
  return {
    uri: `data:image/png;base64,${encodePngBase64(raster.width, raster.height, rgba)}`,
    bounds: [
      [raster.north, raster.east],
      [raster.south, raster.west],
    ],
  }
}

function scaleHeatAlpha(rgba: Uint8Array, breath: number): Uint8Array {
  const wave = clamp01(breath)
  if (wave >= 0.999) return rgba
  const scale = HEAT_BREATH_LOW + (1 - HEAT_BREATH_LOW) * wave
  const next = new Uint8Array(rgba.length)
  for (let index = 0; index < rgba.length; index += 4) {
    next[index] = rgba[index]
    next[index + 1] = rgba[index + 1]
    next[index + 2] = rgba[index + 2]
    next[index + 3] = Math.round(rgba[index + 3] * scale)
  }
  return next
}

export function renderDemandHeatImage(model: DemandHeatModel): DemandHeatImage | null {
  const raster = paintDemandHeat(model)
  if (!raster) return null
  return heatImage(raster, raster.rgba)
}

export function renderDemandHeatFrames(model: DemandHeatModel, frames = HEAT_BREATH_FRAMES): DemandHeatImage[] {
  const raster = paintDemandHeat(model)
  if (!raster) return []
  const count = Math.max(1, Math.floor(frames))
  const images: DemandHeatImage[] = []
  for (let frame = 0; frame < count; frame += 1) {
    const breath = count === 1 ? 1 : frame / (count - 1)
    images.push(heatImage(raster, scaleHeatAlpha(raster.rgba, breath)))
  }
  return images
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
let crcTable: Uint32Array | null = null

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let length = 0
  for (const part of parts) length += part.length
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i += 1) {
    a += bytes[i]
    if (a >= 65521) a -= 65521
    b += a
    if (b >= 65521) b -= 65521
  }
  return ((b << 16) | a) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length)
  for (let i = 0; i < 4; i += 1) body[i] = type.charCodeAt(i)
  body.set(data, 4)
  const crc = crc32(body)
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(body, 4)
  view.setUint32(8 + data.length, crc)
  return out
}

function ihdr(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13)
  const view = new DataView(data.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  data[8] = 8
  data[9] = 6
  return data
}

function rawScanlines(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4
  const raw = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y += 1) {
    const dest = y * (stride + 1)
    raw[dest] = 0
    raw.set(rgba.subarray(y * stride, y * stride + stride), dest + 1)
  }
  return raw
}

function zlibStore(raw: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [Uint8Array.from([0x78, 0x01])]
  const max = 65535
  for (let offset = 0; offset < raw.length; offset += max) {
    const len = Math.min(max, raw.length - offset)
    const last = offset + len >= raw.length
    const block = new Uint8Array(5 + len)
    block[0] = last ? 1 : 0
    block[1] = len & 0xff
    block[2] = (len >> 8) & 0xff
    const nlen = (len ^ 0xffff) & 0xffff
    block[3] = nlen & 0xff
    block[4] = (nlen >> 8) & 0xff
    block.set(raw.subarray(offset, offset + len), 5)
    blocks.push(block)
  }
  const sum = adler32(raw)
  const tail = new Uint8Array(4)
  new DataView(tail.buffer).setUint32(0, sum)
  blocks.push(tail)
  return concatBytes(blocks)
}

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const triple = (a << 16) | (b << 8) | c
    out += BASE64[(triple >> 18) & 63]
    out += BASE64[(triple >> 12) & 63]
    out += i + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : '='
    out += i + 2 < bytes.length ? BASE64[triple & 63] : '='
  }
  return out
}

function encodePngBase64(width: number, height: number, rgba: Uint8Array): string {
  const png = concatBytes([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr(width, height)),
    pngChunk('IDAT', zlibStore(rawScanlines(width, height, rgba))),
    pngChunk('IEND', new Uint8Array(0)),
  ])
  return toBase64(png)
}
