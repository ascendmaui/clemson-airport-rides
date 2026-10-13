import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const MATCH = 481516
const KEY = '__riderMatchChime'

function dataUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`
}

const audioUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  export function createAudioPlayer(source) {
    const state = globalThis[key]
    const player = {
      source,
      volume: 1,
      async seekTo(position) { state.seeks.push({ source, position }) },
      play() { state.plays.push(source) },
    }
    state.players.push(player)
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
  assert.ok(statSync(asset).size > 1000)
  const seconds = m4aDuration(asset)
  assert.ok(seconds > 0.8 && seconds <= 2, `match chime is ${seconds}s`)
  assert.equal(existsSync(path.join(ROOT, 'apps/rider/assets/sounds/tiger.wav')), false)
  const feedback = readFileSync(path.join(ROOT, 'apps/rider/lib/feedback.ts'), 'utf8')
  const screen = readFileSync(path.join(ROOT, 'apps/rider/app/pick-driver.tsx'), 'utf8')
  assert.match(feedback, /match-chime\.m4a/)
  assert.doesNotMatch(feedback, /tiger\.wav/)
  assert.match(screen, /await playDriverFoundCue\(\)/)
  assert.doesNotMatch(screen, /playTigerCue|tiger\.wav/)
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

test('driver-found stays quiet when sounds are off and still taps a success haptic', async () => {
  const state = freshState()
  const { playDriverFoundCue, setSoundsEnabled } = await import('./feedback.ts')
  await setSoundsEnabled(false)
  await playDriverFoundCue()
  assert.deepEqual(state.plays, [])
  assert.deepEqual(state.notifications, ['success'])
})
