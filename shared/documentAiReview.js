/**
 * Driver document review for license, insurance, registration, and inspection.
 * The vision model only extracts fields. Confidence is scored here.
 * The model never rejects a document.
 */

export const AUTO_APPROVE_CONFIDENCE = 0.85

/** Weights sum to 1. Checks that do not apply to a document are left out and the rest are rescaled. */
export const SCORE_WEIGHTS = Object.freeze({
  requiredFields: 0.16,
  vin: 0.10,
  plateFormat: 0.10,
  expiry: 0.10,
  nameMatch: 0.16,
  vehicleAgreement: 0.16,
  legibility: 0.16,
  twoPass: 0.06,
})

export const AI_DOCUMENT_TYPES = Object.freeze([
  'license_front',
  'license_back',
  'insurance_front',
  'insurance_back',
  'registration',
  'inspection_front',
  'inspection_back',
  'inspection_left',
  'inspection_right',
  'inspection_interior',
  'inspection_form',
])

const ATTENTION_DOCS = Object.freeze([
  { id: 'license_front', label: 'Driver license — front', family: 'license' },
  { id: 'license_back', label: 'Driver license — back', family: 'license' },
  { id: 'insurance_front', label: 'Insurance card — front', family: 'insurance' },
  { id: 'insurance_back', label: 'Insurance card — back', family: 'insurance' },
  { id: 'registration', label: 'Car registration', family: 'registration' },
  { id: 'inspection_front', label: 'Inspection — front', family: 'inspection' },
  { id: 'inspection_back', label: 'Inspection — back', family: 'inspection' },
  { id: 'inspection_left', label: 'Inspection — left side', family: 'inspection' },
  { id: 'inspection_right', label: 'Inspection — right side', family: 'inspection' },
  { id: 'inspection_interior', label: 'Inspection — interior', family: 'inspection', optional: true },
  { id: 'inspection_form', label: 'Inspection form', family: 'inspection' },
])

const FAMILY_LABEL = {
  license: 'driver license',
  insurance: 'insurance card',
  registration: 'registration',
  inspection: 'inspection',
}

const VIN_VALUE = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
}

const VIN_WEIGHTS = Object.freeze([8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2])

const NAME_SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V'])

const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
}

const STATES = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
  HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
  KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO',
  MONTANA: 'MT', NEBRASKKA: 'NE', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN',
  TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC',
}

const STATE_CODES = new Set(Object.values(STATES))

const REQUIRED_FIELDS = {
  license_front: ['name', 'expiry', 'state', 'documentType'],
  license_back: ['documentType'],
  insurance_front: ['name', 'expiry', 'plate', 'state', 'documentType'],
  insurance_back: ['documentType'],
  registration: ['name', 'expiry', 'plate', 'vin', 'state', 'documentType'],
  inspection_form: ['name', 'expiry', 'documentType', 'plateOrVin'],
  inspection_front: ['documentType'],
  inspection_back: ['documentType'],
  inspection_left: ['documentType'],
  inspection_right: ['documentType'],
  inspection_interior: ['documentType'],
}

export function isAiReviewedDocument(docType) {
  return AI_DOCUMENT_TYPES.includes(String(docType || ''))
}

export function documentFamily(docType) {
  const type = String(docType || '')
  if (type.startsWith('license')) return 'license'
  if (type.startsWith('insurance')) return 'insurance'
  if (type === 'registration') return 'registration'
  if (type.startsWith('inspection')) return 'inspection'
  return ''
}

export function canonicalDocumentFamily(value) {
  const text = String(value || '').toLowerCase()
  if (!text.trim()) return ''
  if (/inspect/.test(text)) return 'inspection'
  if (/insur/.test(text)) return 'insurance'
  if (/regist/.test(text)) return 'registration'
  if (/licen[sc]e|\bdl\b/.test(text)) return 'license'
  return ''
}

