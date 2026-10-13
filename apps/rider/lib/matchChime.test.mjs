import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const MATCH = 481516
const OLD_SOUND_FILE = 'tiger' + '.wav'
const KEY = '__riderMatchChime'

function dataUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`
}

const audioUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  export function createAudioPlayer(source) {
    const player = {
      source,
      volume: 1,
      async seekTo(position) { globalThis[key].seeks.push({ source, position }) },
      play() { globalThis[key].plays.push(source) },
    }
    globalThis[key].players.push(player)
    return player
  }
  export async function setAudioModeAsync(options) {
    globalThis[key].modes.push(options)
  }
`)

const hapticsUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  export const ImpactFeedbackStyle = { Light: 'light', Medium: 'medium', Heavy: 'heavy' }
  export const NotificationFeedbackType = { Success: 'success', Warning: 'warning', Error: 'error' }
  export async function impactAsync(style) {
    globalThis[key].impacts.push(style)
  }
  export async function notificationAsync(type) {
    globalThis[key].notifications.push(type)
  }
`)

const storageUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  export const authStorage = {
    async getItem(name) {
      const state = globalThis[key]
      return state.items.has(name) ? state.items.get(name) : null
    },
    async setItem(name, value) {
      globalThis[key].items.set(name, value)
    },
  }
`)

const matchUrl = dataUrl(`export default ${MATCH}`)
const wavUrl = dataUrl('export default 1')

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || ''
    if (!parent.includes('/apps/rider/lib/feedback.ts')) return nextResolve(specifier, context)
    if (specifier === 'expo-audio') return { url: audioUrl, shortCircuit: true }
    if (specifier === 'expo-haptics') return { url: hapticsUrl, shortCircuit: true }
    if (specifier === '@/lib/storage') return { url: storageUrl, shortCircuit: true }
    if (specifier.endsWith('match-chime.m4a')) return { url: matchUrl, shortCircuit: true }
    if (specifier.endsWith('.wav')) return { url: wavUrl, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

function freshState() {
  globalThis[KEY] = {
    items: new Map(),
    plays: [],
    seeks: [],
    players: [],
    modes: [],
    impacts: [],
    notifications: [],
  }
  return globalThis[KEY]
}

function wavInfo(filePath) {
  const buf = readFileSync(filePath)
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE')
  let offset = 12
  let rate = 0
  let channels = 0
  let bits = 0
  let dataStart = 0
  let dataSize = 0
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2)
      rate = buf.readUInt32LE(body + 4)
      bits = buf.readUInt16LE(body + 14)
    } else if (id === 'data') {
      dataStart = body
      dataSize = size
      break
    }
    offset = body + size + (size % 2)
  }
  assert.ok(rate > 0 && dataSize > 0)
  const bytesPerSample = bits / 8
  let peak = 0
  for (let i = dataStart; i + bytesPerSample <= dataStart + dataSize; i += bytesPerSample) {
    const abs = Math.abs(buf.readInt16LE(i))
    if (abs > peak) peak = abs
  }
  return {
    seconds: dataSize / (rate * channels * bytesPerSample),
    peak,
  }
}

function m4aDuration(filePath) {
  const buf = readFileSync(filePath)
  function walk(start, end) {
    let i = start
    while (i + 8 <= end) {
      let size = buf.readUInt32BE(i)
      const type = buf.toString('ascii', i + 4, i + 8)
      let header = 8
      if (size === 1) {
        size = Number(buf.readBigUInt64BE(i + 8))
        header = 16
      } else if (size === 0) {
        size = end - i
      }
      if (size < header) break
      if (type === 'mvhd') {
        const body = i + header
        const version = buf[body]
        const timescale = version === 0 ? buf.readUInt32BE(body + 12) : buf.readUInt32BE(body + 20)
        const duration = version === 0 ? buf.readUInt32BE(body + 16) : Number(buf.readBigUInt64BE(body + 24))
        return duration / timescale
      }
      if (type === 'moov' || type === 'trak' || type === 'mdia') {
        const nested = walk(i + header, i + size)
        if (nested != null) return nested
      }
      i += size
    }
    return null
  }
  const seconds = walk(0, buf.length)
  assert.equal(typeof seconds, 'number')
  return seconds
}

