import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import { fetchTripForRating, submitRating } from '../lib/ratings'
import { PrimaryButton } from '../components/PrimaryButton'
import { RequireAuth } from '../components/RequireAuth'

function RateForm() {
  const { user } = useAuth()
  const { params } = getHashRoute()
  const tripId = params.trip
  const [trip, setTrip] = useState(null)
  const [stars, setStars] = useState(5)
  const [comment, setComment] = useState('')
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!tripId) return
    fetchTripForRating(tripId).then(setTrip).catch((e) => setError(e.message))
  }, [tripId])

  if (!tripId) return <div style={{ padding: 24 }}>Missing trip</div>
  if (!trip) return <div style={{ padding: 40, textAlign: 'center' }}>Loading…</div>

  const rateeId = user?.id === trip.rider_id ? trip.driver_id : trip.rider_id
  const label = user?.id === trip.rider_id ? 'Rate your driver' : 'Rate your rider'

  async function onSubmit(e) {
    e.preventDefault()
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

  if (done) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ color: 'var(--purple)' }}>Thanks for the rating</h1>
        <PrimaryButton onClick={() => navigate('home')}>Back home</PrimaryButton>
      </div>
    )
  }

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 420, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--purple)' }}>{label}</h1>
      <p style={{ color: 'var(--ink-secondary)', marginTop: 6, marginBottom: 16 }}>
        {trip.pickup_label} → {trip.dropoff_label}
      </p>
      <form onSubmit={onSubmit}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className="pressable"
              onClick={() => setStars(n)}
              style={{
                width: 44, height: 44, borderRadius: 12, fontSize: 20,
                background: n <= stars ? 'var(--orange)' : 'rgba(0,0,0,0.06)',
                color: n <= stars ? '#fff' : 'var(--ink-secondary)',
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
          style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)', marginBottom: 14 }}
        />
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
        <PrimaryButton disabled={busy}>{busy ? 'Saving…' : 'Submit rating'}</PrimaryButton>
      </form>
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
