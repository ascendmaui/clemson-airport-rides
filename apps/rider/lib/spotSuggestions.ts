/**
 * Live stop matches for the rider pickup and drop-off search.
 * Known Clemson spots, clusters, bars, campus landmarks, and airports come from
 * the catalog. Geocoder or places hits can be passed in and rank the same way.
 * Order is prefix, then word, then fuzzy. An empty query returns nothing.
 */
import { catalogStops } from '../../../src/lib/placeCatalog.js'

export type SpotCandidate = {
  id: string
  label: string
  lat: number
  lng: number
  aliases?: readonly string[]
}

const SUGGESTION_LIMIT = 5

function normalize(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/ +/g, ' ')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, index) => index)
  let next = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    next[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + cost)
    }
    const swap = prev
    prev = next
    next = swap
  }
  return prev[b.length]
}

type Rank = { tier: number; score: number }

function better(current: Rank | null, next: Rank): Rank {
  if (!current) return next
  if (next.tier < current.tier) return next
  if (next.tier === current.tier && next.score < current.score) return next
  return current
}

function rankCandidate(label: string, aliases: readonly string[], query: string): Rank | null {
  const q = normalize(query)
  if (!q) return null
  const qWords = q.split(' ')
  const fields = [label, ...aliases].map((value) => normalize(value)).filter(Boolean)
  if (!fields.length) return null

  let best: Rank | null = null
  const labelKey = normalize(label)
  for (const field of fields) {
    if (field === q) best = better(best, { tier: 0, score: field === labelKey ? 0 : 1 })
    else if (field.startsWith(q)) best = better(best, { tier: 0, score: 2 + field.length })
  }
  if (best?.tier === 0) return best

  const words = [...new Set(fields.flatMap((field) => field.split(' ')))]
  const tokenHits = qWords.filter((token) => token.length >= 2 && words.some((word) => (
    word.startsWith(token) || (token.length >= 4 && word.length >= 4 && token.startsWith(word))
  )))
  if (tokenHits.length > 0) {
    const aliasEqualsToken = aliases.some((alias) => {
      const key = normalize(alias)
      return key.length >= 3 && qWords.includes(key)
    })
    const all = tokenHits.length === qWords.length
    best = better(best, {
      tier: 1,
      score: (aliasEqualsToken ? 0 : 4) + (all ? 0 : 2) + (qWords.length - tokenHits.length),
    })
  }
  if (best?.tier === 1) return best
  if (q.length < 4) return best

  const limit = Math.max(1, Math.floor(q.length / 5))
  for (const field of fields) {
    const dist = levenshtein(q, field)
    if (dist > 0 && dist <= limit) best = better(best, { tier: 2, score: dist })
  }
  if (qWords.length > 1 && qWords.every((word) => word.length >= 4)) {
    const dists = qWords.map((token) => Math.min(...words.map((word) => levenshtein(token, word))))
    if (dists.every((dist) => dist <= 2)) {
      const sum = dists.reduce((total, dist) => total + dist, 0)
      if (sum > 0) best = better(best, { tier: 2, score: 10 + sum })
    }
  } else if (qWords.length === 1 && qWords[0].length >= 4) {
    const token = qWords[0]
    const wordLimit = token.length <= 6 ? 1 : 2
    for (const word of words) {
      const dist = levenshtein(token, word)
      if (dist > 0 && dist <= wordLimit) best = better(best, { tier: 2, score: 10 + dist })
    }
  }
  return best
}

function asSpot(row: SpotCandidate): SpotCandidate {
  return { id: row.id, label: row.label, lat: row.lat, lng: row.lng }
}

export function suggestSpots(query: string, extra: readonly SpotCandidate[] = []): SpotCandidate[] {
  if (!normalize(query)) return []
  const seen = new Set<string>()
  const ranked: { spot: SpotCandidate; rank: Rank }[] = []

  const push = (row: SpotCandidate | null | undefined, aliases: readonly string[]) => {
    if (!row || typeof row.label !== 'string') return
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return
    const key = normalize(row.label)
    if (!key || seen.has(key)) return
    const rank = rankCandidate(row.label, aliases, query)
    if (!rank) return
    seen.add(key)
    ranked.push({ spot: asSpot(row), rank })
  }

  for (const row of catalogStops()) {
    push(row, row.aliases || [])
  }
  for (const row of Array.isArray(extra) ? extra : []) {
    push(row, row.aliases || [])
  }

  ranked.sort((a, b) => a.rank.tier - b.rank.tier || a.rank.score - b.rank.score || a.spot.label.localeCompare(b.spot.label))
  return ranked.slice(0, SUGGESTION_LIMIT).map((item) => item.spot)
}
