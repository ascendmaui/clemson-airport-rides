import { resolveApiBase } from './apiOrigin.js'
import {
  evaluateTigerHeat,
  heatWindowActivation,
  normalizeTigerHeatMap,
  tigerHeatAnchor,
} from './tigerHeat.js'

function localPreview(windowId) {
  const activation = heatWindowActivation(windowId || 'now')
  if (activation === 'preview-history') {
    return normalizeTigerHeatMap({ windowId, activation, zones: [] })
  }
  const evaluated = evaluateTigerHeat({
    at: tigerHeatAnchor(windowId || 'now', new Date()),
    requests: [],
    activation: activation === 'live' ? 'live' : activation,
  })
  const zones = activation === 'live'
    ? evaluated.zones.filter((zone) => zone.preview && !zone.payable)
    : evaluated.zones
  return normalizeTigerHeatMap({
    windowId: windowId || 'now',
    activation,
    zones,
    error: 'preview-only',
  })
}

export async function fetchTigerHeatMap(windowId = 'now', options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const name = windowId || 'now'
  if (typeof fetchImpl !== 'function') return localPreview(name)
  const base = options.base != null
    ? String(options.base).replace(/\/$/, '')
    : (typeof window !== 'undefined' ? '' : resolveApiBase())
  try {
    const response = await fetchImpl(`${base}/api/tiger-heat?window=${encodeURIComponent(name)}`)
    if (!response?.ok) return localPreview(name)
    const body = await response.json()
    return normalizeTigerHeatMap(body)
  } catch {
    return localPreview(name)
  }
}
