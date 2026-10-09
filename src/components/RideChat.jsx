import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { displayFirstName } from '../lib/privacyDisplay'
import {
  fetchCounterpartFirstName,
  fetchLostItemReport,
  fetchTripChat,
  listTripMessages,
  markTripMessagesRead,
  messageLimitForTrip,
  notifyTripMessage,
  resolveLostItemReport,
  sendTripMessage,
  sendTripQuickReply,
  subscribeLostItemReports,
  subscribeTripChatStatus,
  subscribeTripMessages,
  unreadCountForTrip,
} from '../lib/tripMessages'
import { chatOpenLine } from '../../shared/copy/messaging.js'
import { MessagingInfoButton } from './MessagingInfo'
import { supabase } from '../lib/supabase'
import { authedJson } from '../lib/apiClient'
import {
  buildChatModerationTicket, chatBlockKey, createChatBlockStore,
  CHAT_BLOCK_COPY, CHAT_REPORT_CONFIRMATION, CHAT_REPORT_REASONS, CHAT_SUPPORT_COPY,
} from '../../packages/rides-native/chatModeration.js'
import {
  RIDE_CHAT_QUICK_REPLIES,
  lostItemReportState,
  rideChatBanner,
  rideChatMode,
} from '../lib/tripChatRules'

const TRIP_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const blockStore = createChatBlockStore({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
})

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

function useChatTone() {
  const [dark, setDark] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ))
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const onChange = () => setDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  if (dark) {
    return {
      canvas: '#0E0B14',
      header: '#16121F',
      title: '#F5F6F8',
      ink: '#F5F6F8',
      mine: '#F56600',
      mineText: '#fff',
      theirs: '#1E192A',
      theirsText: '#F5F6F8',
      input: '#120E18',
      chip: '#1E192A',
      composer: '#16121F',
    }
  }
  return {
    canvas: '#F4F5F8',
    header: 'rgba(255,255,255,0.88)',
    title: '#522D80',
    ink: '#0B1220',
    mine: '#F56600',
    mineText: '#fff',
    theirs: '#F3E9FA',
    theirsText: '#522D80',
    input: '#fff',
    chip: '#fff',
    composer: 'rgba(255,255,255,0.92)',
  }
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

export function RideMessageButton({ onClick, readOnly = false, disabled = false, tripId = null, userId = null }) {
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    if (!tripId || !userId) return undefined
    let alive = true
    const load = () => {
      unreadCountForTrip(tripId, userId)
        .then((count) => { if (alive) setUnread(count) })
        .catch(() => {})
    }
    load()
    const unsub = subscribeTripMessages(tripId, load)
    return () => {
      alive = false
      unsub()
    }
  }, [tripId, userId])
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
        background: 'var(--surface, #fff)',
        color: '#522D80',
        fontWeight: 700,
        fontSize: 16,
        letterSpacing: -0.2,
        border: '1.5px solid rgba(82,45,128,0.45)',
        boxShadow: '0 6px 16px rgba(82,45,128,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      {readOnly ? 'Ride messages' : 'Message'}
      {unread > 0 ? (
        <span
          data-testid="ride-message-unread"
          style={{
            minWidth: 22,
            height: 22,
            borderRadius: 11,
            padding: '0 6px',
            background: '#F56600',
            color: '#fff',
            fontSize: 12,
            lineHeight: '22px',
          }}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </button>
  )
}

