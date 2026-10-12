/** Driver referral rules. */
export const DEFAULT_REFERRAL_CONFIG = { enabled: true, targetTrips: 10, bonusCents: 5000, shareBaseUrl: 'https://clemsonrides.com/drive' }

export function normalizeReferralConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: c.enabled !== false,
    targetTrips: Math.max(1, Math.round(Number(c.targetTrips) || DEFAULT_REFERRAL_CONFIG.targetTrips)),
    bonusCents: Math.max(0, Math.round(Number(c.bonusCents ?? DEFAULT_REFERRAL_CONFIG.bonusCents) || 0)),
    shareBaseUrl: typeof c.shareBaseUrl === 'string' && /^https:\/\//.test(c.shareBaseUrl) ? c.shareBaseUrl : DEFAULT_REFERRAL_CONFIG.shareBaseUrl,
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** First-name prefix (up to 6 letters) + 4 random chars, e.g. JOHN7K2Q. */
export function makeReferralCode(firstName, random = Math.random) {
  const prefix = String(firstName || 'DRIVE').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'DRIVE'
  let tail = ''
  for (let i = 0; i < 4; i += 1) tail += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length]
  return prefix + tail
}

export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
}

export function shareLink(config, code) {
  return `${normalizeReferralConfig(config).shareBaseUrl}?ref=${encodeURIComponent(code)}`
}

/** Can this driver claim a code? */
export function claimDecision({ referee, referrerId, existingClaim, refereeCompletedTrips }) {
  if (!referrerId) return { ok: false, error: 'unknown_code' }
  if (referrerId === referee) return { ok: false, error: 'own_code' }
  if (existingClaim) return { ok: false, error: 'already_claimed' }
  if (refereeCompletedTrips > 0) return { ok: false, error: 'too_late' }
  return { ok: true }
}

/** Awards for referrals whose referee reached the trip target. */
export function referralAwards(referrals, completedByReferee, rawConfig) {
  const config = normalizeReferralConfig(rawConfig)
  if (!config.enabled || config.bonusCents <= 0) return []
  const out = []
  for (const r of referrals || []) {
    if (r.status === 'void') continue
    const done = Number(completedByReferee?.[r.referee_id]) || 0
    if (done >= config.targetTrips) {
      out.push({ referralId: r.id, referrerId: r.referrer_id, kind: 'referral', ref: `referee:${r.referee_id}`, amountCents: config.bonusCents, metadata: { refereeId: r.referee_id, trips: done } })
    }
  }
  return out
}

export function referralProgress(referrals, completedByReferee, rawConfig) {
  const config = normalizeReferralConfig(rawConfig)
  return (referrals || []).map((r) => ({
    status: r.status,
    trips: Math.min(config.targetTrips, Number(completedByReferee?.[r.referee_id]) || 0),
    target: config.targetTrips,
  }))
}
