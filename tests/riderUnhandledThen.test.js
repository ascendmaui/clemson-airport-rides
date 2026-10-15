import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RIDER = path.join(ROOT, 'apps/rider')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full)
  }
  return out
}

function skipString(src, i) {
  const quote = src[i]
  i += 1
  if (quote !== '`') {
    while (i < src.length) {
      if (src[i] === '\\') {
        i += 2
        continue
      }
      if (src[i] === quote) return i + 1
      i += 1
    }
    return i
  }
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2
      continue
    }
    if (src[i] === '`') return i + 1
    if (src[i] === '$' && src[i + 1] === '{') {
      i += 2
      let depth = 1
      while (i < src.length && depth) {
        const ch = src[i]
        if (ch === '"' || ch === "'" || ch === '`') {
          i = skipString(src, i)
          continue
        }
        if (ch === '{') depth += 1
        else if (ch === '}') depth -= 1
        i += 1
      }
      continue
    }
    i += 1
  }
  return i
}

function chainEnd(src, start) {
  let i = start
  while (i < src.length) {
    if (src[i] !== '.') break
    let j = i + 1
    while (/[A-Za-z]/.test(src[j] || '')) j += 1
    const name = src.slice(i + 1, j)
    if (name !== 'then' && name !== 'catch' && name !== 'finally') break
    while (/\s/.test(src[j] || '')) j += 1
    if (src[j] !== '(') break
    let paren = 0
    let brace = 0
    let bracket = 0
    let k = j
    while (k < src.length) {
      const ch = src[k]
      if (ch === '"' || ch === "'" || ch === '`') {
        k = skipString(src, k)
        continue
      }
      if (ch === '/' && src[k + 1] === '/') {
        while (k < src.length && src[k] !== '\n') k += 1
        continue
      }
      if (ch === '/' && src[k + 1] === '*') {
        k += 2
        while (k < src.length && !(src[k] === '*' && src[k + 1] === '/')) k += 1
        k += 2
        continue
      }
      if (ch === '(') paren += 1
      else if (ch === ')') {
        paren -= 1
        if (paren === 0 && brace === 0 && bracket === 0) {
          k += 1
          break
        }
      } else if (ch === '{') brace += 1
      else if (ch === '}') brace -= 1
      else if (ch === '[') bracket += 1
      else if (ch === ']') bracket -= 1
      k += 1
    }
    i = k
    while (/\s/.test(src[i] || '')) i += 1
    if (src[i] !== '.') break
  }
  return i
}

function hasTwoArgThen(chain) {
  const start = chain.indexOf('.then(')
  if (start < 0) return false
  let i = start + 6
  let paren = 1
  let brace = 0
  let bracket = 0
  while (i < chain.length && paren > 0) {
    const ch = chain[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(chain, i)
      continue
    }
    if (ch === '(') paren += 1
    else if (ch === ')') paren -= 1
    else if (ch === '{') brace += 1
    else if (ch === '}') brace -= 1
    else if (ch === '[') bracket += 1
    else if (ch === ']') bracket -= 1
    else if (ch === ',' && paren === 1 && brace === 0 && bracket === 0) return true
    if (paren) i += 1
  }
  return false
}

export function uncaughtThens(src) {
  const hits = []
  let i = 0
  const seen = new Set()
  while (i < src.length) {
    const idx = src.indexOf('.then(', i)
    if (idx < 0) break
    if (seen.has(idx)) {
      i = idx + 5
      continue
    }
    const end = chainEnd(src, idx)
    const chain = src.slice(idx, end)
    let cursor = 0
    while (cursor < chain.length) {
      const next = chain.indexOf('.then(', cursor)
      if (next < 0) break
      seen.add(idx + next)
      cursor = next + 5
    }
    if (!/\.catch\s*\(/.test(chain) && !hasTwoArgThen(chain)) {
      hits.push(src.slice(0, idx).split('\n').length)
    }
    i = Math.max(end, idx + 5)
  }
  return hits
}

test('a .then without .catch is caught by the guard', () => {
  assert.deepEqual(uncaughtThens('load().then((row) => row)'), [1])
  assert.deepEqual(uncaughtThens('load().then((row) => row).catch((err) => err)'), [])
  assert.deepEqual(uncaughtThens('load().then((row) => row, (err) => err)'), [])
})

test('rider app .then chains have a rejection handler', () => {
  const misses = []
  for (const file of walk(RIDER)) {
    const src = readFileSync(file, 'utf8')
    for (const line of uncaughtThens(src)) {
      misses.push(`${path.relative(ROOT, file)}:${line}`)
    }
  }
  assert.deepEqual(misses, [])
})

test('rider app has no empty catch that drops the error', () => {
  const misses = []
  for (const file of walk(RIDER)) {
    const src = readFileSync(file, 'utf8')
    const rel = path.relative(ROOT, file)
    if (/\.catch\(\s*\(\s*\)\s*=>\s*(\{\s*\}|null|false|\(\{\s*\}\))/.test(src)) {
      misses.push(`${rel} empty .catch`)
    }
    if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(src)) {
      misses.push(`${rel} empty catch block`)
    }
  }
  assert.deepEqual(misses, [])
})
