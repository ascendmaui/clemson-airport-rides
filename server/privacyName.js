import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * First name only. Prefer displayFirstName from src/lib/privacyDisplay.js
 * once that module is on main; otherwise split a display name locally.
 * Peer last names never go to Help/Support prompts, chat text, or tickets.
 */
export function fallbackDisplayFirstName(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (raw.includes('@')) {
    const local = raw.split('@')[0].trim()
    return local.split(/[.\s_-]+/).filter(Boolean)[0] || ''
  }
  if (raw.includes(',')) {
    const pieces = raw.split(',').map((part) => part.trim()).filter(Boolean)
    if (pieces.length >= 2) return pieces[1].split(/\s+/)[0] || ''
  }
  return raw.split(/\s+/).filter(Boolean)[0] || ''
}

let displayFirstNameFn = fallbackDisplayFirstName
let primed = false

export async function primeDisplayFirstName() {
  if (primed) return displayFirstNameFn
  primed = true
  const fileUrl = new URL('../src/lib/privacyDisplay.js', import.meta.url)
  if (!existsSync(fileUrl)) return displayFirstNameFn
  try {
    const mod = await import(pathToFileURL(fileUrl.pathname).href)
    if (typeof mod.displayFirstName === 'function') displayFirstNameFn = mod.displayFirstName
  } catch {
    displayFirstNameFn = fallbackDisplayFirstName
  }
  return displayFirstNameFn
}

export function displayFirstName(value) {
  try {
    const result = displayFirstNameFn(value)
    if (typeof result === 'string') return result.trim()
    if (result == null) return ''
    return String(result).trim()
  } catch {
    return fallbackDisplayFirstName(value)
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tokens(value) {
  return String(value || '').split(/\s+/).map((part) => part.trim()).filter(Boolean)
}

/** Full-name spellings plus leftover surname tokens for one peer. */
function peerSpellings(full) {
  const source = String(full || '').trim()
  const first = displayFirstName(source)
  if (!source || !first || source.toLowerCase() === first.toLowerCase()) {
    return { first: first || '', phrases: [], surnames: [] }
  }
  const phrases = new Set([source])
  const surnames = new Set()
  if (source.includes(',')) {
    const [left, right] = source.split(',').map((part) => part.trim())
    const lastTokens = tokens(left)
    const given = tokens(right)
    if (given[0] && lastTokens.length) {
      phrases.add(`${given[0]} ${lastTokens.join(' ')}`)
      phrases.add(`${lastTokens.join(' ')}, ${given[0]}`)
    }
    lastTokens.forEach((part) => surnames.add(part))
    given.slice(1).forEach((part) => surnames.add(part))
  } else {
    const parts = tokens(source)
    if (parts.length >= 2) {
      phrases.add(`${parts[parts.length - 1]}, ${parts[0]}`)
      parts.slice(1).forEach((part) => surnames.add(part))
    }
  }
  const firstKey = first.toLowerCase()
  return {
    first,
    phrases: [...phrases],
    surnames: [...surnames].filter((part) => part.length >= 2 && part.toLowerCase() !== firstKey),
  }
}

/** Replace known peer names with the first name only. */
export function redactPeerText(text, context) {
  const names = Array.isArray(context?._peerFullNames) ? context._peerFullNames : []
  let out = String(text ?? '')
  const spellings = names.map(peerSpellings).filter((item) => item.first)
  const phrases = spellings
    .flatMap((item) => item.phrases.map((phrase) => ({ phrase, first: item.first })))
    .sort((a, b) => b.phrase.length - a.phrase.length)
  for (const { phrase, first } of phrases) {
    out = out.replace(new RegExp(escapeRegExp(phrase), 'gi'), first)
  }
  for (const { first, surnames } of spellings) {
    for (const surname of surnames) {
      out = out.replace(new RegExp(`\\b${escapeRegExp(surname)}\\b`, 'gi'), first)
    }
  }
  return out
}

export function scrubMessages(messages, context) {
  return (messages || []).map((message) => ({
    ...message,
    content: redactPeerText(message.content, context),
  }))
}