export function normalizeVin(value) {
  return String(value || '').toUpperCase().replace(/[\s-]/g, '')
}

/**
 * ISO 3779 check digit. Position 9 (index 8) is the check character.
 * Letters I, O, and Q are not used. A remainder of 10 is written as X.
 */
export function vinCheckDigit(value) {
  const vin = normalizeVin(value)
  if (vin.length !== 17) return { ok: false, normalized: vin, reason: 'length' }
  if (/[IOQ]/.test(vin)) return { ok: false, normalized: vin, reason: 'forbidden-letter' }
  let sum = 0
  for (let index = 0; index < 17; index += 1) {
    const char = vin[index]
    const digit = char >= '0' && char <= '9' ? Number(char) : VIN_VALUE[char]
    if (digit == null) return { ok: false, normalized: vin, reason: 'character' }
    sum += digit * VIN_WEIGHTS[index]
  }
  const remainder = sum % 11
  const expected = remainder === 10 ? 'X' : String(remainder)
  const ok = vin[8] === expected
  return { ok, normalized: vin, expected, actual: vin[8], reason: ok ? '' : 'check-digit' }
}

export function normalizePlate(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function plateFormatOk(value) {
  return /^[A-Z0-9]{2,8}$/.test(normalizePlate(value))
}

export function normalizeState(value) {
  const text = String(value || '').toUpperCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (STATE_CODES.has(text)) return text
  return STATES[text] || ''
}

export function nameTokens(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !NAME_SUFFIXES.has(token))
}

function levenshtein(left, right) {
  const rows = left.length + 1
  const cols = right.length + 1
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let row = 0; row < rows; row += 1) grid[row][0] = row
  for (let col = 0; col < cols; col += 1) grid[0][col] = col
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1
      grid[row][col] = Math.min(
        grid[row - 1][col] + 1,
        grid[row][col - 1] + 1,
        grid[row - 1][col - 1] + cost,
      )
    }
  }
  return grid[left.length][right.length]
}

/** 1 when the names are the same person after normalizing case, punctuation, and suffixes. */
export function nameSimilarity(left, right) {
  const a = nameTokens(left)
  const b = nameTokens(right)
  if (!a.length || !b.length) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  const shorter = setA.size <= setB.size ? setA : setB
  const longer = setA.size <= setB.size ? setB : setA
  let subset = true
  for (const token of shorter) {
    if (!longer.has(token)) subset = false
  }
  if (subset && (shorter.size >= 2 || shorter.size === longer.size)) return 1
  const joinedA = [...setA].sort().join(' ')
  const joinedB = [...setB].sort().join(' ')
  const max = Math.max(joinedA.length, joinedB.length)
  if (!max) return 0
  const similarity = 1 - (levenshtein(joinedA, joinedB) / max)
  return Math.round(similarity * 1000) / 1000
}

export function namesMatch(left, right) {
  return nameSimilarity(left, right) >= 0.85
}

function lastDay(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Calendar date is valid through the end of the expiration day (UTC). */
export function parseExpiry(value, now = new Date()) {
  const text = String(value || '').trim()
  if (!text) return null
  let year = 0
  let month = 0
  let day = 0
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (match) {
    year = Number(match[1])
    month = Number(match[2])
    day = Number(match[3])
  } else if ((match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/))) {
    month = Number(match[1])
    day = Number(match[2])
    year = Number(match[3])
    if (year < 100) year += 2000
  } else if ((match = text.match(/^(\d{1,2})[/-](\d{4})$/))) {
    month = Number(match[1])
    year = Number(match[2])
    day = lastDay(year, month)
  } else if ((match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/))) {
    month = MONTHS[match[1].toLowerCase()] || 0
    day = Number(match[2])
    year = Number(match[3])
  } else if ((match = text.match(/^([A-Za-z]+)\s+(\d{4})$/))) {
    month = MONTHS[match[1].toLowerCase()] || 0
    year = Number(match[2])
    day = month ? lastDay(year, month) : 0
  } else {
    return null
  }
  if (month < 1 || month > 12 || year < 1990 || year > 2100) return null
  const maxDay = lastDay(year, month)
  if (day < 1 || day > maxDay) return null
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const expiryDay = Date.UTC(year, month - 1, day)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const expired = expiryDay < today
  return { iso, expired, future: !expired }
}

