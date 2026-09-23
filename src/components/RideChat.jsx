import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { displayFirstName } from '../lib/privacyDisplay'
import {
  fetchCounterpartFirstName,
  fetchTripChat,
  listTripMessages,
  markTripMessagesRead,
  messageLimitForTrip,
  sendTripMessage,
  sendTripQuickReply,
  subscribeTripChatStatus,
  subscribeTripMessages,
} from '../lib/tripMessages'
import {
  RIDE_CHAT_QUICK_REPLIES,
  rideChatBanner,
  rideChatMode,
} from '../lib/tripChatRules'

const TRIP_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function formatStamp(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function upsertMessage(list, row) {
  if (!row?.id) return list
  const patch = Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  )
  const index = list.findIndex((item) => item.id === row.id)
  if (index === -1) {
    if (!patch.body) return list
    return [...list, patch].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  }
  const next = list.slice()
  next[index] = { ...next[index], ...patch }
  return next
}

export function RideMessageButton({ onClick, readOnly = false, disabled = false }) {
  return (
    <button
      type="button"
      className="pressable"
      data-testid="ride-message-button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        minHeight: 48,
        padding: '12px 16px',
        borderRadius: 16,
        background: '#fff',
        color: '#522D80',
        fontWeight: 700,
        fontSize: 16,
        letterSpacing: -0.2,
        border: '1.5px solid rgba(82,45,128,0.45)',
        boxShadow: '0 6px 16px rgba(82,45,128,0.08)',
      }}
    >
      {readOnly ? 'Ride messages' : 'Message'}
    </button>
  )
}

