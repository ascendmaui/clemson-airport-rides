import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRecognizer,
  getSpeechSupport,
  loadInputMode,
  saveInputMode,
  speak,
  stopSpeaking,
  wasVoicePreferenceBlocked,
} from '../src/lib/speechMode.js'

function restore(snapshot) {
  if (snapshot.window === undefined) delete globalThis.window
  else globalThis.window = snapshot.window
  if (snapshot.SpeechSynthesisUtterance === undefined) delete globalThis.SpeechSynthesisUtterance
  else globalThis.SpeechSynthesisUtterance = snapshot.SpeechSynthesisUtterance
}

function snapshotGlobals() {
  return {
    window: globalThis.window,
    SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance,
  }
}

test('without a window, speech helpers stay on text and do not throw', () => {
  const previous = snapshotGlobals()
  delete globalThis.window
  try {
    assert.deepEqual(getSpeechSupport(), { recognition: false, synthesis: false, ok: false })
    assert.equal(loadInputMode('help'), 'text')
    assert.equal(wasVoicePreferenceBlocked('support'), false)
    assert.equal(createRecognizer({ onFinal() {} }), null)
    assert.doesNotThrow(() => saveInputMode('help', 'voice'))
    assert.doesNotThrow(() => speak('hello'))
    assert.doesNotThrow(() => stopSpeaking())
  } finally {
    restore(previous)
  }
})

test('a saved voice preference is honored only when both speech APIs exist', () => {
  const previous = snapshotGlobals()
  const store = { 'clemson.help.inputMode': 'voice', 'clemson.support.inputMode': 'voice' }
  const localStorage = {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = value
    },
  }
  const previousStorage = globalThis.localStorage
  globalThis.localStorage = localStorage
  globalThis.window = { localStorage }
  try {
    assert.equal(loadInputMode('help'), 'text')
    assert.equal(wasVoicePreferenceBlocked('help'), true)
    globalThis.window.SpeechRecognition = function SpeechRecognition() {}
    globalThis.window.speechSynthesis = {}
    assert.equal(getSpeechSupport().ok, true)
    assert.equal(loadInputMode('support'), 'voice')
    assert.equal(wasVoicePreferenceBlocked('support'), false)
    saveInputMode('help', 'voice')
    saveInputMode('support', 'keyboard')
    assert.equal(store['clemson.help.inputMode'], 'voice')
    assert.equal(store['clemson.support.inputMode'], 'text')
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previousStorage
    restore(previous)
  }
})

test('storage failures fall back to text and do not block', () => {
  const previous = snapshotGlobals()
  const localStorage = {
    getItem() {
      throw new Error('blocked')
    },
    setItem() {
      throw new Error('blocked')
    },
  }
  const previousStorage = globalThis.localStorage
  globalThis.localStorage = localStorage
  globalThis.window = {
    localStorage,
    SpeechRecognition: function SpeechRecognition() {},
    speechSynthesis: {},
  }
  try {
    assert.equal(loadInputMode('help'), 'text')
    assert.equal(wasVoicePreferenceBlocked('help'), false)
    assert.doesNotThrow(() => saveInputMode('help', 'voice'))
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previousStorage
    restore(previous)
  }
})

test('speak strips a ticket draft and caps the utterance at 700 characters', () => {
  const previous = snapshotGlobals()
  const spoken = []
  globalThis.SpeechSynthesisUtterance = class SpeechSynthesisUtterance {
    constructor(text) {
      this.text = text
    }
  }
  globalThis.window = {
    speechSynthesis: {
      cancel() {},
      speak(utterance) {
        spoken.push(utterance)
      },
    },
  }
  try {
    speak(`  Hello rider.\nTICKET_DRAFT:{"subject":"secret"}`)
    assert.equal(spoken.length, 1)
    assert.equal(spoken[0].text, 'Hello rider.')
    assert.equal(spoken[0].lang, 'en-US')
    assert.equal(spoken[0].rate, 1)
    speak('')
    speak(`x${'y'.repeat(800)}TICKET_DRAFT:tail`)
    assert.equal(spoken.length, 2)
    assert.equal(spoken[1].text.length, 700)
  } finally {
    restore(previous)
  }
})

test('createRecognizer emits one trimmed final transcript', () => {
  const previous = snapshotGlobals()
  class FakeRecognition {
    constructor() {
      this.lang = ''
    }
    start() {}
  }
  globalThis.window = {
    SpeechRecognition: FakeRecognition,
  }
  const finals = []
  try {
    const rec = createRecognizer({
      onFinal: (text) => finals.push(text),
      onError: () => {},
      onEnd: () => {},
    })
    assert.equal(rec.lang, 'en-US')
    assert.equal(rec.interimResults, true)
    assert.equal(rec.continuous, false)
    const partialA = [{ transcript: '  gate ' }]
    const partialB = [{ transcript: 'B ' }]
    rec.onresult({ results: [partialA, partialB] })
    assert.deepEqual(finals, [])
    const finalRow = [{ transcript: '  Memorial Stadium  ' }]
    finalRow.isFinal = true
    rec.onresult({ results: [finalRow] })
    assert.deepEqual(finals, ['Memorial Stadium'])
  } finally {
    restore(previous)
  }
})