export function RideChat({ tripId, userId, initialTrip = null, onClose }) {
  const [trip, setTrip] = useState(initialTrip)
  const [messages, setMessages] = useState([])
  const [report, setReport] = useState(null)
  const [headerName, setHeaderName] = useState('')
  const tone = useChatTone()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [blockState, setBlockState] = useState(null)
  const [moderationTarget, setModerationTarget] = useState(null)
  const [reason, setReason] = useState(CHAT_REPORT_REASONS[0])
  const [moderationNotice, setModerationNotice] = useState('')
  const scrollerRef = useRef(null)
  const markedRef = useRef(new Set())
  const tripRef = useRef(initialTrip)
  const reportRef = useRef(null)
  tripRef.current = trip
  reportRef.current = report

  const mode = rideChatMode(trip, Date.now(), report)
  const banner = loading && !trip
    ? null
    : (rideChatBanner(mode, report) ?? (mode === 'compose' ? chatOpenLine() : null))
  const party = Boolean(
    userId && trip && (userId === trip.rider_id || userId === trip.driver_id),
  )
  const infoRole = userId && trip?.driver_id === userId ? 'driver' : 'rider'
  const counterpartFallback = userId && trip?.rider_id === userId ? 'Driver' : 'Rider'
  const otherUserId = party ? (infoRole === 'rider' ? trip.driver_id : trip.rider_id) : null
  const blockKey = userId && otherUserId ? chatBlockKey(userId, otherUserId) : null
  const blockReady = Boolean(blockKey && blockState?.key === blockKey)
  const blocked = blockReady && blockState.blocked
  const visibleMessages = messages.filter((message) => message.sender_id === userId || (blockReady && !blocked))

  useEffect(() => {
    if (!blockKey) return undefined
    let alive = true
    const update = (key, value) => {
      if (alive && key === blockKey) setBlockState({ key, blocked: value })
    }
    const unsubscribe = blockStore.subscribe(update)
    blockStore.isBlocked(userId, otherUserId)
      .then((value) => update(blockKey, value))
      .catch(() => { if (alive) setError(`Could not load blocked users. Reopen this chat to retry. ${CHAT_SUPPORT_COPY}`) })
    return () => { alive = false; unsubscribe() }
  }, [blockKey, userId, otherUserId])

  const refreshTrip = useCallback(async () => {
    if (!tripId) return null
    const row = await fetchTripChat(tripId)
    if (row) setTrip(row)
    return row
  }, [tripId])

  const refreshMessages = useCallback(async (liveTrip) => {
    const current = liveTrip === undefined ? tripRef.current : liveTrip
    const limit = messageLimitForTrip(current, Date.now(), reportRef.current)
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
        const lost = await fetchLostItemReport(tripId).catch(() => null)
        if (!alive) return
        setReport(lost)
        reportRef.current = lost
        const live = row || tripRef.current
        if (live && userId && (userId === live.rider_id || userId === live.driver_id)) {
          const otherId = userId === live.rider_id ? live.driver_id : live.rider_id
          const fallback = userId === live.rider_id ? 'Driver' : 'Rider'
          const name = await fetchCounterpartFirstName(otherId, fallback)
          if (alive) setHeaderName(name)
        }
        if (!alive) return
        await refreshMessages(live)
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
    const unsubLost = subscribeLostItemReports((payload) => {
      const next = payload?.new
      if (next?.trip_id && next.trip_id !== tripId) return
      fetchLostItemReport(tripId)
        .then((lost) => {
          setReport(lost)
          reportRef.current = lost
        })
        .catch(() => {})
    })
    const poll = setInterval(() => {
      refreshTrip()
        .then((row) => refreshMessages(row || tripRef.current))
        .catch(() => {})
    }, 8000)
    return () => {
      unsubMessages()
      unsubTrip()
      unsubLost()
      clearInterval(poll)
    }
  }, [tripId, refreshMessages, refreshTrip])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, mode])

  useEffect(() => {
    if (!userId || mode === 'closed' || !blockReady || blocked) return undefined
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
  }, [messages, userId, mode, blockReady, blocked])

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

  async function fileModeration(action, message = null) {
    if (sending || !party || !otherUserId) return
    setSending(true)
    setError(null)
    setModerationNotice('')
    let locallyBlocked = false
    try {
      if (action === 'block') {
        await blockStore.setBlocked(userId, otherUserId, true)
        locallyBlocked = true
        setDraft('')
      }
      const result = await authedJson(supabase, '/api/support-ticket', {
        method: 'POST',
        body: buildChatModerationTicket({
          tripId, roleVariant: infoRole, reportedRole: infoRole === 'rider' ? 'driver' : 'rider',
          reportedUserId: otherUserId, reason: action === 'report' ? reason : undefined,
          message, action,
        }),
      })
      if (!result?.ticket?.id) throw new Error('Could not confirm the support ticket')
      setModerationNotice(`${action === 'block' ? 'Blocked on this device. ' : ''}${CHAT_REPORT_CONFIRMATION} ${CHAT_SUPPORT_COPY}`)
    } catch (err) {
      setError(`${locallyBlocked ? 'Blocked on this device, but the support ticket failed. Use Report to retry. ' : ''}${err.message || 'Could not file the support ticket'}. ${CHAT_SUPPORT_COPY}`)
    } finally {
      setSending(false)
    }
  }

  function confirmReport(event) {
    event.preventDefault()
    if (!window.confirm(`Report trip chat? ${reason}. Submit for review? ${CHAT_SUPPORT_COPY}`)) return
    const message = moderationTarget?.message || null
    setModerationTarget(null)
    void fileModeration('report', message)
  }

  async function confirmBlock() {
    if (!window.confirm(blocked ? `Unblock this person? Their messages will be visible and you can send again while chat is open. ${CHAT_SUPPORT_COPY}` : `Block this person? ${CHAT_BLOCK_COPY}`)) return
    if (!blocked) { await fileModeration('block'); return }
    setSending(true)
    try {
      await blockStore.setBlocked(userId, otherUserId, false)
      setError(null)
      setModerationNotice('Unblocked on this device.')
    } catch {
      setError(`Could not unblock. Try again. ${CHAT_SUPPORT_COPY}`)
    } finally {
      setSending(false)
    }
  }

  async function transmit(body, { quick = false } = {}) {
    if (mode !== 'compose' || sending || !party || !blockReady || blocked) return
    setSending(true)
    setError(null)
    try {
      const row = quick
        ? await sendTripQuickReply({ tripId, phrase: body })
        : await sendTripMessage({ tripId, body })
      setMessages((current) => upsertMessage(current, row))
      if (!quick) setDraft('')
      if (row?.id) notifyTripMessage({ tripId, messageId: row.id })
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
          `radial-gradient(120% 80% at 0% 0%, rgba(245,102,0,0.16), transparent 46%), radial-gradient(90% 70% at 100% 0%, rgba(82,45,128,0.16), transparent 42%), ${tone.canvas}`,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px 12px',
          background: tone.header,
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
          <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, color: tone.title }}>
            {displayFirstName(shownName, counterpartFallback)}
          </h1>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <MessagingInfoButton role={infoRole} />
        </div>
      </header>

      {party && otherUserId && (
        <div style={{ display: 'flex', gap: 16, padding: '0 16px' }}>
          <button type="button" className="pressable" disabled={sending} onClick={() => { setReason(CHAT_REPORT_REASONS[0]); setModerationTarget({ message: null }) }} style={{ minHeight: 44, color: tone.title }}>Report</button>
          <button type="button" className="pressable" disabled={sending || !blockReady} onClick={confirmBlock} style={{ minHeight: 44, color: tone.title }}>{blocked ? 'Unblock' : 'Block'}</button>
        </div>
      )}
      {moderationTarget && (
        <form onSubmit={confirmReport} aria-label="Report trip chat" style={{ padding: 16, color: tone.ink }}>
          <label htmlFor="chat-report-reason">Reason for reporting</label>
          <select id="chat-report-reason" value={reason} onChange={(event) => setReason(event.target.value)} style={{ minHeight: 44, margin: 8 }}>
            {CHAT_REPORT_REASONS.map((option) => <option key={option}>{option}</option>)}
          </select>
          <button type="submit" disabled={sending} style={{ minHeight: 44, color: tone.title }}>Report</button>
          <button type="button" onClick={() => setModerationTarget(null)} style={{ minHeight: 44, marginLeft: 16, color: tone.title }}>Cancel</button>
          <p>{CHAT_SUPPORT_COPY}</p>
        </form>
      )}
      {blocked && <p role="status" style={{ padding: '8px 16px', color: tone.ink }}>Blocked on this device. Their messages are hidden and sending is disabled. {CHAT_SUPPORT_COPY}</p>}
      {moderationNotice && <p role="status" style={{ padding: '8px 16px', color: tone.ink }}>{moderationNotice}</p>}

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

      {party && lostItemReportState(report) === 'open' && (
        <div style={{ margin: '12px 16px 0' }}>
          <button
            type="button"
            className="pressable"
            data-testid="resolve-lost-item"
            disabled={sending}
            onClick={() => {
              if (!report?.id) return
              setSending(true)
              resolveLostItemReport(report.id)
                .then(() => fetchLostItemReport(tripId))
                .then((lost) => {
                  setReport(lost)
                  reportRef.current = lost
                })
                .catch((err) => setError(err.message || 'Could not resolve this thread'))
                .finally(() => setSending(false))
            }}
            style={{ minHeight: 44, fontWeight: 800, color: '#522D80' }}
          >
            Mark resolved
          </button>
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
        {!loading && party && blockReady && !blocked && mode !== 'closed' && visibleMessages.length === 0 && (
          <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
            No messages yet.
          </p>
        )}
        {party && mode !== 'closed' && visibleMessages.map((message) => {
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
                  background: mine ? tone.mine : tone.theirs,
                  color: mine ? tone.mineText : tone.theirsText,
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
              {!mine && <button type="button" disabled={sending} aria-label="Report this message" onClick={() => { setReason(CHAT_REPORT_REASONS[0]); setModerationTarget({ message }) }} style={{ minHeight: 44, color: tone.title }}>Report</button>}
            </div>
          )
        })}
      </div>

      {mode === 'compose' && party && blockReady && !blocked && (
        <div
          style={{
            padding: '8px 16px calc(14px + var(--safe-bottom))',
            background: tone.composer,
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
                  background: tone.chip,
                  color: tone.title,
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
                background: tone.input,
                color: tone.ink,
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
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, padding: '0 16px 12px', fontWeight: 600 }}>
          {error}
        </p>
      )}
    </div>
  )

  const shell = typeof document !== 'undefined' ? document.querySelector('.app-shell') : null
  if (shell) return createPortal(panel, shell)
  return panel
}
