import { useEffect, useState } from 'react'
import { MIN_REMOTE_QUERY, SUGGEST_DEBOUNCE_MS, suggestAddresses } from './addressSearch.js'

const EMPTY = { provider: null, results: [] }

/**
 * Remote street suggestions for a typed query: 3+ characters, 300 ms debounce,
 * the previous request aborted on each keystroke. Failures resolve to no rows.
 */
export function useAddressSuggestions(query, { enabled = true } = {}) {
  const [state, setState] = useState(EMPTY)
  const q = String(query || '').trim()
  useEffect(() => {
    if (!enabled || q.length < MIN_REMOTE_QUERY) {
      setState(EMPTY)
      return undefined
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      suggestAddresses(q, { signal: controller.signal })
        .then((next) => {
          if (!controller.signal.aborted) setState(next)
        })
        .catch(() => {
          if (!controller.signal.aborted) setState(EMPTY)
        })
    }, SUGGEST_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [q, enabled])
  return state
}

/** Catalog rows first, then remote rows that do not repeat a catalog label. */
export function mergeSuggestions(catalogRows, remoteRows, max = 8) {
  const seen = new Set(catalogRows.map((row) => String(row.label).toLowerCase()))
  const extra = remoteRows.filter((row) => {
    const key = String(row.label).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...catalogRows.slice(0, 6), ...extra].slice(0, max)
}