export function RideChat({ tripId, userId, initialTrip = null, onClose }) {
  const [trip, setTrip] = useState(initialTrip)
  const [messages, setMessages] = useState([])
  const [headerName, setHeaderName] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const scrollerRef = useRef(null)
  const markedRef = useRef(new Set())
  const tripRef = useRef(initialTrip)
  tripRef.current = trip

  const mode = rideChatMode(trip)
  const banner = loading && !trip ? null : rideChatBanner(mode)
  const party = Boolean(
    userId && trip && (userId === trip.rider_id || userId === trip.driver_id),
  )
  const counterpartFallback = userId && trip?.rider_id === userId ? 'Driver' : 'Rider'

  const refreshTrip = useCallback(async () => {
    if (!tripId) return null
    const row = await fetchTripChat(tripId)
    if (row) setTrip(row)
    return row
  }, [tripId])

  const refreshMessages = useCallback(async (liveTrip) => {
    const current = liveTrip === undefined ? tripRef.current : liveTrip
    const limit = messageLimitForTrip(current)
    if (!limit) {
      setMessages([])
      return
    }
    const rows = await listTripMessages(tripId, limit)
    setMessages(rows)
  }, [tripId])

  useEffect(() => {
    if (!initialTrip || initialTrip.id !== tripId) return
    setTrip((current) => ({ ...(current || {}), ...initialTrip }))
  }, [initialTrip, tripId])

  useEffect(() => {
    if (!tripId || !TRIP_ID_RE.test(tripId)) {
      setLoading(false)
      setError('This ride chat is unavailable.')
      return undefined
    }
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const row = await refreshTrip()
        if (!alive) return
        const live = row || tripRef.current
        if (live && userId && (userId === live.rider_id || userId === live.driver_id)) {
          const otherId = userId === live.rider_id ? live.driver_id : live.rider_id
          const fallback = userId === live.rider_id ? 'Driver' : 'Rider'
          const name = await fetchCounterpartFirstName(otherId, fallback)
          if (alive) setHeaderName(name)
        }
        if (!alive) return
        await refreshMessages(live)
        if (alive) setError(null)
      } catch (err) {
        if (alive) setError(err.message || 'Could not load messages')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [tripId, userId, refreshTrip, refreshMessages])

  useEffect(() => {
    if (!tripId || !TRIP_ID_RE.test(tripId)) return undefined
    const unsubMessages = subscribeTripMessages(tripId, (payload) => {
      const row = payload?.new
      if (row?.id && row.trip_id === tripId) {
        setMessages((current) => upsertMessage(current, row))
      } else {
        refreshMessages().catch(() => {})
      }
    })
    const unsubTrip = subscribeTripChatStatus(tripId, (row) => {
      if (!row) return
      setTrip((current) => ({ ...(current || {}), ...row }))
    })
    const poll = setInterval(() => {
      refreshTrip()
        .then((row) => refreshMessages(row || tripRef.current))
        .catch(() => {})
    }, 8000)
    return () => {
      unsubMessages()
      unsubTrip()
      clearInterval(poll)
    }
  }, [tripId, refreshMessages, refreshTrip])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, mode])

  useEffect(() => {
    if (!userId || mode === 'closed') return undefined
    const unread = messages.filter(
      (message) => message.sender_id !== userId && !message.read_at && !markedRef.current.has(message.id),
    )
    if (!unread.length) return undefined
    unread.forEach((message) => markedRef.current.add(message.id))
    const ids = unread.map((message) => message.id)
    const readAt = new Date().toISOString()
    setMessages((current) => current.map((message) => (
      ids.includes(message.id) ? { ...message, read_at: message.read_at || readAt } : message
    )))
    markTripMessagesRead(ids).catch(() => {
      ids.forEach((id) => markedRef.current.delete(id))
    })
    return undefined
  }, [messages, userId, mode])

  useEffect(() => {
    if (!trip || !userId || headerName) return undefined
    if (userId !== trip.rider_id && userId !== trip.driver_id) return undefined
    const otherId = userId === trip.rider_id ? trip.driver_id : trip.rider_id
    const fallback = userId === trip.rider_id ? 'Driver' : 'Rider'
    let alive = true
    fetchCounterpartFirstName(otherId, fallback).then((name) => {
      if (alive) setHeaderName(name)
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [trip, userId, headerName])

  const shownName = headerName || counterpartFallback

  async function transmit(body, { quick = false } = {}) {
    if (mode !== 'compose' || sending || !party) return
    setSending(true)
    setError(null)
    try {
      const row = quick
        ? await sendTripQuickReply({ tripId, phrase: body })
        : await sendTripMessage({ tripId, body })
      setMessages((current) => upsertMessage(current, row))
      if (!quick) setDraft('')
    } catch (err) {
      setError(err.message || 'Could not send')
    } finally {
      setSending(false)
    }
  }

  function onSubmit(event) {
    event.preventDefault()
    transmit(draft)
  }

  const chips = useMemo(() => RIDE_CHAT_QUICK_REPLIES, [])

  const panel = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ride messages"
      data-testid="ride-chat"
      data-chat-mode={mode}
      className="fade-in"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 70,
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(120% 80% at 0% 0%, rgba(245,102,0,0.16), transparent 46%), radial-gradient(90% 70% at 100% 0%, rgba(82,45,128,0.16), transparent 42%), #F4F5F8',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px 12px',
          background: 'rgba(255,255,255,0.88)',
          borderBottom: '1px solid rgba(82,45,128,0.08)',
          boxShadow: '0 8px 24px rgba(82,45,128,0.06)',
        }}
      >
        <button
          type="button"
          className="pressable"
          onClick={onClose}
          aria-label="Close messages"
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: '#fff',
            color: '#522D80',
            fontWeight: 700,
            boxShadow: 'var(--shadow-pill)',
          }}
        >
          ←
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, letterSpacing: 1.1, fontWeight: 700, color: '#F56600' }}>
            THIS RIDE
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, color: '#522D80' }}>
            {displayFirstName(shownName, counterpartFallback)}
          </h1>
        </div>
      </header>

      {banner && (
        <div
          data-testid="ride-chat-banner"
          style={{
            margin: '12px 16px 0',
            padding: '10px 12px',
            borderRadius: 14,
            background: 'rgba(82,45,128,0.08)',
            color: '#522D80',
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          {banner}
        </div>
      )}

      <div
        ref={scrollerRef}
        data-testid="ride-chat-log"
        style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}
      >
        {loading && (
          <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>Loading messages…</p>
        )}
        {!loading && !party && (
          <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
            Only the rider and driver on this trip can use this chat.
          </p>
        )}
        {!loading && party && mode === 'closed' && (
          <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>Messages from this ride are hidden.</p>
        )}
        {!loading && party && mode !== 'closed' && messages.length === 0 && (
          <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
            No messages yet.
          </p>
        )}
        {party && mode !== 'closed' && messages.map((message) => {
          const mine = message.sender_id === userId
          return (
            <div
              key={message.id}
              data-testid="ride-message"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: mine ? 'flex-end' : 'flex-start',
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  maxWidth: '78%',
                  padding: '12px 14px',
                  borderRadius: mine ? '20px 20px 6px 20px' : '20px 20px 20px 6px',
                  background: mine ? '#F56600' : '#F3E9FA',
                  color: mine ? '#fff' : '#522D80',
                  fontSize: 16,
                  lineHeight: 1.35,
                  letterSpacing: -0.1,
                  boxShadow: mine
                    ? '0 8px 18px rgba(245,102,0,0.28)'
                    : '0 8px 18px rgba(82,45,128,0.10)',
                  border: mine ? '1px solid rgba(255,255,255,0.28)' : '1px solid rgba(82,45,128,0.10)',
                }}
              >
                {message.body}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-tertiary)', fontWeight: 600 }}>
                {formatStamp(message.created_at)}
                {mine ? ` · ${message.read_at ? 'Read' : 'Sent'}` : ''}
              </div>
            </div>
          )
        })}
      </div>

      {mode === 'compose' && party && (
        <div
          style={{
            padding: '8px 16px calc(14px + var(--safe-bottom))',
            background: 'rgba(255,255,255,0.92)',
            borderTop: '1px solid rgba(82,45,128,0.08)',
          }}
        >
          <div
            data-testid="ride-quick-replies"
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}
          >
            {chips.map((phrase) => (
              <button
                key={phrase}
                type="button"
                className="pressable"
                data-testid="ride-quick-reply"
                disabled={sending}
                onClick={() => transmit(phrase, { quick: true })}
                style={{
                  minHeight: 44,
                  padding: '10px 14px',
                  borderRadius: 999,
                  background: '#fff',
                  color: '#522D80',
                  border: '1.5px solid rgba(245,102,0,0.75)',
                  fontWeight: 700,
                  fontSize: 14,
                  lineHeight: 1.25,
                  textAlign: 'left',
                  boxShadow: '0 4px 12px rgba(245,102,0,0.12)',
                  opacity: sending ? 0.55 : 1,
                }}
              >
                {phrase}
              </button>
            ))}
          </div>
          <form data-testid="ride-chat-composer" onSubmit={onSubmit} style={{ display: 'flex', gap: 8 }}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Message"
              maxLength={500}
              aria-label="Message"
              autoComplete="off"
              enterKeyHint="send"
              style={{
                flex: 1,
                minHeight: 48,
                borderRadius: 16,
                border: '1px solid rgba(82,45,128,0.16)',
                padding: '0 14px',
                background: '#fff',
                color: 'var(--ink)',
              }}
            />
            <button
              type="submit"
              className="pressable"
              disabled={sending || !draft.trim()}
              style={{
                minWidth: 76,
                minHeight: 48,
                borderRadius: 16,
                background: '#F56600',
                color: '#fff',
                fontWeight: 700,
                opacity: sending || !draft.trim() ? 0.5 : 1,
                boxShadow: '0 6px 16px rgba(245,102,0,0.28)',
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}

      {error && (
        <p style={{ color: 'var(--danger)', fontSize: 13, padding: '0 16px 12px', fontWeight: 600 }}>
          {error}
        </p>
      )}
    </div>
  )

  const shell = typeof document !== 'undefined' ? document.querySelector('.app-shell') : null
  if (shell) return createPortal(panel, shell)
  return panel
}
