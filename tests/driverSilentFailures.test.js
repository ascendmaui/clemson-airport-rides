import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  driverErrorText,
  failureToast,
  isPermanentFailure,
  logSoft,
  quiet,
  quietly,
  tripStepFailureTitle,
  withRetry,
} from '../apps/driver/lib/softFail.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

test('failureToast shows an error toast that retries on tap and logs the cause', () => {
  const toasts = []
  const logs = []
  let retried = 0
  failureToast(
    { key: 'accept', title: 'Could not accept this ride', err: new Error('Network request failed'), fallback: 'The ride was not accepted.', retry: () => { retried += 1 } },
    (t) => { toasts.push(t); return 'id' },
    (...args) => logs.push(args),
  )
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].tone, 'error')
  assert.equal(toasts[0].key, 'driver-fail:accept')
  assert.match(toasts[0].body, /The ride was not accepted\. Check your signal/)
  assert.match(toasts[0].body, /Tap to retry\.$/)
  toasts[0].onPress()
  assert.equal(retried, 1)
  assert.equal(logs[0][0], '[driver] accept')
})

test('failureToast without retry has no tap action', () => {
  const toasts = []
  failureToast({ key: 'x', title: 'T', fallback: 'F' }, (t) => { toasts.push(t); return 'id' }, () => {})
  assert.equal(toasts[0].onPress, undefined)
  assert.equal(toasts[0].body, 'F')
})

test('driverErrorText keeps short driver-facing sentences, hides technical or secret text', () => {
  assert.equal(driverErrorText(new Error('This ride was taken by another driver'), 'fallback'), 'This ride was taken by another driver')
  assert.equal(driverErrorText(new Error('TypeError: x is undefined'), 'fallback'), 'fallback')
  assert.equal(driverErrorText({ message: 'SUPABASE_SERVICE_ROLE_KEY missing' }, 'fallback'), 'fallback')
  assert.equal(driverErrorText('trip_status_conflict', 'fallback'), 'fallback')
  assert.equal(driverErrorText(null, 'fallback'), 'fallback')
  assert.match(driverErrorText(new Error('Request timed out'), 'Could not save.'), /^Could not save\. Check your signal/)
})

test('quiet and quietly log and never rethrow', async () => {
  const logs = []
  await Promise.reject(new Error('boom')).catch(quiet('bg', (...a) => logs.push(a)))
  const value = await Promise.reject(new Error('nope')).catch(quietly('read', null, (...a) => logs.push(a)))
  assert.equal(value, null)
  assert.deepEqual(logs.map((l) => l[0]), ['[driver] bg', '[driver] read'])
  assert.doesNotThrow(() => logSoft('t', new Error('x'), () => { throw new Error('logger down') }))
})

test('withRetry retries transient failures with backoff, then succeeds', async () => {
  const sleeps = []
  let calls = 0
  const out = await withRetry(async () => {
    calls += 1
    if (calls < 3) throw new Error('Network request failed')
    return 'ok'
  }, { attempts: 3, baseMs: 100, sleep: async (ms) => { sleeps.push(ms) } })
  assert.equal(out, 'ok')
  assert.equal(calls, 3)
  assert.deepEqual(sleeps, [100, 200])
})

test('withRetry stops on permanent failures and rethrows the last error', async () => {
  let calls = 0
  await assert.rejects(withRetry(async () => { calls += 1; throw Object.assign(new Error('Forbidden'), { status: 403 }) }, { sleep: async () => {} }), /Forbidden/)
  assert.equal(calls, 1)
  let n = 0
  await assert.rejects(withRetry(async () => { n += 1; throw new Error('Network request failed') }, { attempts: 2, sleep: async () => {} }), /Network/)
  assert.equal(n, 2)
  assert.equal(isPermanentFailure(Object.assign(new Error('x'), { status: 429 })), false)
  assert.equal(isPermanentFailure(new Error('This ride was already accepted')), true)
})

