const KEYS = {
  help: 'clemson.help.inputMode',
  support: 'clemson.support.inputMode',
}

export function getSpeechSupport() {
  if (typeof window === 'undefined') {
    return { recognition: false, synthesis: false, ok: false }
  }
  const recognition = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  const synthesis = typeof window.speechSynthesis !== 'undefined'
  return { recognition, synthesis, ok: recognition && synthesis }
}

export function loadInputMode(scope) {
  if (typeof window === 'undefined') return 'text'
  const speech = getSpeechSupport()
  try {
    const saved = localStorage.getItem(KEYS[scope] || KEYS.help)
    if (saved === 'voice' && speech.ok) return 'voice'
  } catch {
    /* ignore */
  }
  return 'text'
}

export function saveInputMode(scope, mode) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEYS[scope] || KEYS.help, mode === 'voice' ? 'voice' : 'text')
  } catch {
    /* ignore */
  }
}

export function wasVoicePreferenceBlocked(scope) {
  if (typeof window === 'undefined') return false
  if (getSpeechSupport().ok) return false
  try {
    return localStorage.getItem(KEYS[scope] || KEYS.help) === 'voice'
  } catch {
    return false
  }
}

export function createRecognizer({ onFinal, onError, onEnd }) {
  if (typeof window === 'undefined') return null
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = 'en-US'
  rec.interimResults = true
  rec.continuous = false
  rec.onresult = (event) => {
    let text = ''
    let isFinal = false
    for (let i = 0; i < event.results.length; i += 1) {
      text += event.results[i][0]?.transcript || ''
      if (event.results[i].isFinal) isFinal = true
    }
    if (isFinal && text.trim()) onFinal(text.trim())
  }
  rec.onerror = (event) => onError?.(event?.error || 'speech-error')
  rec.onend = () => onEnd?.()
  return rec
}

export function speak(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const clean = String(text || '').replace(/TICKET_DRAFT:[\s\S]*$/, '').trim()
  if (!clean) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(clean.slice(0, 700))
  utterance.lang = 'en-US'
  utterance.rate = 1
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel()
  }
}
