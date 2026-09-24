/**
 * License images are quality-checked, then always left for manual review.
 * A passing check never marks the license approved.
 * Registration text is matched against the vehicle the driver already entered.
 */

export const LICENSE_REVIEW_STATUS = 'pending_manual_review'

const LICENSE_KEYWORDS = ['license', 'driver', 'dob', 'exp', 'class', 'dl']

export function reviewLicenseImage({
  mimeType,
  size,
  width,
  height,
  text,
} = {}) {
  const mime = String(mimeType || '').toLowerCase()
  const hasSize = size != null && size !== ''
  const bytes = Number(size) || 0
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (!mime.startsWith('image/')) {
    return fail('Upload a photo of the license. PDF and other files are not accepted for the license.')
  }
  if (hasSize && bytes < 12_000) {
    return fail('That image is too small or looks blank. Retake the photo so the full license fills the frame.')
  }
  if (hasSize && bytes > 8 * 1024 * 1024) {
    return fail('Each photo must be 8MB or smaller.')
  }
  if (w && h && (w < 480 || h < 320)) {
    return fail('That photo is too small to read. Move closer so the license is sharp.')
  }
  if (w && h && (w / h > 4 || h / w > 4)) {
    return fail('Frame the whole license. This photo is too narrow to be a license.')
  }
  const extracted = String(text || '').trim()
  if (extracted) {
    const hay = extracted.toLowerCase()
    const hits = LICENSE_KEYWORDS.filter((word) => hay.includes(word))
    if (hits.length < 2) {
      return fail('This photo does not look like a driver license. Include the full card with the license wording visible.')
    }
  }
  const sideNote = 'Received. Pending manual review. This upload is not approved.'
  return {
    ok: true,
    approved: false,
    reviewStatus: LICENSE_REVIEW_STATUS,
    message: sideNote,
  }
}

export function licensePendingCopy(docType) {
  if (docType === 'license_back') return 'License back received. It is pending manual review.'
  return 'License front received. It is pending manual review.'
}

const MAKE_ALIASES = {
  chevy: 'chevrolet',
  chevrolet: 'chevrolet',
  vw: 'volkswagen',
  volkswagon: 'volkswagen',
  volkswagen: 'volkswagen',
  mercedes: 'mercedesbenz',
  'mercedes-benz': 'mercedesbenz',
  benz: 'mercedesbenz',
  bmw: 'bmw',
}

function colorAliases(color) {
  const key = fold(color)
  if (!key) return []
  if (key === 'gray' || key === 'grey') return ['gray', 'grey']
  return [key]
}

function fold(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function canonicalMake(value) {
  const folded = fold(value)
  return MAKE_ALIASES[folded] || MAKE_ALIASES[String(value || '').toLowerCase().trim()] || folded
}

function bytesToLatin1(input) {
  if (typeof input === 'string') return input
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  let out = ''
  const size = 4096
  for (let i = 0; i < bytes.length; i += size) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + size))
    out += String.fromCharCode.apply(null, slice)
  }
  return out
}

export function extractReadableText(input) {
  if (input == null) return ''
  const raw = bytesToLatin1(input)
  const runs = raw.match(/[A-Za-z0-9][A-Za-z0-9 .,#\-/]{3,}/g) || []
  return runs.join(' ').replace(/\s+/g, ' ').trim()
}

export function matchRegistration({ text, make, model, color, plate } = {}) {
  const readable = String(text || '').trim()
  if (readable.length < 8) {
    return {
      status: 'unreadable',
      matched: false,
      reviewStatus: 'needs_review',
      message: 'We could not read the registration. Upload a clearer photo or the PDF, or correct the vehicle details and try again.',
    }
  }
  const hay = fold(readable)
  const misses = []
  const makeKey = canonicalMake(make)
  if (make && makeKey !== 'other' && !hay.includes(makeKey) && !hay.includes(fold(make))) {
    misses.push('make')
  }
  const modelKey = fold(model)
  if (model && modelKey && modelKey !== 'other' && !hay.includes(modelKey)) {
    misses.push('model')
  }
  const colorKeys = colorAliases(color)
  if (color && colorKeys.length && !colorKeys.some((key) => key === 'other' || hay.includes(key))) {
    misses.push('color')
  }
  const plateKey = fold(plate)
  if (plateKey && !hay.includes(plateKey)) {
    misses.push('plate')
  }
  if (misses.length) {
    return {
      status: 'mismatch',
      matched: false,
      misses,
      reviewStatus: 'needs_review',
      message: `Registration does not match the ${misses.join(', ')} on your application. Re-upload the registration or correct those vehicle details.`,
    }
  }
  return {
    status: 'matched',
    matched: true,
    reviewStatus: 'matched',
    message: 'Registration matches the vehicle on your application. An admin still approves the driver account.',
  }
}

function fail(message) {
  return { ok: false, approved: false, reviewStatus: null, message }
}
