import { useEffect, useState } from 'react'
import { PrimaryButton } from './PrimaryButton'
import { useAuth } from '../lib/auth'
import { createScheduledTrip, fetchScheduleSlots } from '../lib/scheduledRides'
import { NEAR_TERM_MAX_MINUTES, NEAR_TERM_MIN_MINUTES } from '../../shared/nearTermSlots.js'

const TIERS = [
  { id: 'standard', name: 'Standard' },
  { id: 'wait', name: 'Wait & Save' },
  { id: 'comfort', name: 'Extra Comfort' },
]

/**
 * Pickup times 10 to 15 minutes out from the current available-driver wait.
 * The looking-for-driver Schedule button opens this schedule screen with near=1.
 */
export function NearTermSlots({
  pickup,
  dropoff,
  tier = 'standard',
  onTier,
  onScheduled,
}) {
  const { user } = useAuth()
  const [offer, setOffer] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const ready = pickup?.lat != null && dropoff?.lat != null && pickup?.label !== dropoff?.label

  useEffect(() => {
    if (!ready) {
      setOffer(null)
      setLoadError(null)
      return undefined
    }
    let alive = true
    const load = () => fetchScheduleSlots({ pickup, tier })
      .then((next) => {
        if (!alive) return
        setOffer(next)
        setLoadError(null)
        setSelectedId((current) => (next.slots || []).some((slot) => slot.id === current) ? current : null)
      })
      .catch((err) => {
        if (!alive) return
        setLoadError(err.message || 'Could not load pickup times')
      })
    load()
    const timer = setInterval(load, 15000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [ready, pickup, dropoff, tier])

  const selected = (offer?.slots || []).find((slot) => slot.id === selectedId) || null

  async function book() {
    setError(null)
    setSaved(null)
    if (!user?.id) {
      setError('Sign in to schedule this pickup.')
      return
    }
    if (!selected) {
      setError('Choose a pickup time.')
      return
    }
    setBusy(true)
    try {
      const row = await createScheduledTrip({
        user,
        pickup,
        dropoff,
        pickupAt: selected.pickupAt,
        purpose: 'planned',
        tier,
        nearTerm: true,
      })
      setSaved(row)
      onScheduled?.(row)
    } catch (err) {
      setError(err.message || 'Could not schedule ride')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Leave in 10 to 15 minutes" style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 16, fontWeight: 800, color: '#522D80', marginBottom: 6 }}>
        Leave in {NEAR_TERM_MIN_MINUTES}–{NEAR_TERM_MAX_MINUTES} minutes
      </h3>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 0, lineHeight: 1.45 }}>
        Pickup times follow the current wait from drivers who are online. Preview cars on the map are not counted.
      </p>
      {onTier && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {TIERS.map((option) => {
            const on = tier === option.id
            return (
              <button
                key={option.id}
                type="button"
                className="pressable"
                onClick={() => onTier(option.id)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: 13,
                  color: on ? '#fff' : '#522D80',
                  background: on ? '#F56600' : 'rgba(82,45,128,0.08)',
                  border: on ? '1px solid #F56600' : '1px solid rgba(82,45,128,0.25)',
                }}
              >
                {option.name}
              </button>
            )
          })}
        </div>
      )}
      {!ready && <p style={{ fontSize: 13 }}>Choose a pickup and a drop-off to see times.</p>}
      {ready && offer?.waitLabel && (
        <p style={{ fontSize: 13, fontWeight: 700, color: '#522D80' }}>
          Current wait {offer.waitLabel}
          {offer.availableDrivers ? ` · ${offer.availableDrivers} driver${offer.availableDrivers === 1 ? '' : 's'} available` : ''}
        </p>
      )}
      {loadError && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{loadError}</p>}
      {ready && offer && !(offer.slots || []).length && (
        <p role="status" style={{ fontSize: 13 }}>{offer.emptyMessage || 'No pickup in the next 10 to 15 minutes.'}</p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 12px' }}>
        {(offer?.slots || []).map((slot) => {
          const on = slot.id === selectedId
          return (
            <button
              key={slot.id}
              type="button"
              className="pressable"
              aria-pressed={on}
              onClick={() => setSelectedId(slot.id)}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 13,
                color: on ? '#fff' : '#522D80',
                background: on ? '#522D80' : 'rgba(82,45,128,0.08)',
              }}
            >
              {slot.label}
            </button>
          )
        })}
      </div>
      <PrimaryButton onClick={book} disabled={busy || !selected}>
        {busy ? 'Scheduling…' : 'Schedule this pickup'}
      </PrimaryButton>
      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 600 }}>{error}</p>}
      {saved && (
        <p style={{ color: '#522D80', fontSize: 13, fontWeight: 700 }}>
          On the board for {saved.pickup_label || pickup?.label}. Drivers are notified. No card was charged.
        </p>
      )}
    </section>
  )
}