export function asLegible(value) {
  return value === true || value === 'yes' || value === 'y' || value === 1 || value === '1' || value === 'true'
}

export function isBlurryImage({ byteLength, width, height } = {}) {
  const bytes = Number(byteLength) || 0
  if (bytes > 0 && bytes < 12_000) return true
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (w && h && (w < 480 || h < 320)) return true
  if (w && h && (w / h > 4 || h / w > 4)) return true
  return false
}

function clip(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function textOf(value) {
  return String(value || '').trim()
}

export function normalizeModelExtraction(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const expiryRaw = source.expiryDate ?? source.expiry ?? source.expiration ?? source.expirationDate
  const parsed = parseExpiry(expiryRaw)
  return {
    name: textOf(source.name ?? source.fullName),
    expiryDate: parsed?.iso || textOf(expiryRaw),
    expiry: parsed,
    plate: textOf(source.plate ?? source.licensePlate ?? source.plateNumber),
    vin: textOf(source.vin ?? source.VIN),
    state: textOf(source.state ?? source.issuingState),
    documentType: textOf(source.documentType ?? source.document_type ?? source.type),
    legible: asLegible(source.legible ?? source.legibility),
  }
}

function comparable(extraction) {
  return {
    name: textOf(extraction.name).toLowerCase(),
    expiry: extraction.expiry?.iso || '',
    plate: normalizePlate(extraction.plate),
    vin: normalizeVin(extraction.vin),
    state: normalizeState(extraction.state),
    documentType: canonicalDocumentFamily(extraction.documentType),
    legible: extraction.legible ? 'yes' : 'no',
  }
}

function mergePasses(passA, passB) {
  const left = normalizeModelExtraction(passA)
  const right = normalizeModelExtraction(passB)
  const a = comparable(left)
  const b = comparable(right)
  const keys = ['name', 'expiry', 'plate', 'vin', 'state', 'documentType', 'legible']
  let same = 0
  const agreed = {}
  for (const key of keys) {
    const match = a[key] === b[key]
    if (match) same += 1
    agreed[key] = match
  }
  const merged = {
    name: agreed.name ? left.name : '',
    expiryDate: agreed.expiry ? (left.expiry?.iso || '') : '',
    expiry: agreed.expiry ? left.expiry : null,
    plate: agreed.plate ? left.plate : '',
    vin: agreed.vin ? left.vin : '',
    state: agreed.state ? left.state : '',
    documentType: agreed.documentType ? left.documentType : '',
    legible: agreed.legible ? left.legible : false,
  }
  return { merged, agreement: same / keys.length, disagreed: keys.filter((key) => !agreed[key]) }
}

function fieldPresent(field, extraction, docType) {
  switch (field) {
    case 'name':
      return Boolean(textOf(extraction.name))
    case 'expiry':
      return Boolean(extraction.expiry)
    case 'plate':
      return plateFormatOk(extraction.plate)
    case 'vin':
      return vinCheckDigit(extraction.vin).ok
    case 'state':
      return Boolean(normalizeState(extraction.state))
    case 'documentType':
      return canonicalDocumentFamily(extraction.documentType) === documentFamily(docType)
    case 'plateOrVin':
      return plateFormatOk(extraction.plate) || vinCheckDigit(extraction.vin).ok
    default: {
      const unknown = field
      return unknown === 'name'
    }
  }
}

function familyPhrase(docType) {
  return FAMILY_LABEL[documentFamily(docType)] || 'document'
}

function platesDisagree(left, right) {
  const a = normalizePlate(left)
  const b = normalizePlate(right)
  return Boolean(a && b && a !== b)
}

function vinsDisagree(left, right) {
  const a = normalizeVin(left)
  const b = normalizeVin(right)
  return Boolean(a && b && a !== b)
}

/**
 * @param {{
 *   docType: string,
 *   passA?: Record<string, unknown>,
 *   passB?: Record<string, unknown>,
 *   profileName?: string,
 *   vehicle?: { plate?: string, vin?: string },
 *   sibling?: { plate?: string, vin?: string },
 *   byteLength?: number,
 *   width?: number,
 *   height?: number,
 *   now?: Date,
 * }} input
 */
export function scoreDocumentReview(input = {}) {
  const docType = String(input.docType || '')
  const { merged, agreement, disagreed } = mergePasses(input.passA, input.passB)
  const required = REQUIRED_FIELDS[docType] || ['documentType']
  const missing = required.filter((field) => !fieldPresent(field, merged, docType))
  const vinResult = textOf(merged.vin) ? vinCheckDigit(merged.vin) : null
  const profileName = textOf(input.profileName)
  const extractedName = textOf(merged.name)
  const similarity = profileName && extractedName ? nameSimilarity(extractedName, profileName) : 0
  const blurry = isBlurryImage(input)
  const vehicle = input.vehicle || {}
  const sibling = input.sibling || {}
  const hardRules = []
  const reasons = []

  if (merged.expiry?.expired) {
    hardRules.push('expired')
    reasons.push('This document is expired.')
  }
  if (extractedName && profileName && similarity < 0.85) {
    hardRules.push('name_mismatch')
    reasons.push('The name on this document does not match the name on your profile.')
  }
  if (vinResult && !vinResult.ok) {
    hardRules.push('vin_check_digit')
    reasons.push('The vehicle identification number on this document is not valid.')
  }
  if (platesDisagree(merged.plate, vehicle.plate)) {
    hardRules.push('plate_mismatch')
    reasons.push('The license plate does not match the plate on your vehicle.')
  }
  if (vinsDisagree(merged.vin, vehicle.vin)) {
    hardRules.push('vin_mismatch')
    reasons.push('The vehicle identification number does not match the one on your vehicle.')
  }
  if (platesDisagree(merged.plate, sibling.plate)) {
    if (!hardRules.includes('plate_mismatch')) hardRules.push('plate_mismatch')
    reasons.push('The license plate does not match your registration and insurance.')
  }
  if (vinsDisagree(merged.vin, sibling.vin)) {
    if (!hardRules.includes('vin_mismatch')) hardRules.push('vin_mismatch')
    reasons.push('The vehicle identification number does not match your registration and insurance.')
  }

  const expectsVin = docType === 'registration' || Boolean(textOf(merged.vin))
  const expectsPlate = ['registration', 'insurance_front', 'inspection_form'].includes(docType) || Boolean(textOf(merged.plate))
  const expectsExpiry = required.includes('expiry') || Boolean(merged.expiry || textOf(merged.expiryDate))
  const expectsName = required.includes('name') || Boolean(extractedName)
  const expectsVehicle = ['registration', 'insurance_front', 'inspection_form'].includes(docType)
    || Boolean(normalizePlate(merged.plate) || normalizeVin(merged.vin))

  const scores = {
    requiredFields: missing.length === 0 ? 1 : 0,
    vin: !expectsVin ? null : (vinResult?.ok ? 1 : 0),
    plateFormat: !expectsPlate ? null : (plateFormatOk(merged.plate) ? 1 : 0),
    expiry: !expectsExpiry ? null : (merged.expiry && !merged.expiry.expired ? 1 : 0),
    nameMatch: !expectsName ? null : (profileName && extractedName ? (similarity >= 0.85 ? 1 : similarity) : 0),
    vehicleAgreement: !expectsVehicle ? null : vehicleAgreementScore(merged, vehicle, sibling),
    legibility: merged.legible && !blurry ? 1 : 0,
    twoPass: agreement,
  }

  if (missing.includes('name')) reasons.push('The name could not be read.')
  if (missing.includes('expiry') && !merged.expiry?.expired) reasons.push('The expiration date could not be read.')
  if (missing.includes('plate')) reasons.push('The license plate could not be read.')
  if (missing.includes('vin') && !(vinResult && !vinResult.ok)) reasons.push('The vehicle identification number could not be read.')
  if (missing.includes('state')) reasons.push('The state could not be read.')
  if (missing.includes('documentType')) reasons.push(`This does not look like a ${familyPhrase(docType)}.`)
  if (missing.includes('plateOrVin')) reasons.push('The plate or vehicle identification number could not be read.')
  if (!merged.legible || blurry) reasons.push('This photo is hard to read. Take a closer, sharper picture.')
  if (agreement < 1) reasons.push('The document could not be read the same way twice.')
  if (expectsName && extractedName && !profileName) reasons.push('We do not have a name on your profile to compare.')
  if (expectsVehicle && plateFormatOk(merged.plate) && !normalizePlate(vehicle.plate) && !platesDisagree(merged.plate, sibling.plate)) {
    reasons.push('We do not have a license plate on your vehicle to compare.')
  }

  let weighted = 0
  let total = 0
  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
    const score = scores[key]
    if (score == null) continue
    weighted += score * weight
    total += weight
  }
  const confidence = total ? Math.round((weighted / total) * 1000) / 1000 : 0
  const uniqueReasons = []
  for (const reason of reasons) {
    if (reason && !uniqueReasons.includes(reason)) uniqueReasons.push(reason)
  }

  return {
    confidence,
    scores,
    hardRules,
    reasons: uniqueReasons,
    disagreed,
    extraction: {
      name: merged.name,
      expiryDate: merged.expiry?.iso || '',
      plate: normalizePlate(merged.plate),
      vin: normalizeVin(merged.vin),
      state: normalizeState(merged.state),
      documentType: canonicalDocumentFamily(merged.documentType),
      legible: merged.legible ? 'yes' : 'no',
    },
  }
}

