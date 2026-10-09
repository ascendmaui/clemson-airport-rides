import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createLocationShare } from '../lib/locationShare'
import { logSosEvent } from '../lib/sos'
import { CUPD_PHONE_DISPLAY, CUPD_PHONE_E164 } from '../../packages/rides-native/safety.js'
import {
  SAFETY_FEATURES,
  driverTrackingCopy,
  failRecording,
  finishRecording,
  idleRecording,
  preferredRecordingMime,
  recordingBlockReason,
  recordingIndicatorLabel,
} from '../../shared/safetyHub.js'

const ACTIVE = ['accepted', 'arriving', 'in_progress']

export function SafetyHub({ userId, role = 'rider' }) {
  const [activeId, setActiveId] = useState('audio')
  const [trip, setTrip] = useState(null)
  const [session, setSession] = useState(idleRecording)
  const [shareUrl, setShareUrl] = useState('')
  const [note, setNote] = useState(null)
  const [sosArmed, setSosArmed] = useState(null)
  const live = useRef(null)
  const feature = SAFETY_FEATURES.find((item) => item.id === activeId) || SAFETY_FEATURES[0]
  const driving = role === 'driver' || role === 'both'

  useEffect(() => {
    if (!supabase || !userId) return undefined
    let alive = true
    supabase
      .from('trips')
      .select('id, status, rider_id, pickup_label, dropoff_label')
      .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
      .in('status', ACTIVE)
      .order('accepted_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setTrip(data || null)
      })
      .catch(() => {
        if (alive) setTrip(null)
      })
    return () => {
      alive = false
    }
  }, [userId])

  useEffect(() => () => {
    const current = live.current
    if (!current) return
    current.stream?.getTracks?.().forEach((track) => track.stop())
    if (current.recorder?.state === 'recording') current.recorder.stop()
  }, [])

  async function startRecording(mode) {
    const blocked = recordingBlockReason({ status: trip?.status, permission: 'unknown', mode })
    if (blocked) {
      setSession(failRecording(session, blocked))
      return
    }
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : null
    const Recorder = typeof window !== 'undefined' ? window.MediaRecorder : null
    if (!mediaDevices?.getUserMedia || !Recorder) {
      setSession(failRecording(session, 'Recording needs a browser that can use the microphone and camera.'))
      return
    }
    try {
      const stream = await mediaDevices.getUserMedia(mode === 'video' ? { audio: true, video: true } : { audio: true })
      const mimeType = preferredRecordingMime(mode, Recorder.isTypeSupported?.bind(Recorder))
      const recorder = mimeType ? new Recorder(stream, { mimeType }) : new Recorder(stream)
      const chunks = []
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size) chunks.push(event.data)
      })
      recorder.start()
      live.current = { recorder, stream, chunks, mode }
      setSession({ phase: 'recording', mode, startedAt: new Date().toISOString(), uri: null, note: null })
      setNote(null)
    } catch (err) {
      const denied = /denied|permission/i.test(err?.message || '') || err?.name === 'NotAllowedError'
      setSession(failRecording(session, denied
        ? (mode === 'video' ? 'Camera access is off. Allow the camera in the browser, then try again.' : 'Microphone access is off. Allow the microphone in the browser, then try again.')
        : (err?.message || 'Could not start recording')))
    }
  }

  function stopRecording() {
    const current = live.current
    if (!current?.recorder) return
    current.recorder.addEventListener('stop', () => {
      const blob = new Blob(current.chunks, { type: current.recorder.mimeType || '' })
      const url = URL.createObjectURL(blob)
      current.stream.getTracks().forEach((track) => track.stop())
      live.current = null
      setSession(finishRecording({ phase: 'recording', mode: current.mode, startedAt: null, uri: null, note: null }, url))
    }, { once: true })
    current.recorder.stop()
  }

  async function onShare() {
    if (!trip?.id || !userId) {
      setNote('Live tracking is available once a ride is accepted.')
      return
    }
    try {
      const share = await createLocationShare(trip.id, trip.rider_id || userId)
      setShareUrl(share.url)
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(share.url)
      setNote('Live link copied. Share it with someone you trust.')
    } catch (err) {
      setNote(err?.message || 'Could not start live tracking')
    }
  }

  async function onSos(channel) {
    if (sosArmed !== channel) {
      setSosArmed(channel)
      setNote('Press again to call. This press does not dial.')
      return
    }
    if (trip?.id && userId) {
      await logSosEvent({ tripId: trip.id, userId, channel }).catch(() => {})
    }
    const href = channel === 'tel_cupd' ? `tel:${CUPD_PHONE_E164}` : 'tel:911'
    window.location.href = href
  }

  return (
    <section style={{ marginTop: 14 }}>
      <div role="tablist" aria-label="Safety features" style={{ display: 'flex', gap: 6, background: 'rgba(82,45,128,0.08)', borderRadius: 16, padding: 4 }}>
        {SAFETY_FEATURES.map((item) => {
          const selected = item.id === feature.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`safety-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`safety-panel-${item.id}`}
              className="pressable"
              onClick={() => setActiveId(item.id)}
              style={{
                flex: 1,
                minHeight: 40,
                borderRadius: 12,
                fontWeight: 800,
                fontSize: 13,
                color: selected ? '#fff' : 'var(--purple)',
                background: selected ? 'var(--orange)' : 'transparent',
              }}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={`safety-panel-${feature.id}`}
        aria-labelledby={`safety-tab-${feature.id}`}
        style={{
          marginTop: 12,
          padding: 16,
          borderRadius: 18,
          background: '#fff',
          border: `1px solid ${feature.id === 'sos' ? 'rgba(176, 38, 38, 0.35)' : 'rgba(245,102,0,0.28)'}`,
        }}
      >
        <div style={{ color: 'var(--orange)', fontWeight: 800, letterSpacing: '0.08em', fontSize: 11 }}>{feature.label.toUpperCase()}</div>
        <h2 style={{ color: 'var(--purple)', fontSize: 22, margin: '6px 0' }}>{feature.title}</h2>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>{feature.body}</p>
        {feature.id === 'audio' || feature.id === 'video' ? (
          <div style={{ marginTop: 12 }}>
            {session.phase === 'recording' && session.mode === feature.id ? (
              <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--orange)', fontWeight: 800, marginBottom: 10 }}>
                <span className="safety-rec-dot" aria-hidden />
                {recordingIndicatorLabel(feature.id)}
              </div>
            ) : null}
            <button
              type="button"
              className="pressable"
              onClick={() => (session.phase === 'recording' && session.mode === feature.id ? stopRecording() : startRecording(feature.id))}
              style={{
                width: '100%',
                minHeight: 48,
                borderRadius: 14,
                fontWeight: 800,
                color: '#fff',
                background: session.phase === 'recording' && session.mode === feature.id ? 'var(--purple)' : 'var(--orange)',
              }}
            >
              {session.phase === 'recording' && session.mode === feature.id ? `Stop ${feature.label.toLowerCase()}` : `Record ${feature.label.toLowerCase()}`}
            </button>
          </div>
        ) : null}
        {feature.id === 'tracking' ? (
          <div style={{ marginTop: 12 }}>
            <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
              {driving ? driverTrackingCopy() : 'Send a live link from this ride. The page updates while the trip is active.'}
            </p>
            {role !== 'driver' ? (
              <button type="button" className="pressable" onClick={onShare} style={actionStyle('var(--purple)')}>
                {shareUrl ? 'Copy live link again' : 'Share live location'}
              </button>
            ) : null}
            {shareUrl ? <p style={{ marginTop: 8, fontSize: 13, wordBreak: 'break-all', color: 'var(--purple)' }}>{shareUrl}</p> : null}
          </div>
        ) : null}
        {feature.id === 'sos' ? (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" className="pressable" onClick={() => onSos('tel_911')} style={actionStyle('#9B1B30')}>
              {sosArmed === 'tel_911' ? 'Confirm call 911' : 'Call 911'}
            </button>
            <button type="button" className="pressable" onClick={() => onSos('tel_cupd')} style={actionStyle('var(--purple)')}>
              {sosArmed === 'tel_cupd' ? `Confirm CUPD ${CUPD_PHONE_DISPLAY}` : `Call Clemson Police ${CUPD_PHONE_DISPLAY}`}
            </button>
          </div>
        ) : null}
        {session.note && (feature.id === 'audio' || feature.id === 'video') ? (
          <p role="status" style={{ marginTop: 10, color: 'var(--ink-secondary)', fontSize: 13 }}>{session.note}</p>
        ) : null}
        {session.uri && session.mode === feature.id ? (
          <a href={session.uri} download={`clemson-rides-${session.mode}`} style={{ display: 'inline-block', marginTop: 8, fontWeight: 800, color: 'var(--purple)' }}>
            Download the clip
          </a>
        ) : null}
        {note ? <p role="status" style={{ marginTop: 10, color: 'var(--purple)', fontWeight: 700, fontSize: 13 }}>{note}</p> : null}
      </div>
      <style>{`
        .safety-rec-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: var(--orange);
          animation: safety-rec-pulse 1.4s ease-in-out infinite;
        }
        @keyframes safety-rec-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .safety-rec-dot { animation: none; opacity: 1; }
        }
      `}</style>
    </section>
  )
}

function actionStyle(background) {
  return {
    width: '100%',
    minHeight: 48,
    marginTop: 10,
    borderRadius: 14,
    fontWeight: 800,
    color: '#fff',
    background,
  }
}
