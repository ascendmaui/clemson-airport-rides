import { useEffect, useRef, useState } from 'react'
import { sendAgentMessage } from './agentChatClient'
import {
  createRecognizer,
  getSpeechSupport,
  loadInputMode,
  saveInputMode,
  speak,
  stopSpeaking,
  wasVoicePreferenceBlocked,
} from './speechMode'

function nextId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function useAssistChat({ scope, endpoint, accountRole, welcome, active }) {
  const [roleVariant, setRoleVariant] = useState(accountRole === 'driver' ? 'driver' : 'rider')
  const [mode, setMode] = useState(() => loadInputMode(scope))
  const [speechNote, setSpeechNote] = useState(() => (
    wasVoicePreferenceBlocked(scope)
      ? 'Voice is not available in this browser. Staying in text.'
      : ''
  ))
  const [messages, setMessages] = useState(() => [{
    id: 'welcome',
    role: 'assistant',
    content: welcome(accountRole === 'driver' ? 'driver' : 'rider'),
  }])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [contextSummary, setContextSummary] = useState('')
  const [notice, setNotice] = useState('')
  const [ticketDraft, setTicketDraft] = useState(null)
  const spoken = useRef(new Set(['welcome']))
  const recognizer = useRef(null)

  useEffect(() => {
    if (accountRole === 'driver') setRoleVariant('driver')
    if (accountRole === 'rider' || accountRole == null || accountRole === '') setRoleVariant('rider')
    const role = accountRole === 'driver' ? 'driver' : 'rider'
    setMessages((current) => {
      if (current.length !== 1 || current[0]?.id !== 'welcome') return current
      return [{ id: 'welcome', role: 'assistant', content: welcome(role) }]
    })
  }, [accountRole, welcome])

  useEffect(() => {
    if (active) return undefined
    stopSpeaking()
    try { recognizer.current?.stop() } catch { /* ignore */ }
    return undefined
  }, [active])

  useEffect(() => () => {
    stopSpeaking()
    try { recognizer.current?.stop() } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!active || mode !== 'voice') return undefined
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || spoken.current.has(last.id) || busy) return undefined
    spoken.current.add(last.id)
    if (getSpeechSupport().synthesis) speak(last.content)
    return undefined
  }, [messages, mode, active, busy])

  function chooseMode(next) {
    if (next === 'voice' && !getSpeechSupport().ok) {
      setMode('text')
      saveInputMode(scope, 'text')
      setSpeechNote('Voice needs speech recognition and speech synthesis. This browser does not have both, so chat stays in text.')
      return
    }
    setSpeechNote('')
    setMode(next)
    saveInputMode(scope, next)
    if (next === 'text') stopSpeaking()
  }

  function switchRole(next) {
    if (accountRole !== 'both') return
    setRoleVariant(next)
    setTicketDraft(null)
    setMessages((current) => [...current, {
      id: nextId(),
      role: 'assistant',
      content: next === 'driver'
        ? 'Driver mode is on for this chat.'
        : 'Rider mode is on for this chat.',
    }])
  }

  async function send(text) {
    const content = String(text || '').trim()
    if (!content || busy) return
    const history = [...messages.filter((message) => message.id !== 'welcome'), { role: 'user', content }]
      .map(({ role, content: value }) => ({ role, content: value }))
    const pendingId = nextId()
    setMessages((current) => [
      ...current,
      { id: nextId(), role: 'user', content },
      { id: pendingId, role: 'assistant', content: 'Looking at your account…' },
    ])
    setDraft('')
    setBusy(true)
    setTicketDraft(null)
    try {
      const result = await sendAgentMessage({
        url: endpoint,
        body: { messages: history, roleVariant },
        onDelta: (visible) => {
          setMessages((current) => current.map((message) => (
            message.id === pendingId ? { ...message, content: visible || '…' } : message
          )))
        },
      })
      setMessages((current) => current.map((message) => (
        message.id === pendingId
          ? { ...message, content: result.reply, actions: result.actions || [] }
          : message
      )))
      setContextSummary(result.contextSummary || '')
      setNotice(result.notice || '')
      setTicketDraft(result.ticketDraft || null)
    } catch (error) {
      setMessages((current) => current.map((message) => (
        message.id === pendingId
          ? { ...message, content: error.message || 'Something went wrong. Try again.' }
          : message
      )))
    } finally {
      setBusy(false)
    }
  }

  function startMic() {
    if (busy || listening) {
      try { recognizer.current?.stop() } catch { /* ignore */ }
      setListening(false)
      return
    }
    const rec = createRecognizer({
      onFinal: (text) => {
        setDraft(text)
        send(text)
      },
      onError: (code) => {
        setListening(false)
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setSpeechNote('Microphone permission is blocked. Stay in text, or allow the mic and try Voice again.')
          chooseMode('text')
        } else if (code !== 'aborted' && code !== 'no-speech') {
          setSpeechNote('Speech recognition stopped. You can keep typing.')
        }
      },
      onEnd: () => setListening(false),
    })
    if (!rec) {
      chooseMode('text')
      return
    }
    recognizer.current = rec
    setListening(true)
    try {
      rec.start()
    } catch {
      setListening(false)
      setSpeechNote('Could not start the microphone. Stay in text.')
    }
  }

  return {
    roleVariant,
    mode,
    speechNote,
    messages,
    draft,
    setDraft,
    busy,
    listening,
    contextSummary,
    notice,
    ticketDraft,
    setTicketDraft,
    setMessages,
    chooseMode,
    switchRole,
    send,
    startMic,
    showRoleToggle: accountRole === 'both',
  }
}
