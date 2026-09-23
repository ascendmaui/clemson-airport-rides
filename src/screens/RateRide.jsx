import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import {
  fetchTripForRating,
  submitRating,
  hasRatedTrip,
  fetchProfile,
  ratingBlockReason,
} from '../lib/ratings'
import { PrimaryButton } from '../components/PrimaryButton'
import { RequireAuth } from '../components/RequireAuth'

function RateForm() {
  const { user } = useAuth()
  const { params } = getHashRoute()
  const tripId = params.trip
  const [trip, setTrip] = useState(null)
  const [counterpart, setCounterpart] = useState(null)
  const [stars, setStars] = useState(5)
  const [comment, setComment] = useState('')
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [already, setAlready] = useState(false)
  const [busy, setBusy] = useState(false)
  const [skipped, setSkipped] = useState(false)

  useEffect(() => {
    if (!tripId || !user?.id) return
    let alive = true
    ;(async () => {
      try {
        const t = await fetchTripForRating(tripId)
        if (!alive) return
        setTrip(t)
        if (!t) {
          setError('Trip not found')
          return
        }
        const rated = await hasRatedTrip(tripId, user.id)
        if (!alive) return
        if (rated) {
          setAlready(true)
          setDone(true)
          return
        }
        const rateeId = user.id === t.rider_id ? t.driver_id : t.rider_id
        if (rateeId) {
          const p = await fetchProfile(rateeId, { viewerId: user.id, assumeMatched: true })
          if (alive) setCounterpart(p)
        }
      } catch (e) {
        if (alive) setError(e.message)
      }
    })()
    return () => {
      alive = false
    }
  }, [tripId, user?.id])

  if (!tripId) return <div style={{ padding: 24 }}>Missing trip</div>
  if (!trip && !error) return <div style={{ padding: 40, textAlign: 'center' }}>Loading…</div>

  const isRider = user?.id === trip?.rider_id
  const rateeId = isRider ? trip?.driver_id : trip?.rider_id
  const label = isRider ? 'Rate your driver' : 'Rate your rider'
  const sideHint = isRider ? 'Drivers see this on their profile' : 'Riders see this on their profile'
  const blockReason = ratingBlockReason(trip, user?.id)

  async function onSubmit(e) {
    e.preventDefault()
    if (blockReason) {
      setError(blockReason)
      return
    }
    if (!rateeId) {
      setError('No counterparty on this trip yet')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await submitRating({ tripId, raterId: user.id, rateeId, stars, comment })
      setDone(true)
    } catch (err) {
      setError(err.message || 'Could not submit rating')
    } finally {
      setBusy(false)
    }
  }

  function onSkip() {
    setSkipped(true)
  }

  if (skipped) {
    return (
      <div className="fade-in" style={{ padding: 24, maxWidth: 420, margin: '0 auto' }}>
        <div
          className="glass-panel"
          style={{
            padding: 20,
            borderRadius: 20,
            background: 'linear-gradient(145deg, rgba(245,102,0,0.12), rgba(82,45,128,0.12))',
          }}
        >
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--purple)' }}>All good — soft remind later</h1>
          <p style={{ color: 'var(--ink-secondary)', marginTop: 8, lineHeight: 1.45, fontSize: 14 }}>
            We’ll nudge you from Account when you have a pending rating. Both riders and drivers can rate —
            aggregates update live on profiles.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            <PrimaryButton onClick={() => setSkipped(false)}>Actually, rate now ★</PrimaryButton>
            <button
              type="button"
              className="pressable"
              onClick={() => navigate(isRider ? 'home' : 'driver')}
              style={{ fontWeight: 600, color: 'var(--ink-secondary)', padding: 12 }}
            >
              Skip for now
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="fade-in" style={{ padding: 24, maxWidth: 420, margin: '0 auto' }}>
        <div className="glass-panel glass-panel--elevated" style={{ padding: 22, borderRadius: 22 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>★</div>
          <h1 style={{ color: 'var(--purple)', fontSize: 24, fontWeight: 800 }}>
            {already ? 'Already rated' : 'Thanks for the rating'}
          </h1>
          <p style={{ color: 'var(--ink-secondary)', marginTop: 8, marginBottom: 16, fontSize: 14 }}>
            {already
              ? 'Your stars are already on their profile aggregate.'
              : 'Rating saved — profile rating_avg / rating_count refresh automatically.'}
          </p>
          {rateeId && (
            <button
              type="button"
              className="pressable"
              onClick={() => navigate('profile', { id: rateeId, matched: '1' })}
              style={{ display: 'block', marginBottom: 12, fontWeight: 700, color: 'var(--purple)' }}
            >
              View their profile →
            </button>
          )}
          <PrimaryButton onClick={() => navigate(isRider ? 'home' : 'driver')}>Done</PrimaryButton>
        </div>
      </div>
    )
  }

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 420, margin: '0 auto' }}>
      <div
        className="glass-panel glass-panel--elevated"
        style={{
          padding: 22,
          borderRadius: 22,
          background:
            'linear-gradient(165deg, rgba(255,255,255,0.85), rgba(82,45,128,0.08), rgba(245,102,0,0.10))',
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: 1.2, fontWeight: 700, color: 'var(--orange)' }}>
          BOTH SIDES RATE
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--purple)', marginTop: 4 }}>{label}</h1>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 6, marginBottom: 4, fontSize: 14 }}>
          {trip?.pickup_label} → {trip?.dropoff_label}
        </p>
        <p style={{ color: 'var(--ink-tertiary)', fontSize: 12, marginBottom: 14 }}>{sideHint}</p>

        {counterpart && (
          <button
            type="button"
            className="pressable"
            onClick={() => navigate('profile', { id: counterpart.id, matched: '1' })}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              width: '100%',
              padding: 12,
              borderRadius: 16,
              marginBottom: 16,
              background: 'rgba(255,255,255,0.55)',
              border: '1px solid rgba(82,45,128,0.12)',
              textAlign: 'left',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: counterpart.avatar_url
                  ? `url(${counterpart.avatar_url}) center/cover`
                  : 'linear-gradient(135deg, var(--orange), var(--purple))',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
              }}
            >
              {!counterpart.avatar_url && (counterpart.full_name || '?').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--purple)' }}>
                {counterpart.full_name || 'Counterpart'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>View profile</div>
            </div>
          </button>
        )}

        <form onSubmit={onSubmit}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, justifyContent: 'center' }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className="pressable"
                onClick={() => setStars(n)}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  fontSize: 22,
                  background: n <= stars ? 'var(--orange)' : 'rgba(0,0,0,0.06)',
                  color: n <= stars ? '#fff' : 'var(--ink-secondary)',
                  boxShadow: n <= stars ? '0 6px 16px rgba(245,102,0,0.35)' : 'none',
                }}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment"
            rows={3}
            style={{
              width: '100%',
              padding: 12,
              borderRadius: 14,
              border: '1px solid var(--border)',
              marginBottom: 14,
              background: 'rgba(255,255,255,0.65)',
            }}
          />
          {(blockReason || error) && (
            <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{blockReason || error}</p>
          )}
          <PrimaryButton type="submit" disabled={busy || Boolean(blockReason)}>
            {busy ? 'Saving…' : 'Submit rating'}
          </PrimaryButton>
          <button
            type="button"
            className="pressable"
            onClick={onSkip}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 12,
              padding: 12,
              fontWeight: 600,
              color: 'var(--ink-tertiary)',
            }}
          >
            Skip for now
          </button>
        </form>
      </div>
    </div>
  )
}

export function RateRide() {
  return (
    <RequireAuth>
      <RateForm />
    </RequireAuth>
  )
}
