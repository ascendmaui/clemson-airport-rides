import { useEffect, useState } from 'react'
import { CampusMap, CLEMSON } from '../components/CampusMap'
import { getHashRoute, navigate } from '../lib/navigation'
import { getLiveShare } from '../lib/locationShare'

export function LiveShare({ token: tokenProp = '' } = {}) {
  const routed = getHashRoute()
  const token =
    tokenProp ||
    routed.params.token ||
    (typeof window !== 'undefined'
      ? (() => {
          try {
            return window.sessionStorage.getItem('clemson_live_share_token') || ''
          } catch {
            return ''
          }
        })()
      : '')
  const [state, setState] = useState({ loading: true, data: null, error: null })

  useEffect(() => {
    if (!token) {
      setState({ loading: false, data: null, error: 'Missing share token' })
      return undefined
    }
    let alive = true
    const load = async () => {
      try {
        const data = await getLiveShare(token)
        if (!alive) return
        setState({ loading: false, data, error: null })
      } catch (e) {
        if (!alive) return
        setState({ loading: false, data: null, error: e.message || 'Could not load share' })
      }
    }
    load()
    const id = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [token])

  if (state.loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-secondary)' }}>Loading live location…</div>
  }
  if (state.error) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ color: 'var(--purple)' }}>Share unavailable</h1>
        <p style={{ color: 'var(--danger)' }}>{state.error}</p>
        <button type="button" className="pressable" onClick={() => navigate('landing')}>Home</button>
      </div>
    )
  }

  const d = state.data || {}
  if (!d.ok && d.error === 'not_found') {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ color: 'var(--purple)' }}>Link not found</h1>
        <p style={{ color: 'var(--ink-secondary)' }}>This share link is invalid.</p>
      </div>
    )
  }

  const expired = d.expired || !d.active
  const point = d.point
  const marker = point ? [point.lat, point.lng] : CLEMSON

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ padding: '16px 20px 8px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, color: 'var(--orange)' }}>
          {expired ? 'SHARE ENDED' : 'LIVE · RIDER LOCATION'}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--purple)', marginTop: 4 }}>
          {expired ? 'This live share has expired' : 'Following this ride'}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--ink-secondary)', marginTop: 6 }}>
          {d.pickup_label || 'Pickup'} → {d.dropoff_label || 'Dropoff'}
          {d.trip_status ? ` · ${d.trip_status}` : ''}
        </p>
      </div>
      <div
        data-map="google-campus"
        style={{ flex: 1, minHeight: 360, position: 'relative', padding: '0 16px' }}
      >
        <CampusMap
          height={360}
          interactive
          center={marker}
          zoom={15}
          marker={marker}
          selfPosition={marker}
        />
      </div>
      {!expired && (
        <p style={{ padding: 16, fontSize: 12, color: 'var(--ink-tertiary)', textAlign: 'center' }}>
          Updates every few seconds while the ride is active.
          {point?.recorded_at ? ` Last ping ${new Date(point.recorded_at).toLocaleTimeString()}.` : ' Waiting for first GPS ping…'}
        </p>
      )}
    </div>
  )
}
