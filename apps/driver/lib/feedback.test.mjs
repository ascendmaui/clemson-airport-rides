import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

// Loads FeedbackProvider with expo-audio / haptics / react stubbed, then calls pulse().
const KEY = '__driverFeedbackPulse'
const REQUEST = 101
const ACCEPT = 102
const COMPLETE = 103
const GO = 104
const END = 105

function dataUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`
}

function state() {
  return globalThis[KEY]
}

const reactUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  const box = () => globalThis[key]
  export function createContext(defaultValue) {
    return {
      defaultValue,
      Provider(props) {
        box().api = props.value
        return props.children ?? null
      },
    }
  }
  export function useContext(ctx) {
    return ctx?.defaultValue
  }
  export function useRef(initial) {
    const hooks = box()
    const i = hooks.refCursor++
    if (hooks.refs[i] === undefined) hooks.refs[i] = { current: initial }
    return hooks.refs[i]
  }
  export function useMemo(factory) {
    const hooks = box()
    const i = hooks.memoCursor++
    if (hooks.memos[i] === undefined) hooks.memos[i] = factory()
    return hooks.memos[i]
  }
  export function useEffect(effect) {
    const hooks = box()
    const i = hooks.effectCursor++
    if (hooks.effectsRan[i]) return
    hooks.effectsRan[i] = true
    const cleanup = effect()
    if (typeof cleanup === 'function') hooks.cleanups[i] = cleanup
  }
  export function createElement(type, props, ...children) {
    if (typeof type === 'function') {
      const child = children.length <= 1 ? (children[0] ?? null) : children
      return type({ ...props, children: props && props.children !== undefined ? props.children : child })
    }
    return null
  }
`)

const audioUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  const CUE = new Set([${ACCEPT}, ${COMPLETE}])
  function fail(source, kind) {
    const mode = globalThis[key].mode
    if (mode === 'create-all-throw') return kind === 'create'
    if (!CUE.has(source)) return false
    return mode === kind
  }
  function player(source) {
    return {
      volume: 1,
      seekTo() {
        const box = globalThis[key]
        box.seekAttempts.push(source)
        if (fail(source, 'seek-throw')) throw new Error('seekTo threw')
        if (fail(source, 'seek-reject')) return Promise.reject(new Error('seekTo rejected'))
        return Promise.resolve()
      },
      play() {
        const box = globalThis[key]
        box.playAttempts.push(source)
        if (fail(source, 'play-throw')) throw new Error('play threw')
        if (fail(source, 'play-reject')) return Promise.reject(new Error('play rejected'))
        box.played.push(source)
      },
      release() {},
    }
  }
  export function createAudioPlayer(source) {
    const box = globalThis[key]
    box.created.push(source)
    if (fail(source, 'create-throw') || fail(source, 'create')) throw new Error('createAudioPlayer threw')
    return player(source)
  }
  export function setAudioModeAsync() {
    return Promise.resolve()
  }
`)

const hapticsUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  export const NotificationFeedbackType = { Warning: 'warning', Success: 'success', Error: 'error' }
  export const ImpactFeedbackStyle = { Heavy: 'heavy', Light: 'light', Medium: 'medium' }
  export function notificationAsync(type) {
    globalThis[key].haptics.push(type)
    return Promise.resolve()
  }
  export function impactAsync(style) {
    globalThis[key].impacts.push(style)
    return Promise.resolve()
  }
`)

const themeUrl = dataUrl(`
  export function useTheme() {
    return {
      sounds: true,
      rideAlerts: { standard: 'chime_vibrate', wait: 'chime_vibrate', comfort: 'chime_vibrate', carpool: 'chime_vibrate' },
    }
  }
`)

const ladderUrl = dataUrl(`
  export function playbackForTier() {
    return { sound: true, vibrate: true }
  }
`)