test('match chime asset exists, is at most two seconds, and replaces the old cue', () => {
  const asset = path.join(ROOT, 'apps/rider/assets/sounds/match-chime.m4a')
  const master = path.join(ROOT, 'apps/rider/assets/sounds/match-chime.wav')
  assert.ok(statSync(asset).size > 1000)
  assert.ok(statSync(master).size > 1000)
  const seconds = m4aDuration(asset)
  const wav = wavInfo(master)
  assert.ok(seconds > 0.2 && seconds < 0.4, `match chime is ${seconds}s`)
  assert.ok(wav.seconds > 0.2 && wav.seconds < 0.4, `wav master is ${wav.seconds}s`)
  assert.ok(wav.peak > 0 && wav.peak < 32767, `wav peak ${wav.peak} is outside the safe 16-bit range`)
  assert.equal(existsSync(path.join(ROOT, 'apps/rider/assets/sounds', OLD_SOUND_FILE)), false)
  const feedback = readFileSync(path.join(ROOT, 'apps/rider/lib/feedback.ts'), 'utf8')
  const screen = readFileSync(path.join(ROOT, 'apps/rider/app/pick-driver.tsx'), 'utf8')
  assert.match(feedback, /match-chime\.m4a/)
  assert.equal(feedback.includes(OLD_SOUND_FILE), false)
  assert.match(screen, /await playDriverBrowseCue\(\)/)
  assert.match(screen, /await playDriverFoundCue\(\)/)
  assert.equal(screen.includes('playTigerCue'), false)
  assert.equal(screen.includes(OLD_SOUND_FILE), false)
})

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.expo', '__pycache__'])
const TEXT_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.toml', '.txt', '.py', '.svg'])

function oldSoundReferences() {
  const hits = []
  function walk(dir) {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (entry.name === OLD_SOUND_FILE) hits.push(path.relative(ROOT, full))
      if (!TEXT_EXT.has(path.extname(entry.name))) continue
      const text = readFileSync(full, 'utf8')
      if (text.includes(OLD_SOUND_FILE)) hits.push(path.relative(ROOT, full))
    }
  }
  walk(ROOT)
  return hits
}

test('no code references the old sound file', () => {
  assert.deepEqual(oldSoundReferences(), [])
})

test('driver-found event plays the match chime and a success haptic', async () => {
  const state = freshState()
  const { playDriverFoundCue } = await import('./feedback.ts')
  await playDriverFoundCue()
  assert.deepEqual(state.plays, [MATCH])
  assert.deepEqual(state.players.map((player) => player.source), [MATCH])
  assert.deepEqual(state.seeks, [{ source: MATCH, position: 0 }])
  assert.equal(state.modes.length, 1)
  assert.equal(state.modes[0].playsInSilentMode, false)
  assert.deepEqual(state.notifications, ['success'])
})

test('browsing available drivers plays the match chime and a light haptic', async () => {
  const state = freshState()
  const { playDriverBrowseCue } = await import('./feedback.ts')
  await playDriverBrowseCue()
  assert.deepEqual(state.plays, [MATCH])
  assert.deepEqual(state.impacts, ['light'])
  assert.deepEqual(state.notifications, [])
})

test('browsing available drivers stays quiet when sounds are off and still taps lightly', async () => {
  const state = freshState()
  const { playDriverBrowseCue, setSoundsEnabled } = await import('./feedback.ts')
  await setSoundsEnabled(false)
  await playDriverBrowseCue()
  assert.deepEqual(state.plays, [])
  assert.deepEqual(state.impacts, ['light'])
})

test('driver-found stays quiet when sounds are off and still taps a success haptic', async () => {
  const state = freshState()
  const { playDriverFoundCue, setSoundsEnabled } = await import('./feedback.ts')
  await setSoundsEnabled(false)
  await playDriverFoundCue()
  assert.deepEqual(state.plays, [])
  assert.deepEqual(state.notifications, ['success'])
})
