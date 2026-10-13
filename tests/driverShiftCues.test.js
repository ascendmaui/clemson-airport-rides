import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { playShiftCue } from '../apps/driver/lib/shiftCue.ts'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url))
const text = (rel) => read(rel).toString('utf8')

function pcm(rel) {
  const buf = read(rel)
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE')
  const rate = buf.readUInt32LE(24)
  const data = buf.subarray(44)
  const samples = new Array(data.length / 2)
  for (let i = 0; i < samples.length; i += 1) samples[i] = data.readInt16LE(i * 2) / 32768
  return { rate, samples, seconds: samples.length / rate }
}

function lowRatio(samples, rate, startSec, endSec) {
  const a = Math.exp((-2 * Math.PI * 90) / rate)
  let acc = 0
  let low = 0
  let all = 0
  const start = Math.max(0, Math.floor(startSec * rate))
  const end = Math.min(samples.length, Math.floor(endSec * rate))
  for (let i = start; i < end; i += 1) {
    const sample = samples[i]
    acc = (1 - a) * sample + a * acc
    low += acc * acc
    all += sample * sample
  }
  return low / (all || 1)
}

async function fire(control, sounds = true) {
  const events = []
  let t = 0
  await playShiftCue(control, {
    sounds,
    play: (sound) => events.push({ t, type: 'play', sound }),
    impact: (style) => events.push({ t, type: 'impact', style }),
    success: () => events.push({ t, type: 'success' }),
    delay: async (ms) => {
      t += ms
    },
  })
  return events
}

test('GO plays the horn cue with a heavy impact and two quick successes', async () => {
  const events = await fire('GO')
  assert.deepEqual(events, [
    { t: 0, type: 'play', sound: 'go' },
    { t: 0, type: 'impact', style: 'heavy' },
    { t: 100, type: 'success' },
    { t: 200, type: 'success' },
  ])
  const muted = await fire('GO', false)
  assert.deepEqual(muted.map((event) => event.type), ['impact', 'success', 'success'])
})

test('END plays a different chime with two light impacts and a gap', async () => {
  const events = await fire('END')
  assert.deepEqual(events, [
    { t: 0, type: 'play', sound: 'end' },
    { t: 0, type: 'impact', style: 'light' },
    { t: 320, type: 'impact', style: 'light' },
  ])
  assert.ok(events[2].t - events[1].t >= 250)
  const go = await fire('GO')
  assert.notDeepEqual(events, go)
  const muted = await fire('END', false)
  assert.deepEqual(muted.map((event) => event.type), ['impact', 'impact'])
  assert.equal(muted[1].style, 'light')
})

function zeroCrossRate(samples, rate, startSec, endSec) {
  const start = Math.max(1, Math.floor(startSec * rate))
  const end = Math.min(samples.length, Math.floor(endSec * rate))
  let crosses = 0
  for (let i = start; i < end; i += 1) {
    const prev = samples[i - 1]
    const sample = samples[i]
    if ((prev <= 0 && sample > 0) || (prev >= 0 && sample < 0)) crosses += 1
  }
  return crosses / (((end - start) / rate) || 1)
}

test('GO rises and END falls, both short warm chimes under 400 ms', () => {
  const go = pcm('apps/driver/assets/sounds/go.wav')
  const end = pcm('apps/driver/assets/sounds/end.wav')
  assert.equal(go.rate, 44100)
  assert.equal(end.rate, 44100)
  assert.ok(go.seconds > 0.2 && go.seconds < 0.4, `GO is ${go.seconds}s`)
  assert.ok(end.seconds > 0.2 && end.seconds < 0.4, `END is ${end.seconds}s`)
  const goRise = zeroCrossRate(go.samples, go.rate, go.seconds * 0.55, go.seconds * 0.9)
  const goStart = zeroCrossRate(go.samples, go.rate, 0.02, go.seconds * 0.28)
  const endFall = zeroCrossRate(end.samples, end.rate, end.seconds * 0.55, end.seconds * 0.9)
  const endStart = zeroCrossRate(end.samples, end.rate, 0.02, end.seconds * 0.28)
  assert.ok(goRise > goStart, 'GO rises')
  assert.ok(endFall < endStart, 'END falls')
  const goPeak = Math.max(...go.samples.map((sample) => Math.abs(sample)))
  const endPeak = Math.max(...end.samples.map((sample) => Math.abs(sample)))
  assert.ok(goPeak < 0.9 && endPeak < 0.9, 'peaks stay under about -1 dBTP')
  assert.notDeepEqual(read('apps/driver/assets/sounds/go.wav'), read('apps/driver/assets/sounds/end.wav'))
  for (const other of ['accept.wav', 'complete.wav', 'request.wav']) {
    assert.notDeepEqual(read('apps/driver/assets/sounds/go.wav'), read(`apps/driver/assets/sounds/${other}`))
  }
})

test('GO and END taps use those cues, and accept and complete keep theirs', () => {
  const home = text('apps/driver/app/(tabs)/index.tsx')
  const fb = text('apps/driver/lib/feedback.tsx')
  assert.match(home, /pulseShift\(nextOnline \? 'GO' : 'END'\)/)
  assert.match(home, /if \(nextOnline\) await goOnline\(user\.id, fix\)/)
  assert.match(home, /else await goOffline\(user\.id\)/)
  assert.match(home, /homeClutterTranslateY\(false\)/)
  assert.match(fb, /import goSound from '@\/assets\/sounds\/go\.wav'/)
  assert.match(fb, /import endSound from '@\/assets\/sounds\/end\.wav'/)
  assert.match(fb, /import acceptSound from '@\/assets\/sounds\/accept\.wav'/)
  assert.match(fb, /import completeSound from '@\/assets\/sounds\/complete\.wav'/)
  assert.match(fb, /playShiftCue\(control, \{/)
  assert.match(fb, /sounds: soundsRef\.current/)
  assert.match(fb, /case 'heavy':\s*return Haptics\.ImpactFeedbackStyle\.Heavy/)
  assert.match(fb, /case 'light':\s*return Haptics\.ImpactFeedbackStyle\.Light/)
  assert.match(fb, /Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Success\)/)
  assert.match(fb, /kind === 'accept' \? acceptRef\.current : kind === 'complete' \? completeRef\.current : playerRef\.current/)
  assert.match(text('apps/driver/app/vehicles.tsx'), /pulse\('online'\)/)
  assert.match(text('apps/driver/app/fleet.tsx'), /pulse\('online'\)/)
  const script = text('scripts/synthDriverShiftCues.py')
  assert.match(script, /loudnorm=I=-16:TP=-1/)
  assert.match(script, /synthesize_go/)
  assert.match(script, /synthesize_end/)
  assert.doesNotMatch(script, /clemson|band recording/i)
})
