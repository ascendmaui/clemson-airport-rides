import { useEffect, useState } from 'react'
import { TipCharge } from '../components/TipCharge'
import { RequireAuth } from '../components/RequireAuth'
import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import { tipChargeBody } from '../../packages/rides-native/tipPresets.js'
import { submitTripTip } from '../../packages/rides-native/tipRide.js'

function TipForm() {
  const { user } = useAuth()
  const { params } = getHashRoute()
  const tripId = params.trip
  const [trip, setTrip] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [paid, setPaid] = useState(null)

  useEffect(() => {
    if (!tripId || !supabase || !user?.id) return undefined
    let alive = true
    supabase
      .from('trips')
      .select('id, status, fare_cents, tip_cents, driver_id, pickup_label, dropoff_label')
      .eq('id', tripId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (!alive) return
        if (queryError) setError(queryError.message)
        else setTrip(data)
        setLoaded(true)
      })
    return () => { alive = false }
  }, [tripId, user?.id])

  async function onTip(choice) {
    if (!tripId) return
    setBusy(true)
    setError(null)
    try {
      const result = await submitTripTip(supabase, tipChargeBody({ tripId, ...choice }))
      if (result?.ok) {
        setPaid({
          cents: result.tipCents,
          driverEarningsCents: result.driverEarningsCents,
        })
        return
      }
      if (result?.needsPaymentMethod || result?.requiresAction) {
        setError('Add the card you use for the 25% deposit, then try this tip again.')
        return
      }
      setError(result?.error || 'Tip was not charged.')
    } catch (err) {
      setError(err.message || 'Tip was not charged.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fade-in" style={{ padding: 24, maxWidth: 420, margin: '0 auto' }}>
      <button
        type="button"
        className="pressable"
        onClick={() => navigate('requested', tripId ? { trip: tripId } : {})}
        style={{ fontWeight: 800, color: 'var(--purple)', marginBottom: 12 }}
      >
        ← Back
      </button>
      <div
        className="glass-panel glass-panel--elevated"
        style={{
          padding: 22,
          borderRadius: 22,
          background: 'linear-gradient(165deg, rgba(255,255,255,0.85), rgba(82,45,128,0.08), rgba(245,102,0,0.10))',
        }}
      >
        {!tripId ? (
          <p style={{ color: 'var(--ink-secondary)' }}>This tip needs a completed ride.</p>
        ) : (
          <>
            {trip?.pickup_label ? (
              <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 0 }}>
                {trip.pickup_label} → {trip.dropoff_label}
              </p>
            ) : null}
            {tripId && !loaded ? (
              <p style={{ color: 'var(--ink-secondary)' }}>Loading this ride…</p>
            ) : (
              <TipCharge
                fareCents={trip?.fare_cents}
                existingTipCents={trip?.tip_cents}
                busy={busy}
                error={error}
                paidCents={paid?.cents || null}
                driverEarningsCents={paid?.driverEarningsCents ?? null}
                onTip={onTip}
                onSkip={() => navigate('home')}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function TipRide() {
  return (
    <RequireAuth>
      <TipForm />
    </RequireAuth>
  )
}