const assetUrls = new Map([
  ['@/assets/sounds/request.wav', dataUrl(`export default ${REQUEST}`)],
  ['@/assets/sounds/accept.wav', dataUrl(`export default ${ACCEPT}`)],
  ['@/assets/sounds/complete.wav', dataUrl(`export default ${COMPLETE}`)],
  ['@/assets/sounds/go.wav', dataUrl(`export default ${GO}`)],
  ['@/assets/sounds/end.wav', dataUrl(`export default ${END}`)],
])

const shiftCueUrl = new URL('./shiftCue.ts', import.meta.url).href
const underTestPath = join(mkdtempSync(join(tmpdir(), 'driver-feedback-')), 'feedback.ts')
const underTestUrl = pathToFileURL(underTestPath).href
const underTestName = 'driver-feedback-'

function loadableSource(source) {
  const reactImport = "import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'"
  const withElement = "import { createElement, createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'"
  if (!source.includes(reactImport)) throw new Error('feedback.tsx react import changed')
  const jsx = 'return <FeedbackContext.Provider value={api}>{children}</FeedbackContext.Provider>'
  if (!source.includes(jsx)) throw new Error('feedback.tsx JSX return changed')
  return source.replace(reactImport, withElement).replace(jsx, 'return createElement(FeedbackContext.Provider, { value: api }, children)')
}

writeFileSync(new URL(underTestUrl), loadableSource(readFileSync(new URL('./feedback.tsx', import.meta.url), 'utf8')))

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || ''
    if (!parent.includes(underTestName)) return nextResolve(specifier, context)
    if (specifier === 'expo-audio') return { url: audioUrl, shortCircuit: true }
    if (specifier === 'expo-haptics') return { url: hapticsUrl, shortCircuit: true }
    if (specifier === 'react') return { url: reactUrl, shortCircuit: true }
    if (specifier === '@/lib/theme') return { url: themeUrl, shortCircuit: true }
    if (specifier === 'rides-native/offerLadder.js') return { url: ladderUrl, shortCircuit: true }
    if (specifier === '@/lib/shiftCue') return { url: shiftCueUrl, shortCircuit: true }
    if (assetUrls.has(specifier)) return { url: assetUrls.get(specifier), shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

function fresh() {
  const previous = globalThis[KEY]
  if (previous) {
    for (const cleanup of previous.cleanups) {
      if (typeof cleanup === 'function') cleanup()
    }
  }
  globalThis[KEY] = {
    mode: 'ok',
    api: null,
    refs: [],
    refCursor: 0,
    memos: [],
    memoCursor: 0,
    effectsRan: [],
    effectCursor: 0,
    cleanups: [],
    created: [],
    seekAttempts: [],
    playAttempts: [],
    played: [],
    haptics: [],
    impacts: [],
  }
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

const MODES = ['create-throw', 'create-all-throw', 'seek-throw', 'seek-reject', 'play-throw', 'play-reject']

test('pulse keeps haptics when accept or complete audio fails', async () => {
  fresh()
  const feedback = await import(underTestUrl)
  for (const mode of MODES) {
    fresh()
    state().mode = mode
    unhandled.length = 0
    assert.doesNotThrow(() => feedback.FeedbackProvider({ children: null }), `${mode} mount`)
    const pulse = state().api?.pulse
    assert.equal(typeof pulse, 'function', mode)
    for (const kind of ['accept', 'complete', 'cancel']) {
      assert.doesNotThrow(() => pulse(kind), `${mode} pulse(${kind})`)
    }
    await flush()
    assert.deepEqual(state().haptics, ['success', 'success', 'error'], mode)
    assert.equal(unhandled.length, 0, `${mode} unhandled ${unhandled.map((error) => error?.message).join('; ')}`)
    if (mode === 'create-throw') assert.deepEqual(state().played, [REQUEST, REQUEST], mode)
    if (mode === 'create-all-throw') assert.deepEqual(state().played, [], mode)
    if (mode === 'seek-throw' || mode === 'seek-reject') assert.deepEqual(state().playAttempts, [], mode)
    if (mode === 'play-throw' || mode === 'play-reject') assert.deepEqual(state().playAttempts, [ACCEPT, COMPLETE], mode)
  }
})

test.after(() => {
  process.off('unhandledRejection', onUnhandled)
})