function vehicleAgreementScore(extraction, vehicle, sibling) {
  const checks = []
  const plate = normalizePlate(extraction.plate)
  const vin = normalizeVin(extraction.vin)
  const vehiclePlate = normalizePlate(vehicle.plate)
  const vehicleVin = normalizeVin(vehicle.vin)
  const siblingPlate = normalizePlate(sibling.plate)
  const siblingVin = normalizeVin(sibling.vin)
  if (plate && vehiclePlate) checks.push(plate === vehiclePlate ? 1 : 0)
  else if (plate || vehiclePlate) checks.push(0)
  if (vin && vehicleVin) checks.push(vin === vehicleVin ? 1 : 0)
  else if (vin && !vehicleVin) checks.push(1)
  if (plate && siblingPlate) checks.push(plate === siblingPlate ? 1 : 0)
  if (vin && siblingVin) checks.push(vin === siblingVin ? 1 : 0)
  if (!checks.length) return 0
  return checks.reduce((sum, score) => sum + score, 0) / checks.length
}

function manualDecision({ aiVerdict, aiConfidence, reasons, reviewStatus, scored }) {
  const list = (reasons || []).filter(Boolean)
  if (!list.length) list.push('This document needs a person to look at it.')
  const aiReason = clip(list.join(' '))
  return {
    reviewStatus,
    aiVerdict,
    aiConfidence,
    aiReason,
    aiReasons: list.map((reason) => clip(reason, 240)),
    hardRules: scored?.hardRules || [],
    scores: scored?.scores || null,
    extraction: scored?.extraction || null,
    confidence: aiConfidence,
    driverMessage: list[0],
    notifyAdmin: true,
  }
}

