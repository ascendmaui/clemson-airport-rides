/**
 * Driver profile photo review decisions.
 * A clear single face that matches the license on file is approved.
 * Every other outcome waits for an admin. The model never rejects.
 */

export const PROFILE_PHOTO_APPROVED_COPY = 'Approved'
export const PROFILE_PHOTO_CLOSER_LOOK_COPY = "We're taking a closer look — usually within a day."

export const PROFILE_PHOTO_ADMIN_FALLBACK_FLAG = 'DRIVER_PROFILE_PHOTO_ADMIN_FALLBACK'

const VERDICTS = ['approved', 'needs_admin', 'error', 'unavailable']

export function driverProfilePhotoMessage(reviewStatus) {
  return reviewStatus === 'approved' ? PROFILE_PHOTO_APPROVED_COPY : PROFILE_PHOTO_CLOSER_LOOK_COPY
}

export function adminFallbackEnabled(env = process.env) {
  const value = String(env?.[PROFILE_PHOTO_ADMIN_FALLBACK_FLAG] ?? '').trim().toLowerCase()
  if (!value) return true
  return !['0', 'off', 'false', 'no'].includes(value)
}

export function normalizeConfidence(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const scaled = n > 1 && n <= 100 ? n / 100 : n
  if (scaled < 0 || scaled > 1) return null
  return Math.round(scaled * 1000) / 1000
}

export function profilePhotoStoragePath(userId, storagePath) {
  const id = String(userId || '').trim()
  const path = String(storagePath || '').trim().replace(/^\/+/, '')
  if (!id || !path) return null
  if (path.includes('..') || path.includes('\\') || path.includes('//')) return null
  const prefix = `${id}/profile_photo/`
  if (!path.startsWith(prefix)) return null
  const rest = path.slice(prefix.length)
  if (!rest || rest.includes('/')) return null
  return path
}

function clip(value, max = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.slice(0, max)
}

function asFlag(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function reasonFor({ blurry, dark, faceCount, match }) {
  if (blurry) return 'The profile photo is blurry.'
  if (dark) return 'The profile photo is too dark.'
  if (faceCount !== 1) return 'The profile photo does not show exactly one face.'
  if (!match) return 'The profile photo does not match the face on the license.'
  return 'The profile photo needs an admin to look at it.'
}

function pending({ aiVerdict, aiConfidence, aiReason, reviewStatus = 'pending_admin_review', notifyAdmin = true }) {
  return {
    reviewStatus,
    aiVerdict,
    aiConfidence,
    aiReason: clip(aiReason) || 'The profile photo needs an admin to look at it.',
    driverMessage: PROFILE_PHOTO_CLOSER_LOOK_COPY,
    notifyAdmin,
  }
}

/**
 * @param {Record<string, unknown>} signals
 * @param {{ fallbackEnabled?: boolean }} [options]
 */
export function verdictFromSignals(signals, options = {}) {
  const fallbackEnabled = options.fallbackEnabled !== false
  if (signals?.error === true) {
    return pending({
      aiVerdict: 'error',
      aiConfidence: null,
      aiReason: clip(signals.reason) || 'AI review failed.',
    })
  }
  if (signals?.missingLicense === true) {
    return pending({
      aiVerdict: 'needs_admin',
      aiConfidence: null,
      aiReason: clip(signals.reason) || 'No driver license image is on file.',
    })
  }
  if (signals?.unavailable === true) {
    if (!fallbackEnabled) {
      return pending({
        reviewStatus: 'pending_manual_review',
        aiVerdict: 'unavailable',
        aiConfidence: null,
        aiReason: 'Vision review is not configured.',
        notifyAdmin: false,
      })
    }
    return pending({
      aiVerdict: 'unavailable',
      aiConfidence: null,
      aiReason: clip(signals.reason) || 'Vision review is not configured. Sent to admin review.',
    })
  }

  const blurry = asFlag(signals?.blurry)
  const dark = asFlag(signals?.dark)
  const faceCount = Number(signals?.faceCount)
  const oneFace = faceCount === 1
  const match = asFlag(signals?.matchesLicense)
  const clear = asFlag(signals?.clear) && !blurry && !dark && oneFace
  const confidence = normalizeConfidence(signals?.confidence)
  const modelReason = clip(signals?.reason)

  if (clear && match) {
    return {
      reviewStatus: 'approved',
      aiVerdict: 'approved',
      aiConfidence: confidence,
      aiReason: modelReason || 'Clear photo of one face that matches the license on file.',
      driverMessage: PROFILE_PHOTO_APPROVED_COPY,
      notifyAdmin: false,
    }
  }

  return pending({
    aiVerdict: 'needs_admin',
    aiConfidence: confidence,
    aiReason: modelReason || reasonFor({ blurry, dark, faceCount, match }),
  })
}

/**
 * Face-match result written onto the license_front row's match_status.
 * 'matched' is the value already used for a successful document match.
 */
export function licenseMatchStatus(signals, reviewStatus) {
  if (reviewStatus === 'approved') return 'matched'
  if (signals?.missingLicense || signals?.unavailable || signals?.error) return 'needs_review'
  const blurry = asFlag(signals?.blurry)
  const dark = asFlag(signals?.dark)
  const oneFace = Number(signals?.faceCount) === 1
  const match = asFlag(signals?.matchesLicense)
  if (!blurry && !dark && oneFace && !match) return 'mismatch'
  return 'needs_review'
}

export function isStoredVerdict(value) {
  return VERDICTS.includes(value)
}
