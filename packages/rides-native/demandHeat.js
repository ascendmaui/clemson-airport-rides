/**
 * Tiger Heat demand grid (client side).
 *
 * The server RPC public.driver_demand_cells aggregates trips into ~280 m
 * cells and returns decayed counts only. This module normalizes those rows,
 * scores them 0..1, colors them for light and dark maps, tweens between
 * refreshes, and keeps a 30 s poll plus realtime nudges running.
 *
 * Reusable: surge zones (game-day surge, party queue) can call
 * fetchDemandCells / topDemandZones without the map.
 */

import { uniqueChannelTopic } from './realtimeChannel.js'

export const DEMAND_RPC = 'driver_demand_cells'
export const DEMAND_REFRESH_MS = 30_000
export const DEMAND_NUDGE_DEBOUNCE_MS = 4_000
export const DEMAND_WINDOW_MINUTES = 20
export const PEAK_WINDOW_MINUTES = 30
export const CELL_LAT_DEG = 0.0025
export const CELL_LNG_DEG = 0.003
export const MAX_RENDER_CELLS = 30

const EARTH_M = 6371000

function finite(n, fallback = 0) {
  if (n === null || n === undefined || n === '') return fallback
  const value = Number(n)
  return Number.isFinite(value) ? value : fallback
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n))
}

export function distanceMeters(a, b) {
  if (!a || !b) return null
  const vals = [a.lat, a.lng, b.lat, b.lng].map(Number)
  if (!vals.every(Number.isFinite)) return null
  const [lat1, lng1, lat2, lng2] = vals
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((lng2 - lng1) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Same bucketing as the SQL, for tests and offline previews. */
export function cellFor(lat, lng) {
  const r = Math.floor(Number(lat) / CELL_LAT_DEG)
  const c = Math.floor(Number(lng) / CELL_LNG_DEG)
  return { id: `g${r}_${c}`, lat: (r + 0.5) * CELL_LAT_DEG, lng: (c + 0.5) * CELL_LNG_DEG }
}

/** Decay weight with a half-life of half the window (matches SQL). */
export function decayWeight(ageMinutes, windowMinutes = DEMAND_WINDOW_MINUTES) {
  const age = Math.max(0, finite(ageMinutes))
  const w = Math.max(1, finite(windowMinutes, DEMAND_WINDOW_MINUTES))
  if (age > w) return 0
  return Math.exp((-Math.LN2 * age) / (w / 2))
}

/** Pure mirror of the server aggregation; used by unit tests and previews. */
export function aggregateDemand(events, { now = Date.now(), windowMinutes = DEMAND_WINDOW_MINUTES, airportMultiplier = 1.5 } = {}) {
  const cells = new Map()
  for (const event of events || []) {
    const lat = Number(event?.lat)
    const lng = Number(event?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (event.e2e || event.demo) continue
    const kind = event.kind || 'request'
    const ageMin = (now - Date.parse(event.at)) / 60000
    let weight = 0
    if (kind === 'scheduled') weight = 1
    else if (Number.isFinite(ageMin)) weight = decayWeight(ageMin, windowMinutes) * (kind === 'pickup' ? 0.6 : 1)
    if (weight <= 0) continue
    if (event.airport) weight *= airportMultiplier
    const cell = cellFor(lat, lng)
    const row = cells.get(cell.id) || { cell_id: cell.id, lat: cell.lat, lng: cell.lng, demand: 0, requests: 0, pickups: 0, scheduled: 0, airport: 0 }
    row.demand += weight
    if (kind === 'request') row.requests += 1
    if (kind === 'pickup') row.pickups += 1
    if (kind === 'scheduled') row.scheduled += 1
    if (event.airport) row.airport += 1
    cells.set(cell.id, row)
  }
  return [...cells.values()].sort((a, b) => b.demand - a.demand)
}

/**
 * Normalize RPC rows into render-ready cells with a 0..1 intensity.
 * Intensity is relative to the hottest cell but floored by an absolute
 * scale so one lonely request does not paint the map red.
 */
export function normalizeDemandCells(rows, { peak = false, limit = MAX_RENDER_CELLS } = {}) {
  const clean = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: String(row?.cell_id ?? row?.id ?? ''),
      lat: finite(row?.lat, NaN),
      lng: finite(row?.lng, NaN),
      demand: Math.max(0, finite(row?.demand)),
      requests: Math.max(0, Math.round(finite(row?.requests))),
      pickups: Math.max(0, Math.round(finite(row?.pickups))),
      scheduled: Math.max(0, Math.round(finite(row?.scheduled))),
      airport: Math.max(0, Math.round(finite(row?.airport))),
    }))
    .filter((row) => row.id && Number.isFinite(row.lat) && Number.isFinite(row.lng) && row.demand > 0)
    .sort((a, b) => b.demand - a.demand)
    .slice(0, Math.max(1, limit))
  const scale = Math.max(peak ? 6 : 4, clean[0]?.demand || 0)
  return clean.map((row) => ({ ...row, intensity: clamp01(Math.sqrt(row.demand / scale)) }))
}