/**
 * Auto-approve only at confidence >= 0.85 with no hard rule.
 * Hard rules: expired, name mismatch, bad VIN check digit, plate or VIN mismatch.
 */
export function decideDocumentReview(input = {}) {
  if (input.unavailable) {
    return manualDecision({
      reviewStatus: 'pending_manual_review',
      aiVerdict: 'unavailable',
      aiConfidence: null,
      reasons: ['This document is waiting for manual review.'],
    })
  }
  if (input.error) {
    return manualDecision({
      reviewStatus: 'pending_admin_review',
      aiVerdict: 'error',
      aiConfidence: null,
      reasons: [clip(input.reason) || 'We could not review this document automatically. It is waiting for manual review.'],
    })
  }
  const scored = scoreDocumentReview(input)
  const approved = scored.confidence >= AUTO_APPROVE_CONFIDENCE && scored.hardRules.length === 0
  if (approved) {
    const reason = 'The document matches your profile and is clear enough to approve.'
    return {
      reviewStatus: 'approved',
      aiVerdict: 'approved',
      aiConfidence: scored.confidence,
      aiReason: reason,
      aiReasons: [reason],
      hardRules: [],
      scores: scored.scores,
      extraction: scored.extraction,
      confidence: scored.confidence,
      driverMessage: 'Approved',
      notifyAdmin: false,
    }
  }
  return manualDecision({
    reviewStatus: 'pending_manual_review',
    aiVerdict: 'needs_admin',
    aiConfidence: scored.confidence,
    reasons: scored.reasons,
    scored,
  })
}

