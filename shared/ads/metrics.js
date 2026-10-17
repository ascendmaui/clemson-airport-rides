/**
 * Partner analytics counters. Pure so the server, the page and tests agree on definitions.
 *
 *  Ad runs      every time the ad played on a tablet (each loop slot), in or out of a ride.
 *  Impressions  plays shown to riders: during an in-progress ride, with the tablet screen on and
 *               the page visible the whole slot, for at least MIN_VISIBLE_SECONDS.
 *  Rides        distinct rides the ad ran in. Each counts once against the ride bundle.
 *  QR scans     unique scans of the ad's tracking QR. Repeat scans from the same phone within
 *               SCAN_DEDUPE_MINUTES count once. Scan rate = QR scans / rides.
 */
export const MIN_VISIBLE_SECONDS = 3
export const SCAN_DEDUPE_MINUTES = 30

export const METRIC_DEFINITIONS = {
  runs: 'Ad runs: every time your ad played on a tablet, in or out of a ride.',
  impressions: `Impressions: plays during an in-progress ride while the tablet screen was on and visible for at least ${MIN_VISIBLE_SECONDS} seconds.`,
  rides: 'Rides: distinct rides your ad ran in. Each ride counts once against your bundle.',
  scans: `QR scans: riders who scanned your ad's code, proof of foot traffic. Repeat scans from the same phone within ${SCAN_DEDUPE_MINUTES} minutes count once.`,
}

export const isShownImpression = (imp) => Boolean(imp?.trip_id) && imp?.visible === true && Number(imp?.seconds_shown) >= MIN_VISIBLE_SECONDS

/** Short, non-reversible-looking ride reference for partners (first 8 hex of the trip id). */
export const rideRef = (tripId) => (tripId ? `R-${String(tripId).replace(/-/g, '').slice(0, 8).toUpperCase()}` : '')

export function campaignMetrics({ campaign = {}, impressions = [], rideCounts = [], scans = [] } = {}) {
  const runs = impressions.length
  const shown = impressions.filter(isShownImpression).length
  const seconds = Math.round(impressions.reduce((s, i) => s + (Number(i.seconds_shown) || 0), 0))
  const unique = scans.filter((s) => !s.duplicate)
  const scansByTrip = new Map()
  for (const s of unique) if (s.trip_id) scansByTrip.set(s.trip_id, (scansByTrip.get(s.trip_id) || 0) + 1)
  const seen = new Set()
  const rideList = []
  for (const r of [...rideCounts].sort((a, b) => String(b.counted_at).localeCompare(String(a.counted_at)))) {
    if (!r?.trip_id || seen.has(r.trip_id)) continue
    seen.add(r.trip_id)
    rideList.push({ ref: rideRef(r.trip_id), at: r.counted_at || null, scans: scansByTrip.get(r.trip_id) || 0 })
  }
  const rides = rideList.length
  const purchased = campaign.rides_purchased == null ? null : Number(campaign.rides_purchased)
  return {
    runs,
    impressions: shown,
    rides,
    scans: unique.length,
    scansTotal: scans.length,
    scanRate: rides ? Math.round((unique.length / rides) * 1000) / 10 : 0,
    seconds,
    ridesPurchased: purchased,
    ridesRemaining: purchased == null ? null : Math.max(0, purchased - Number(campaign.rides_served ?? rides)),
    rideList,
  }
}

export function sumMetrics(list = []) {
  const out = { runs: 0, impressions: 0, rides: 0, scans: 0 }
  for (const m of list) for (const k of Object.keys(out)) out[k] += Number(m?.[k]) || 0
  out.scanRate = out.rides ? Math.round((out.scans / out.rides) * 1000) / 10 : 0
  return out
}

const csvCell = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function formatEt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)} ET`
}

/** CSV of every ride the ad ran in. */
export function ridesCsv(campaignName, rideList = []) {
  const lines = [['campaign', 'ride', 'time_et', 'qr_scans'].join(',')]
  for (const r of rideList) lines.push([campaignName, r.ref, formatEt(r.at), r.scans].map(csvCell).join(','))
  return `${lines.join('\n')}\n`
}

/** Status chip a partner sees. */
export function campaignChip(c = {}) {
  const creatives = c.ad_creatives || []
  const approved = creatives.some((x) => x.approval_status === 'approved')
  const inReview = creatives.some((x) => x.approval_status === 'pending_review')
  if (c.status === 'draft') return { id: 'draft', label: 'Draft' }
  if (c.status === 'ended') return { id: 'completed', label: 'Completed' }
  if (c.status === 'paused') return { id: 'paused', label: 'Paused' }
  if (!approved && inReview) return { id: 'pending_review', label: 'Pending review' }
  if (c.status === 'pending_payment') return { id: 'pending_payment', label: 'Pending payment' }
  if (c.status === 'active') return approved ? { id: 'live', label: 'Live' } : { id: 'pending_review', label: 'Pending review' }
  return { id: c.status || 'draft', label: String(c.status || 'draft').replace(/_/g, ' ') }
}

/** Boost: double the remaining rides at the campaign's per-ride rate. */
export function boostQuote(c = {}) {
  const purchased = Number(c.rides_purchased)
  const remaining = Math.max(0, purchased - Number(c.rides_served || 0))
  const price = Number(c.price_cents)
  if (!(purchased > 0) || !remaining) return { ok: false, reason: 'No rides left to boost.' }
  if (!(price > 0)) return { ok: false, reason: 'This campaign has no per-ride price yet. Ask us for a quote.' }
  if (!['active', 'paused'].includes(c.status)) return { ok: false, reason: 'Only live or paused campaigns can be boosted.' }
  const perRide = price / purchased
  return { ok: true, ridesAdded: remaining, perRideCents: Math.round(perRide * 10000) / 10000, priceCents: Math.round(remaining * perRide) }
}

/**
 * Which creative converts best: QR scans per ride for each creative, best first.
 * rides = distinct rides the creative played in; scans = unique scans of that creative's codes.
 */
export function creativeRanking({ creatives = [], impressions = [], scans = [] } = {}) {
  const rows = new Map()
  const row = (id) => {
    if (!rows.has(id)) {
      const c = creatives.find((x) => x.id === id) || {}
      rows.set(id, { creativeId: id, campaignId: c.campaign_id || null, headline: c.headline || 'Untitled ad', kind: c.kind || null, trips: new Set(), scans: 0 })
    }
    return rows.get(id)
  }
  for (const c of creatives) if (c?.id) row(c.id)
  for (const i of impressions) if (i?.creative_id && i.trip_id) row(i.creative_id).trips.add(i.trip_id)
  for (const s of scans) if (s?.creative_id && !s.duplicate) row(s.creative_id).scans += 1
  return [...rows.values()]
    .map(({ trips, ...r }) => ({ ...r, rides: trips.size, scanRate: trips.size ? Math.round((r.scans / trips.size) * 1000) / 10 : 0 }))
    .sort((a, b) => b.scanRate - a.scanRate || b.scans - a.scans || b.rides - a.rides)
}
