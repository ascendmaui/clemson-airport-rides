/**
 * Tablet kiosk helpers: offline feed cache, impression queue, media cache.
 * Storage is injected so tests run without a browser.
 */
export const FEED_KEY = 'cr_tablet_feed_v1'
export const QUEUE_KEY = 'cr_tablet_impressions_v1'
export const TOKEN_KEY = 'cr_tablet_device_v1'
export const MEDIA_CACHE = 'cr-tablet-media-v1'
export const MAX_QUEUE = 2000

const store = (s) => s || (typeof window !== 'undefined' ? window.localStorage : null)

function readJson(s, key, fallback) {
  try {
    const raw = store(s)?.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}
function writeJson(s, key, value) {
  try { store(s)?.setItem(key, JSON.stringify(value)) } catch { /* quota or private mode */ }
}

export function rememberDeviceToken(token, s) {
  if (token) { try { store(s)?.setItem(TOKEN_KEY, token) } catch { /* ignore */ } return token }
  try { return store(s)?.getItem(TOKEN_KEY) || '' } catch { return '' }
}

export const saveFeed = (feed, s) => writeJson(s, FEED_KEY, feed)
export const loadFeed = (s) => readJson(s, FEED_KEY, null)

export function queueImpression(imp, s) {
  const q = readJson(s, QUEUE_KEY, [])
  q.push(imp)
  writeJson(s, QUEUE_KEY, q.slice(-MAX_QUEUE))
  return q.length
}

/** Send queued impressions; keep them when offline or the server fails. */
export async function flushImpressions(send, s) {
  const q = readJson(s, QUEUE_KEY, [])
  if (!q.length) return { sent: 0 }
  const batch = q.slice(0, 200)
  try {
    await send(batch)
  } catch (err) {
    return { sent: 0, error: err?.message || 'offline' }
  }
  const rest = readJson(s, QUEUE_KEY, []).filter((i) => !batch.some((b) => b.clientId === i.clientId))
  writeJson(s, QUEUE_KEY, rest)
  return { sent: batch.length }
}

let counter = 0
export function impressionFor(slot, { startedAt, endedAt = Date.now(), inTrip = false } = {}) {
  counter += 1
  return {
    clientId: `${startedAt.toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    campaignId: slot.campaignId,
    creativeId: slot.creativeId,
    shownAt: new Date(startedAt).toISOString(),
    seconds: Math.max(0, Math.round((endedAt - startedAt) / 100) / 10),
    inTrip: Boolean(inTrip),
  }
}

/** Pre-cache creative media so the loop keeps playing in a dead zone. */
export async function cacheMedia(urls = [], cachesApi = typeof caches !== 'undefined' ? caches : null) {
  if (!cachesApi) return 0
  const cache = await cachesApi.open(MEDIA_CACHE)
  let n = 0
  for (const url of [...new Set(urls.filter(Boolean))]) {
    try {
      if (!(await cache.match(url))) await cache.add(url)
      n += 1
    } catch { /* keep going; the network URL still works online */ }
  }
  return n
}

/** Object URL from the media cache when present, else the network URL. */
export async function mediaSrc(url, cachesApi = typeof caches !== 'undefined' ? caches : null) {
  if (!url || !cachesApi) return url
  try {
    const cache = await cachesApi.open(MEDIA_CACHE)
    const hit = await cache.match(url)
    if (hit) return URL.createObjectURL(await hit.blob())
  } catch { /* fall through */ }
  return url
}

/** Built-in TEST creatives for /tablet?demo=1. Nothing is logged in demo mode. */
export const DEMO_FEED = {
  device: { id: 'demo', label: 'Demo tablet', demo: true },
  gameDay: false,
  trip: null,
  loop: [
    { creativeId: 'demo-1', campaignId: 'demo', seconds: 8, placement: 'first_in_loop' },
    { creativeId: 'demo-2', campaignId: 'demo', seconds: 8, placement: 'standard' },
  ],
  creatives: {
    'demo-1': { id: 'demo-1', kind: 'built', headline: 'TEST Tiger Tacos', dealText: 'TEST ad: 15% off before kickoff with this code', qrUrl: 'https://clemsonrides.com/advertise', theme: 'purple' },
    'demo-2': { id: 'demo-2', kind: 'built', headline: 'Your business here', dealText: 'Advertise on every Clemson Rides tablet', qrUrl: 'https://clemsonrides.com/advertise', theme: 'orange' },
  },
}