test('trip step toasts name the button the driver tapped', () => {
  assert.equal(tripStepFailureTitle('arrived'), 'Could not start the trip')
  assert.equal(tripStepFailureTitle('in_progress'), 'Could not end the trip')
  assert.equal(tripStepFailureTitle('accepted'), 'Could not mark arriving')
  assert.equal(tripStepFailureTitle(null), 'Could not update this trip')
})

test('accept, go online, trip steps, stops and no-show surface a toast with retry', () => {
  const home = read('apps/driver/app/(tabs)/index.tsx')
  assert.match(home, /failureToast\(\{ key: 'accept'[\s\S]*?retry: \(\) => \{ void onAccept\(card\) \}/)
  assert.match(home, /key: 'go-online'[\s\S]*?retry: \(\) => \{ void toggle\(\) \}/)
  assert.match(home, /failureToast\(\{ key: 'decline'/)
  const queue = read('apps/driver/app/queue.tsx')
  assert.match(queue, /failureToast\(\{ key: 'accept'[\s\S]*?void onAccept\(card\)/)
  assert.match(queue, /failureToast\(\{ key: 'depart'/)
  const trip = read('apps/driver/app/trip.tsx')
  assert.match(trip, /key: 'trip-step'[\s\S]*?tripStepFailureTitle\(trip\.status\)[\s\S]*?void onAdvance\(\)/)
  assert.match(trip, /key: 'trip-stop'/)
  assert.match(trip, /key: 'trip-no-show'/)
})

test('a successful accept or trip step is never reported as failed because a re-read failed', () => {
  const home = read('apps/driver/app/(tabs)/index.tsx')
  assert.match(home, /await refresh\(\)\.catch\(quiet\('refresh after accept'\)\)\s*router\.push\(\{ pathname: '\/trip'/)
  assert.match(read('apps/driver/app/queue.tsx'), /await refresh\(\)\.catch\(quiet\('refresh after accept'\)\)/)
  assert.match(read('apps/driver/app/trip.tsx'), /await refresh\(\)\.catch\(quiet\('refresh after trip step'\)\)/)
  // Going online already happened when the seats write runs.
  assert.match(home, /withRetry\(\(\) => publishDriverCapacity[\s\S]*?\.catch\(quiet\('publish capacity'\)\)/)
})

function driverSources(dir = path.join(ROOT, 'apps/driver')) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...driverSources(full))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full)
  }
  return out
}

test('no empty catch swallows a driver-app network or storage failure (haptics excepted)', () => {
  const offenders = []
  for (const file of driverSources()) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!/\.catch\(\(\) => (\{\}|null)\)/.test(line) || /^\s*(\/\*\*|\*)/.test(line)) return
      if (/Haptics\.|isAvailableAsync|pending = result\.catch|result\.pending\.catch|task\.then/.test(line)) return
      offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`)
    })
  }
  assert.deepEqual(offenders, [])
})

test('every .then chain in the driver app ends in a catch or a rejection handler', () => {
  const offenders = []
  for (const file of driverSources()) {
    const src = readFileSync(file, 'utf8')
    const re = /\.then\(/g
    let m
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length
      let depth = 1
      let topComma = false
      while (depth && i < src.length) {
        const c = src[i]
        if (c === '(' || c === '[' || c === '{') depth += 1
        else if (c === ')' || c === ']' || c === '}') depth -= 1
        else if (c === ',' && depth === 1) topComma = true
        i += 1
      }
      const tail = src.slice(i, i + 200)
      if (topComma || /^\s*\.(then|catch)\(/.test(tail)) continue
      // A chain returned into an outer catch: `.then(() => x.then(f))` is caught by the outer .catch.
      const before = src.slice(Math.max(0, m.index - 200), m.index)
      if (/=>\s*[\w!?.]+\([^()]*\)\s*$/.test(before) && /^\)\)?\s*\.catch\(/.test(tail)) continue
      if (/pending\.then\(work\)/.test(src.slice(m.index - 20, m.index + 20))) continue
      offenders.push(`${path.relative(ROOT, file)}:${src.slice(0, m.index).split('\n').length}`)
    }
  }
  assert.deepEqual(offenders, [])
})
