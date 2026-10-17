import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AdCreative } from '../components/AdCreative'
import { adsRequest } from '../lib/adsApi'
import {
  DEMO_FEED, cacheMedia, flushImpressions, impressionFor, loadFeed, mediaSrc, queueImpression, rememberDeviceToken, saveFeed,
} from '../lib/tabletPlayer'
import '../styles/ads.css'

const FEED_MS = 20_000
const FLUSH_MS = 30_000

/**
 * /tablet?device=<token>  full-screen kiosk for the seat-back tablet (iPad Safari Guided Access or Chrome kiosk).
 * /tablet?demo=1          built-in TEST creatives, no network writes.
 * The feed (rotation loop + the paired driver's in-progress trip) refreshes every 20 s and is cached offline.
 */
export function TabletPlayer({ params = {} }) {
  const demo = params.demo === '1'
  const token = useMemo(() => (demo ? '' : rememberDeviceToken(params.device || '')), [demo, params.device])
  const [feed, setFeed] = useState(() => (demo ? DEMO_FEED : loadFeed()))
  const [error, setError] = useState('')
  const [index, setIndex] = useState(0)
  const [src, setSrc] = useState(null)
  const startedRef = useRef(Date.now())
  const hiddenRef = useRef(false)
  const feedRef = useRef(feed)
  feedRef.current = feed

  useEffect(() => {
    if (demo || !token) return undefined
    let alive = true
    const pull = async () => {
      try {
        const next = await adsRequest('tablet-feed', { auth: false, headers: { 'X-Device-Token': token }, query: params.gameday ? { gameday: params.gameday } : {} })
        if (!alive) return
        setFeed(next)
        saveFeed(next)
        setError('')
        cacheMedia(Object.values(next.creatives || {}).map((c) => c.mediaUrl))
      } catch (err) {
        if (alive) setError(err?.status === 401 ? err.message : '')
      }
    }
    pull()
    const t = window.setInterval(pull, FEED_MS)
    const f = window.setInterval(() => {
      flushImpressions((impressions) => adsRequest('tablet-impressions', { method: 'POST', auth: false, headers: { 'X-Device-Token': token }, body: { impressions } }))
    }, FLUSH_MS)
    return () => { alive = false; window.clearInterval(t); window.clearInterval(f) }
  }, [demo, token, params.gameday])

  // A play only counts as shown when the screen stayed on and the kiosk stayed in front for the slot.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState !== 'visible') hiddenRef.current = true }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    let lock = null
    navigator.wakeLock?.request?.('screen').then((l) => { lock = l }).catch(() => {})
    return () => { lock?.release?.().catch(() => {}) }
  }, [])

  const loop = feed?.loop || []
  const slot = loop.length ? loop[index % loop.length] : null
  const creative = slot ? feed.creatives?.[slot.creativeId] : null

  useEffect(() => {
    let alive = true
    setSrc(null)
    if (creative?.mediaUrl) mediaSrc(creative.mediaUrl).then((u) => { if (alive) setSrc(u) })
    return () => { alive = false }
  }, [creative?.mediaUrl])

  useEffect(() => {
    if (!slot) return undefined
    startedRef.current = Date.now()
    hiddenRef.current = document.visibilityState !== 'visible'
    const timer = window.setTimeout(() => {
      const visible = !hiddenRef.current && document.visibilityState === 'visible'
      if (!demo) queueImpression(impressionFor(slot, { startedAt: startedRef.current, inTrip: Boolean(feedRef.current?.trip), visible }))
      setIndex((i) => i + 1)
    }, slot.seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [slot, index, demo])

  const goFull = () => {
    const el = document.documentElement
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {})
  }

  const view = (
    <div className="tablet" onClick={goFull} data-route="tablet">
      <div className="tablet-stage">
        {creative ? (
          <AdCreative key={`${slot.creativeId}-${index}`} creative={creative} mediaSrc={src} />
        ) : (
          <div className="tablet-idle">
            <img src="/brand/rider-icon.svg" alt="" width="72" height="72" />
            <h1>Clemson Rides</h1>
            <p>{error || (!token && !demo ? 'This tablet is not paired yet. Open the device link from the admin desk.' : 'Local deals will appear here.')}</p>
          </div>
        )}
      </div>
      <div className="tablet-bar">
        <span className="tablet-brand"><img src="/brand/rider-icon.svg" alt="" /> Clemson Rides</span>
        {feed?.gameDay ? <span className="tablet-chip">Game day</span> : null}
        {demo ? <span className="tablet-chip">TEST demo</span> : null}
        <span className="tablet-dots" aria-hidden="true">
          {loop.slice(0, 8).map((s, i) => <span key={`${s.creativeId}-${i}`} aria-current={i === index % Math.max(1, Math.min(8, loop.length)) ? 'true' : undefined} />)}
        </span>
      </div>
    </div>
  )
  // Portal to <body> so the kiosk covers the whole screen, not just the app column.
  return typeof document !== 'undefined' && document.body ? createPortal(view, document.body) : view
}
