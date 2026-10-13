import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'

const url = (p) => new URL(`../${p}`, import.meta.url)
const read = (p) => readFileSync(url(p), 'utf8')

function wavInfo(p) {
  const buf = readFileSync(url(p))
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE')
  const rate = buf.readUInt32LE(24)
  const bytesPerSec = buf.readUInt32LE(28)
  return { rate, seconds: (buf.length - 44) / bytesPerSec }
}

test('accept and complete cues exist, are short, and are bundled', () => {
  for (const p of ['apps/driver/assets/sounds/accept.wav', 'apps/driver/assets/sounds/complete.wav', 'apps/rider/assets/sounds/complete.wav']) {
    assert.ok(statSync(url(p)).size > 1000, p)
    const { seconds } = wavInfo(p)
    assert.ok(seconds > 0.15 && seconds < 0.8, `${p} is ${seconds}s`)
  }
  const appJson = read('apps/driver/app.json')
  assert.match(appJson, /"\.\/assets\/sounds\/accept\.wav"/)
  assert.match(appJson, /"\.\/assets\/sounds\/complete\.wav"/)
})

test('driver accept and complete play their own cue, not the offer sound', () => {
  const fb = read('apps/driver/lib/feedback.tsx')
  assert.match(fb, /import acceptSound from '@\/assets\/sounds\/accept\.wav'/)
  assert.match(fb, /import completeSound from '@\/assets\/sounds\/complete\.wav'/)
  assert.match(fb, /kind === 'accept' \? acceptRef\.current : kind === 'complete' \? completeRef\.current : playerRef\.current/)
  assert.match(fb, /if \(sound\) play\(kind\)/)
  assert.match(fb, /playsInSilentMode: false/)
  assert.match(read('apps/driver/lib/push.ts'), /title: 'Ride accepted',[\s\S]{0,120}sound: 'accept\.wav'/)
})

test('rider trip-complete cue honors the sounds toggle and the mute switch', () => {
  const fb = read('apps/rider/lib/feedback.ts')
  assert.match(fb, /export async function playCompleteCue\(\) \{\s*if \(!\(await soundsEnabled\(\)\)\) return/)
})
