/**
 * Driver safety score: an ESTIMATE from phone GPS, not a driving record.
 * Inputs: GPS speed deltas (hard braking), speeding share, SOS events on the
 * driver's trips, low rider ratings, and driver cancellations.
 * It never affects dispatch unless config.affectsDispatch is true.
 */
export const DEFAULT_SAFETY_CONFIG = { enabled: true, affectsDispatch: false, windowDays: 30, hardBrakeMps2: 3.4, maxGapSeconds: 10, speedingMps: 31.3 }

export function normalizeSafetyConfig(raw) {
  const c = { ...DEFAULT_SAFETY_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) }
  return { ...c, enabled: c.enabled !== false, affectsDispatch: c.affectsDispatch === true }
}

/** Hard-brake count and speeding share from samples grouped per trip. */
export function gpsSignals(samples, rawConfig) {
  const c = normalizeSafetyConfig(rawConfig)
  const byTrip = new Map()
  for (const s of samples || []) {
    const at = Date.parse(s.recorded_at)
    const v = Number(s.speed_mps)
    if (!Number.isFinite(at) || !Number.isFinite(v) || v < 0 || v > 70) continue
    if (!byTrip.has(s.trip_id)) byTrip.set(s.trip_id, [])
    byTrip.get(s.trip_id).push({ at, v })
  }
  let hardBrakes = 0
  let pairs = 0
  let speeding = 0
  let total = 0
  let movingSeconds = 0
  for (const list of byTrip.values()) {
    list.sort((a, b) => a.at - b.at)
    for (let i = 0; i < list.length; i += 1) {
      total += 1
      if (list[i].v > c.speedingMps) speeding += 1
      if (i === 0) continue
      const dt = (list[i].at - list[i - 1].at) / 1000
      if (dt <= 0 || dt > c.maxGapSeconds) continue
      pairs += 1
      movingSeconds += dt
      if ((list[i - 1].v - list[i].v) / dt >= c.hardBrakeMps2) hardBrakes += 1
    }
  }
  return { samples: total, pairs, hardBrakes, hardBrakesPerHour: movingSeconds > 0 ? hardBrakes / (movingSeconds / 3600) : 0, speedingShare: total ? speeding / total : 0, hasGps: pairs >= 20 }
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

/**
 * Score 0-100 (higher is safer) with per-factor penalties and tips.
 * counts: { trips, sos, lowRatings, ratings, driverCancels, accepted }
 */
export function safetyScore({ gps, counts }, rawConfig) {
  const c = normalizeSafetyConfig(rawConfig)
  const g = gps || { hasGps: false, hardBrakesPerHour: 0, speedingShare: 0 }
  const k = counts || {}
  const factors = []
  if (g.hasGps) {
    factors.push({ key: 'braking', penalty: clamp(g.hardBrakesPerHour * 4, 0, 25), detail: `${g.hardBrakes} hard stops` })
    factors.push({ key: 'speeding', penalty: clamp(g.speedingShare * 100, 0, 25), detail: `${Math.round(g.speedingShare * 100)}% of GPS points over ${Math.round(c.speedingMps * 2.237)} mph` })
  }
  factors.push({ key: 'sos', penalty: clamp((Number(k.sos) || 0) * 5, 0, 15), detail: `${k.sos || 0} SOS on your trips` })
  const lowShare = k.ratings ? (Number(k.lowRatings) || 0) / k.ratings : 0
  factors.push({ key: 'ratings', penalty: clamp(lowShare * 60, 0, 20), detail: `${k.lowRatings || 0} of ${k.ratings || 0} ratings at 2 stars or less` })
  const cancelShare = k.accepted ? (Number(k.driverCancels) || 0) / k.accepted : 0
  factors.push({ key: 'cancels', penalty: clamp(cancelShare * 50, 0, 15), detail: `${k.driverCancels || 0} driver cancels` })
  const score = Math.round(clamp(100 - factors.reduce((s, f) => s + f.penalty, 0), 0, 100))
  return {
    enabled: c.enabled,
    estimate: true,
    label: 'Estimate',
    score,
    hasGps: g.hasGps,
    affectsDispatch: c.affectsDispatch,
    factors: factors.map((f) => ({ ...f, penalty: Math.round(f.penalty * 10) / 10 })),
    tips: safetyTips(factors, g),
  }
}

const TIPS = {
  braking: 'Leave more following distance so you can slow down gradually.',
  speeding: 'Keep to posted limits, especially on US-123 and I-85 airport runs.',
  sos: 'Review the Safety page so you and riders know when SOS is the right call.',
  ratings: 'Smooth turns and steady speed tend to raise rider ratings.',
  cancels: 'Accept only trips you can finish; cancellations lower your score.',
}

export function safetyTips(factors, gps) {
  const tips = [...factors].filter((f) => f.penalty > 0).sort((a, b) => b.penalty - a.penalty).slice(0, 3).map((f) => TIPS[f.key])
  if (!gps?.hasGps) tips.push('Keep location on during trips so braking and speed can be estimated.')
  if (!tips.length) tips.push('Nice work. Keep it smooth and steady.')
  return tips
}

/** Dispatch effect only when an admin turns it on: a small negative boost below 70. */
export function safetyDispatchBoost(result, rawConfig) {
  const c = normalizeSafetyConfig(rawConfig)
  if (!c.affectsDispatch || !result || typeof result.score !== 'number') return 0
  return result.score < 70 ? -1 : 0
}
