import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KEY = '__communityMatchChips'
const chipsUrl = pathToFileURL(fileURLToPath(new URL('./CommunityMatchChips.jsx', import.meta.url))).href

function dataUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`
}

function state() {
  return globalThis[KEY]
}

const reactUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  export function useState(initial) {
    const box = globalThis[key]
    const i = box.cursor++
    if (box.hooks.length <= i) box.hooks[i] = initial
    const setState = (value) => {
      const next = typeof value === 'function' ? value(box.hooks[i]) : value
      box.sets.push(next)
      box.hooks[i] = next
    }
    return [box.hooks[i], setState]
  }
  export function useEffect(effect) {
    globalThis[key].effects.push(effect)
  }
`)

const nativeUrl = dataUrl(`
  export function View() { return null }
  export function Text() { return null }
`)

const communityUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  export function loadCommunityMatches() {
    const box = globalThis[key]
    box.calls += 1
    return box.result
  }
`)

function stripJsxReturn(source) {
  const marker = 'if (!lines.length) return null'
  const at = source.indexOf(marker)
  if (at < 0) throw new Error('CommunityMatchChips early return missing')
  const ret = source.indexOf('return (', at)
  if (ret < 0) throw new Error('CommunityMatchChips JSX return missing')
  let i = source.indexOf('(', ret)
  let depth = 0
  let quote = null
  for (; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) break
    }
  }
  if (depth !== 0) throw new Error('CommunityMatchChips JSX return is unbalanced')
  return `${source.slice(0, ret)}return lines.length ? { chips: true, lines } : null${source.slice(i + 1)}`
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || ''
    if (!parent.includes('CommunityMatchChips.jsx')) return nextResolve(specifier, context)
    if (specifier === 'react') return { url: reactUrl, shortCircuit: true }
    if (specifier === 'react-native') return { url: nativeUrl, shortCircuit: true }
    if (specifier === './community.js') return { url: communityUrl, shortCircuit: true }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (!url.includes('CommunityMatchChips.jsx')) return nextLoad(url, context)
    const source = stripJsxReturn(readFileSync(fileURLToPath(url), 'utf8'))
    return { format: 'module', source, shortCircuit: true }
  },
})

function reset() {
  globalThis[KEY] = {
    hooks: [],
    cursor: 0,
    effects: [],
    sets: [],
    calls: 0,
    result: Promise.resolve([]),
  }
}

function render(Component, props) {
  state().cursor = 0
  state().effects = []
  return Component(props)
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

const unhandled = []
function onUnhandled(error) {
  unhandled.push(error)
}
process.on('unhandledRejection', onUnhandled)

test('CommunityMatchChips renders null when loadCommunityMatches rejects', async () => {
  reset()
  unhandled.length = 0
  state().result = Promise.reject(new Error('community match failed'))
  const { CommunityMatchChips } = await import(chipsUrl)
  assert.equal(render(CommunityMatchChips, { supabase: {}, tripId: 'trip-1' }), null)
  const cleanups = state().effects.map((effect) => effect())
  await flush()
  assert.equal(state().calls, 1)
  assert.equal(render(CommunityMatchChips, { supabase: {}, tripId: 'trip-1' }), null)
  assert.deepEqual(state().sets.at(-1), [])
  assert.equal(state().sets.length >= 2, true)
  assert.equal(unhandled.length, 0)
  for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
})

test('CommunityMatchChips still renders matches when the load resolves', async () => {
  reset()
  const rows = [{ category: 'hometown', label: 'Both from Greenville' }]
  state().result = Promise.resolve(rows)
  const { CommunityMatchChips } = await import(chipsUrl)
  assert.equal(render(CommunityMatchChips, { supabase: {}, tripId: 'trip-1' }), null)
  const cleanups = state().effects.map((effect) => effect())
  await flush()
  assert.deepEqual(render(CommunityMatchChips, { supabase: {}, tripId: 'trip-1' }), { chips: true, lines: rows })
  for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
})

test.after(() => {
  process.off('unhandledRejection', onUnhandled)
})
