import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../lib/auth'
import { fetchRecentSosEvents, logSosEvent, readLivePosition, subscribeSosEvents } from '../lib/sos'
import {
  buildSosText,
  isActiveRideStatus,
  shareSosText,
  sosChannelButton,
  sosChannelHref,
  sosChannelPhrase,
} from '../lib/sosAlert'
import { supabase } from '../lib/supabase'

const ALERT_CHANNELS = ['tel_911', 'tel_cupd', 'sms', 'mailto', 'web_share']
const HOLD_MS = 1100
const SLIDE_RATIO = 0.92

function otherPartyLabel(viewerRole) {
  return viewerRole === 'driver' ? 'rider' : 'driver'
}

export function SosControl({
  tripId,
  viewerRole = 'rider',
  knownActive = false,
  insetTop = 16,
}) {
  const { user } = useAuth()
  const [shell, setShell] = useState(null)
  const [visible, setVisible] = useState(knownActive)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState('confirm')
  const [coords, setCoords] = useState(null)
  const [locating, setLocating] = useState(false)
  const [logError, setLogError] = useState(null)
  const [shareNote, setShareNote] = useState(null)
  const [events, setEvents] = useState([])
  const [dismissedId, setDismissedId] = useState(null)
  const [busyChannel, setBusyChannel] = useState(null)
  const activatedRef = useRef(false)
  const coordsRef = useRef(null)
  const headingRef = useRef(null)

  function rememberCoords(pos) {
    if (!pos) return
    coordsRef.current = pos
    setCoords(pos)
  }

  useEffect(() => {
    setShell(document.querySelector('.app-shell'))
  }, [])

  useEffect(() => {
    if (knownActive) {
      setVisible(true)
      return undefined
    }
    if (!tripId || !supabase) {
      setVisible(false)
      return undefined
    }
    let alive = true
    async function load() {
      const { data } = await supabase.from('trips').select('status').eq('id', tripId).maybeSingle()
      if (!alive) return
      setVisible(isActiveRideStatus(data?.status))
    }
    load()
    const timer = setInterval(load, 8000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [knownActive, tripId])

  useEffect(() => {
    if (!visible || !tripId) return undefined
    let alive = true
    fetchRecentSosEvents(tripId).then((rows) => {
      if (alive) setEvents(rows)
    })
    const stop = subscribeSosEvents(tripId, (row) => {
      setEvents((prev) => (prev.some((event) => event.id === row.id) ? prev : [row, ...prev]))
    })
    const timer = setInterval(() => {
      fetchRecentSosEvents(tripId).then((rows) => {
        if (alive) setEvents(rows)
      })
    }, 8000)
    return () => {
      alive = false
      stop()
      clearInterval(timer)
    }
  }, [visible, tripId])

  useEffect(() => {
    if (!open) return undefined
    headingRef.current?.focus()
    let alive = true
    readLivePosition(8000).then((pos) => {
      if (alive && pos) rememberCoords(pos)
    })
    return () => {
      alive = false
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function onActivate() {
    if (activatedRef.current) {
      setPhase('channels')
      return
    }
    activatedRef.current = true
    setLogError(null)
    setLocating(true)
    let pos = coordsRef.current
    if (!pos) {
      pos = await readLivePosition(2500)
      rememberCoords(pos)
    }
    setLocating(false)
    setPhase('channels')
    const result = await logSosEvent({
      tripId,
      userId: user?.id,
      lat: pos?.lat,
      lng: pos?.lng,
      channel: 'banner',
    })
    if (!result.ok) setLogError(result.error)
  }

  function onChannel(channel) {
    if (busyChannel) return
    const pos = coordsRef.current
    setBusyChannel(channel)
    setShareNote(null)
    const text = buildSosText({ lat: pos?.lat, lng: pos?.lng, tripId })
    const href = sosChannelHref(channel, text)
    const pending = logSosEvent({
      tripId,
      userId: user?.id,
      lat: pos?.lat,
      lng: pos?.lng,
      channel,
    })
    pending.then((result) => {
      if (!result.ok) setLogError(result.error)
    })
    if (channel === 'web_share') {
      shareSosText(text)
        .then((note) => {
          if (note === 'shared') setShareNote('Location shared.')
          else if (note === 'copied') setShareNote('Location copied. Paste it into a message.')
          else if (note === 'unavailable') setShareNote('Share is unavailable on this device. Use call or text.')
        })
        .catch((err) => setShareNote(err?.message || 'Could not share'))
        .finally(() => setBusyChannel(null))
      return
    }
    if (href) window.location.href = href
    setBusyChannel(null)
  }

  if (!visible || !shell) return null

  const incoming = events.find((event) => event.user_id && event.user_id !== user?.id)
  const showBanner = Boolean(incoming && incoming.id !== dismissedId)
  const party = otherPartyLabel(viewerRole)
  const locationLine = coords
    ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
    : phase === 'channels'
      ? 'GPS unavailable. You can still call.'
      : 'Waiting for GPS… you can still call.'

  return createPortal(
    <div className="sos-layer" style={{ pointerEvents: 'none' }}>
      {showBanner && (
        <div className="sos-banner" style={{ top: insetTop + 72 }} role="status">
          <div className="sos-banner-kicker">SOS</div>
          <div className="sos-banner-copy">
            <strong>Your {party} {sosChannelPhrase(incoming.channel)}</strong>
            <span>
              Trip {String(incoming.trip_id || tripId).slice(0, 8)}
              {Number.isFinite(incoming.lat) && Number.isFinite(incoming.lng)
                ? ` · ${Number(incoming.lat).toFixed(4)}, ${Number(incoming.lng).toFixed(4)}`
                : ''}
            </span>
          </div>
          <button
            type="button"
            className="sos-banner-dismiss"
            onClick={() => setDismissedId(incoming.id)}
            aria-label="Dismiss SOS banner"
          >
            ×
          </button>
        </div>
      )}

      <button
        type="button"
        className="sos-fab"
        style={{ top: `calc(${insetTop}px + env(safe-area-inset-top, 0px))` }}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true)
          setPhase(activatedRef.current ? 'channels' : 'confirm')
        }}
      >
        SOS
      </button>

      {open && (
        <div
          className="sos-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div
            className="sos-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sos-heading"
          >
            <div className="sos-sheet-bar" />
            <h2 id="sos-heading" ref={headingRef} tabIndex={-1} className="sos-heading">
              Emergency SOS
            </h2>
            {phase === 'confirm' ? (
              <>
                <p className="sos-copy">
                  This does not call anyone yet. Slide or press and hold to alert your {party} in the app,
                  then choose 911 or Clemson Police. Your GPS and trip id go with the alert.
                </p>
                <p className="sos-meta">{locating ? 'Getting your location…' : locationLine}</p>
                <SlideToConfirm onConfirm={onActivate} disabled={locating} />
                <HoldToConfirm onConfirm={onActivate} disabled={locating} />
                <button type="button" className="sos-cancel" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <p className="sos-copy">
                  Your {party} sees an in-app SOS banner. Pick a way to reach help. Each choice is logged.
                </p>
                <p className="sos-meta">{locationLine}</p>
                <div className="sos-actions">
                  {ALERT_CHANNELS.map((channel) => {
                    const button = sosChannelButton(channel)
                    const text = buildSosText({ lat: coords?.lat, lng: coords?.lng, tripId })
                    const href = sosChannelHref(channel, text)
                    const primary = channel === 'tel_911'
                    if (href) {
                      return (
                        <a
                          key={channel}
                          className={primary ? 'sos-action sos-action--primary' : 'sos-action'}
                          href={href}
                          onClick={(e) => {
                            e.preventDefault()
                            onChannel(channel)
                          }}
                        >
                          <span>{busyChannel === channel ? 'Opening…' : button.title}</span>
                          <small>{button.detail}</small>
                        </a>
                      )
                    }
                    return (
                      <button
                        key={channel}
                        type="button"
                        className="sos-action"
                        onClick={() => onChannel(channel)}
                      >
                        <span>{busyChannel === channel ? 'Opening…' : button.title}</span>
                        <small>{button.detail}</small>
                      </button>
                    )
                  })}
                </div>
                {shareNote && <p className="sos-meta">{shareNote}</p>}
                {logError && (
                  <p className="sos-log-error">
                    Could not save the SOS log ({logError}). You can still call 911.
                  </p>
                )}
                <button type="button" className="sos-cancel" onClick={() => setOpen(false)}>
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>,
    shell,
  )
}

function SlideToConfirm({ onConfirm, disabled }) {
  const trackRef = useRef(null)
  const xRef = useRef(0)
  const dragging = useRef(false)
  const [x, setX] = useState(0)

  function maxTravel() {
    const track = trackRef.current
    if (!track) return 0
    return Math.max(0, track.clientWidth - 56)
  }

  function setPos(next) {
    xRef.current = next
    setX(next)
  }

  function onPointerDown(e) {
    if (disabled) return
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e) {
    if (!dragging.current || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const max = maxTravel()
    const next = Math.min(max, Math.max(0, e.clientX - rect.left - 28))
    setPos(next)
  }

  function finish() {
    if (!dragging.current) return
    dragging.current = false
    const max = maxTravel()
    if (max > 0 && xRef.current >= max * SLIDE_RATIO) {
      setPos(max)
      onConfirm()
      return
    }
    setPos(0)
  }

  const max = maxTravel()
  const pct = max > 0 ? Math.round((x / max) * 100) : 0

  return (
    <div
      ref={trackRef}
      className="sos-slide"
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="Slide to alert"
    >
      <span className="sos-slide-label">Slide to alert</span>
      <span
        className="sos-slide-thumb"
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        SOS
      </span>
    </div>
  )
}

function HoldToConfirm({ onConfirm, disabled }) {
  const frame = useRef(0)
  const start = useRef(0)
  const [progress, setProgress] = useState(0)
  const done = useRef(false)

  function stop(reset) {
    cancelAnimationFrame(frame.current)
    if (reset) setProgress(0)
  }

  function begin() {
    if (disabled) return
    done.current = false
    start.current = performance.now()
    stop(false)
    const tick = (now) => {
      const next = Math.min(1, (now - start.current) / HOLD_MS)
      setProgress(next)
      if (next >= 1) {
        if (!done.current) {
          done.current = true
          onConfirm()
        }
        return
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  return (
    <button
      type="button"
      className="sos-hold"
      disabled={disabled}
      aria-disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        begin()
      }}
      onPointerUp={() => stop(true)}
      onPointerCancel={() => stop(true)}
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return
        e.preventDefault()
        if (e.repeat) return
        begin()
      }}
      onKeyUp={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return
        stop(true)
      }}
      onBlur={() => stop(true)}
    >
      <span className="sos-hold-fill" style={{ width: `${progress * 100}%` }} />
      <span className="sos-hold-label">Press and hold to alert</span>
    </button>
  )
}
