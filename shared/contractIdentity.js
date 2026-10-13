/**
 * Compares the name on a signed contractor agreement with the applicant
 * an admin is reviewing. Formatting differences are the same person.
 * A genuinely different name is reported, and approval can still continue
 * after the admin confirms.
 */

const INVISIBLE = /[\u200B-\u200D\uFEFF\u2060]/g
const COMBINING_MARKS = /[\u0300-\u036f]/g

const CONFUSABLES = new Map([
  ['\u0430', 'a'],
  ['\u0435', 'e'],
  ['\u043e', 'o'],
  ['\u0440', 'p'],
  ['\u0441', 'c'],
  ['\u0443', 'y'],
  ['\u0445', 'x'],
  ['\u0456', 'i'],
  ['\u0455', 's'],
  ['\u0410', 'A'],
  ['\u0415', 'E'],
  ['\u041e', 'O'],
  ['\u0420', 'P'],
  ['\u0421', 'C'],
  ['\u0423', 'Y'],
  ['\u0425', 'X'],
  ['\u0406', 'I'],
])

function foldConfusables(value) {
  let out = ''
  for (const char of value) out += CONFUSABLES.get(char) || char
  return out
}

export function displayPersonName(value) {
  return String(value ?? '')
    .replace(INVISIBLE, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizePersonName(value) {
  const shown = displayPersonName(value)
  const comma = shown.indexOf(',')
  const ordered = comma === -1
    ? shown
    : `${shown.slice(comma + 1)} ${shown.slice(0, comma)}`
  return foldConfusables(ordered)
    .normalize('NFKC')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[’‘ʼ`´]/g, "'")
    .replace(/[‐‑‒–—―]/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokensOf(value) {
  const normalized = normalizePersonName(value)
  if (!normalized) return []
  return normalized.split(' ').filter((token) => token && token !== '-')
}

function significantTokens(tokens) {
  const words = tokens.filter((token) => token.replace(/[^a-z]/g, '').length > 1)
  return words.length ? words : tokens
}

export function personNamesMatch(left, right) {
  const a = significantTokens(tokensOf(left))
  const b = significantTokens(tokensOf(right))
  if (!a.length || !b.length) return false
  if (a.join(' ') === b.join(' ')) return true
  if (a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1]) return true
  if (a.length === 1 && b.includes(a[0])) return true
  if (b.length === 1 && a.includes(b[0])) return true
  return false
}

function presentNames(values) {
  const seen = new Set()
  const names = []
  for (const value of values) {
    const shown = displayPersonName(value)
    if (!shown || shown.toLowerCase() === 'not provided' || seen.has(shown)) continue
    seen.add(shown)
    names.push(shown)
  }
  return names
}

function fullest(names) {
  return [...names].sort((a, b) => tokensOf(b).length - tokensOf(a).length || b.length - a.length)[0] || ''
}

function isFullName(value) {
  return significantTokens(tokensOf(value)).length >= 2
}

export function assessContractIdentity({
  signatureName,
  contractLegalName,
  applicantName,
  applicantLegalName,
} = {}) {
  const contractNames = presentNames([signatureName, contractLegalName])
  const applicantNames = presentNames([applicantName, applicantLegalName])
  const contractName = fullest(contractNames)
  const shownApplicant = fullest(applicantNames)
  if (!contractNames.length || !applicantNames.length) {
    return { status: 'unknown', contractName, applicantName: shownApplicant }
  }

  const fullContractNames = contractNames.filter(isFullName)
  const compared = fullContractNames.length ? fullContractNames : contractNames
  const matched = compared.some((name) => applicantNames.some((applicant) => personNamesMatch(name, applicant)))
  if (matched) return { status: 'match', contractName, applicantName: shownApplicant }
  return {
    status: 'mismatch',
    contractName: fullest(compared),
    applicantName: shownApplicant,
  }
}

export function contractMismatchCopy(contractName, applicantName) {
  return `Signed contract is for driver '${contractName}' but you are viewing applicant '${applicantName}'. Please check the contract again.`
}

export function contractApprovalDenial({ agreementSigned, identity, acknowledged } = {}) {
  const status = identity?.status
  switch (status) {
    case 'match':
    case 'unknown':
    case undefined:
      return null
    case 'mismatch':
      if (!agreementSigned || acknowledged === true) return null
      return {
        status: 400,
        body: {
          error: contractMismatchCopy(identity.contractName, identity.applicantName),
          code: 'contract_name_mismatch',
        },
      }
    default: {
      const unexpected = status
      throw new Error(`Unknown contract identity: ${unexpected}`)
    }
  }
}

/** Same-person and confirmed-mismatch reviews are not missing a signature. */
export function blockersIgnoringContractIdentity(blockers, identity, agreementSigned) {
  const list = Array.isArray(blockers) ? blockers : []
  if (!agreementSigned) return list
  if (identity?.status !== 'match' && identity?.status !== 'mismatch') return list
  return list.filter((code) => code !== 'ic_agreement')
}

export function pickAgreementRow(rows, currentVersion) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : []
  const currentSigned = list.find((row) => row.agreement_version === currentVersion && row.signed_at && row.signature_name)
  if (currentSigned) return currentSigned
  const signed = list
    .filter((row) => row.signed_at && row.signature_name)
    .sort((a, b) => String(b.signed_at || '').localeCompare(String(a.signed_at || '')))
  if (signed[0]) return signed[0]
  return list.find((row) => row.agreement_version === currentVersion) || null
}