function attentionKind(row, uploaded) {
  const status = String(row?.review_status || '').trim()
  const match = String(row?.match_status || '').trim()
  if (!uploaded || status === 'rejected' || match === 'mismatch' || match === 'unreadable') return 'reupload'
  if (status === 'pending_manual_review') return 'manual'
  return 'pending'
}

function attentionReason(row, kind, label) {
  const aiReason = textOf(row?.ai_reason)
  if (aiReason) return aiReason
  const note = textOf(row?.review_note)
  if (note) return note
  if (kind === 'reupload' && !textOf(row?.storage_path)) return `Upload a photo of your ${label.toLowerCase()}.`
  if (kind === 'reupload') return 'Upload this again so we can review a clearer copy.'
  if (kind === 'manual') return 'Waiting for manual review.'
  return 'Waiting for review.'
}

/** Pending, manual-review, and re-upload documents, with a plain-language reason. */
export function documentAttentionItems(documents) {
  const indexed = new Map()
  for (const row of documents || []) {
    const type = String(row?.doc_type || row?.type || '').trim()
    if (type) indexed.set(type, row)
  }
  const items = []
  for (const spec of ATTENTION_DOCS) {
    const row = indexed.get(spec.id) || null
    const uploaded = Boolean(textOf(row?.storage_path))
    const status = String(row?.review_status || '').trim()
    if (uploaded && status === 'approved') continue
    if (!uploaded && spec.optional) continue
    const kind = attentionKind(row, uploaded)
    items.push({
      id: spec.id,
      label: spec.label,
      kind,
      reviewStatus: status || null,
      reason: attentionReason(row, kind, spec.label),
    })
  }
  return items
}

export function documentStoragePath(userId, docType, storagePath) {
  const id = String(userId || '').trim()
  const type = String(docType || '').trim()
  const path = String(storagePath || '').trim().replace(/^\/+/, '')
  if (!id || !isAiReviewedDocument(type) || !path) return null
  if (path.includes('..') || path.includes('\\') || path.includes('//')) return null
  if (!path.startsWith(`${id}/${type}/`)) return null
  const rest = path.slice(`${id}/${type}/`.length)
  if (!rest || rest.includes('/')) return null
  return path
}