export function demandLevel(intensity) {
  const v = finite(intensity)
  if (v >= 0.75) return 'Very busy'
  if (v >= 0.5) return 'Busy'
  if (v >= 0.25) return 'Picking up'
  return 'Light'
}

/** Estimated ride requests in the next ~15 minutes, as a rounded range. */
export function estimatedDemand(cell) {
  const base = finite(cell?.demand)
  const low = Math.max(cell?.requests > 0 || cell?.scheduled > 0 ? 1 : 0, Math.floor(base * 0.75))
  const high = Math.max(low, Math.ceil(base * 1.25))
  return { low, high, label: low === high ? `~${low}` : `${low}–${high}` }
}

export function formatDistance(meters) {
  const m = finite(meters, NaN)
  if (!Number.isFinite(m)) return null
  const miles = m / 1609.344
  if (miles < 0.1) return `${Math.round(m * 3.281 / 10) * 10} ft`
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`
}

export function describeCell(cell, driver) {
  if (!cell) return null
  const meters = driver ? distanceMeters(cell, driver) : null
  const est = estimatedDemand(cell)
  const parts = []
  if (cell.requests) parts.push(`${cell.requests} asking now`)
  if (cell.pickups) parts.push(`${cell.pickups} recent pickup${cell.pickups === 1 ? '' : 's'}`)
  if (cell.scheduled) parts.push(`${cell.scheduled} scheduled soon`)
  if (cell.airport) parts.push('airport demand')
  return {
    title: demandLevel(cell.intensity),
    estimate: `${est.label} rides est. next 15 min`,
    detail: parts.join(' · '),
    distance: meters == null ? null : `${formatDistance(meters)} away`,
    meters,
  }
}

/**
 * Heat ramp tuned for contrast on both basemaps. Returns rgba strings for
 * the three stacked layers (halo, body, core) so the cell reads as a soft
 * gradient rather than a flat square.
 */
// Warm amber → Clemson orange #F56600 → ember → Clemson purple #522D80.
// The night ramp is lifted so the purple end still reads on a dark basemap.
const RAMP_LIGHT = [[255, 196, 122], [245, 102, 0], [176, 52, 36], [82, 45, 128]]
const RAMP_DARK = [[255, 214, 170], [255, 138, 46], [232, 96, 84], [186, 148, 232]]

function lerp(a, b, t) {
  return a + (b - a) * t
}

export function heatRgb(intensity, scheme = 'light') {
  const ramp = scheme === 'dark' ? RAMP_DARK : RAMP_LIGHT
  const v = clamp01(finite(intensity)) * (ramp.length - 1)
  const i = Math.min(ramp.length - 2, Math.floor(v))
  // Smoothstep between stops avoids the muddy linear-RGB midpoints and visible banding.
  const raw = v - i
  const t = raw * raw * (3 - 2 * raw)
  return ramp[i].map((c, k) => Math.round(lerp(c, ramp[i + 1][k], t)))
}

export function heatLayers(intensity, scheme = 'light') {
  const [r, g, b] = heatRgb(intensity, scheme)
  const v = clamp01(finite(intensity))
  const boost = scheme === 'dark' ? 1.15 : 1
  const a = (x) => Math.min(0.85, Number((x * boost).toFixed(3)))
  return {
    halo: `rgba(${r},${g},${b},${a(0.08 + 0.1 * v)})`,
    body: `rgba(${r},${g},${b},${a(0.14 + 0.18 * v)})`,
    core: `rgba(${r},${g},${b},${a(0.22 + 0.36 * v)})`,
    stroke: `rgba(${r},${g},${b},${a(0.4 + 0.32 * v)})`,
  }
}

/** Rounded-square ring around a cell center, scaled (1 = full cell). */
export function cellRing(cell, scale = 1, steps = 12) {
  const hl = (CELL_LAT_DEG / 2) * scale
  const hg = (CELL_LNG_DEG / 2) * scale
  const ring = []
  const n = Math.max(8, steps)
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2
    // superellipse (p=4): soft square that tiles without hard corners
    const cx = Math.cos(t)
    const sy = Math.sin(t)
    const x = Math.sign(cx) * Math.abs(cx) ** 0.5
    const y = Math.sign(sy) * Math.abs(sy) ** 0.5
    ring.push({ latitude: cell.lat + y * hl, longitude: cell.lng + x * hg })
  }
  return ring
}

/** Interpolate intensities between two snapshots (0 ≤ t ≤ 1). */
export function tweenCells(from, to, t) {
  const k = clamp01(finite(t, 1))
  const prev = new Map((from || []).map((cell) => [cell.id, cell]))
  const next = new Map((to || []).map((cell) => [cell.id, cell]))
  const out = []
  for (const cell of to || []) {
    const before = prev.get(cell.id)?.intensity ?? 0
    out.push({ ...cell, intensity: lerp(before, cell.intensity, k) })
  }
  for (const cell of from || []) {
    if (next.has(cell.id)) continue
    const intensity = lerp(cell.intensity, 0, k)
    if (intensity > 0.02) out.push({ ...cell, intensity, fading: true })
  }
  return out
}

/** Round intensities to steps so React only re-renders native overlays on visible change. */
export function quantize(intensity, steps = 12) {
  return Math.round(clamp01(finite(intensity)) * steps) / steps
}

export function topDemandZones(cells, { minIntensity = 0.5, limit = 5 } = {}) {
  return (cells || []).filter((cell) => cell.intensity >= minIntensity).slice(0, limit)
}

export async function fetchDemandCells(supabase, { peak = false, windowMinutes } = {}) {
  if (!supabase?.rpc) return { cells: [], error: 'no-client', at: Date.now() }
  const { data, error } = await supabase.rpc(DEMAND_RPC, {
    p_window_minutes: windowMinutes ?? (peak ? PEAK_WINDOW_MINUTES : DEMAND_WINDOW_MINUTES),
    p_peak: Boolean(peak),
  })
  if (error) return { cells: [], error: error.message || 'rpc-error', at: Date.now() }
  return { cells: normalizeDemandCells(data, { peak }), error: null, at: Date.now() }
}

/**
 * Poll every 30 s, refetch (debounced) on any trips realtime event the
 * driver can see, and pause while the app is backgrounded.
 * Returns an unsubscribe function.
 */
export function subscribeDemandCells(supabase, { peak = false, onData, intervalMs = DEMAND_REFRESH_MS, appState = null } = {}) {
  let stopped = false
  let timer = null
  let nudge = null
  let inFlight = false
  let active = true

  const run = async () => {
    if (stopped || inFlight || !active) return
    inFlight = true
    try {
      const result = await fetchDemandCells(supabase, { peak })
      if (!stopped) onData?.(result)
    } catch (err) {
      if (!stopped) onData?.({ cells: null, error: String(err?.message || err), at: Date.now() })
    } finally {
      inFlight = false
    }
  }

  run()
  timer = setInterval(run, intervalMs)

  let channel = null
  if (supabase?.channel) {
    try {
      channel = supabase
        .channel(uniqueChannelTopic('demand-heat'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => {
          if (nudge) return
          nudge = setTimeout(() => {
            nudge = null
            run()
          }, DEMAND_NUDGE_DEBOUNCE_MS)
        })
        .subscribe()
    } catch {
      channel = null
    }
  }

  const appSub = appState?.addEventListener?.('change', (state) => {
    const was = active
    active = state === 'active'
    if (active && !was) run()
  })

  return () => {
    stopped = true
    if (timer) clearInterval(timer)
    if (nudge) clearTimeout(nudge)
    appSub?.remove?.()
    if (channel && supabase?.removeChannel) supabase.removeChannel(channel)
  }
}
