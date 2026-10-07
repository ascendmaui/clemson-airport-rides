import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { authedJson } from '../lib/apiClient'
import { getHashRoute } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import { fetchDriversByIds } from '../../packages/rides-native/drivers.js'
import { TIGER_PASS_NAME } from '../../shared/tigerPass.js'

/**
 * Frequent-rider pass. The name shown here is the server payload, which reads
 * TIGER_PASS_NAME. Preferred ride types are the three offered options.
 */
export function TigerPassPanel() {
  const { user } = useAuth()
  const [status, setStatus] = useState(null)
  const [drivers, setDrivers] = useState([])
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)

  async function reload() {
    const next = await authedJson(supabase, '/api/stripe-payment-methods?action=tiger-pass', {
      method: 'POST',
      body: { op: 'status' },
    })
    setStatus(next)
    const ids = next.favoriteDriverIds || []
    const cards = ids.length ? await fetchDriversByIds(supabase, ids) : { drivers: [] }
    setDrivers(cards.drivers || [])
    return next
  }

  useEffect(() => {
    if (!user?.id) return undefined
    let alive = true
    const params = getHashRoute().params || {}
    ;(async () => {
      try {
        if (params.tigerPass === '1' && params.session_id) {
          const confirmed = await authedJson(supabase, '/api/stripe-payment-methods?action=tiger-pass', {
            method: 'POST',
            body: { op: 'confirm', sessionId: params.session_id },
          })
          if (!alive) return
          setStatus(confirmed)
          setNote(confirmed.active ? `${confirmed.name} is active.` : 'Payment is still processing.')
          const ids = confirmed.favoriteDriverIds || []
          const cards = ids.length ? await fetchDriversByIds(supabase, ids) : { drivers: [] }
          if (alive) setDrivers(cards.drivers || [])
          return
        }
        await reload()
      } catch (err) {
        if (alive) setNote(err?.message || 'Could not load the pass')
        try {
          if (alive) await reload()
        } catch {
          /* the note above is the rider-facing error */
        }
      }
    })()
    return () => { alive = false }
  }, [user?.id])

  async function savePreferences(preferredCarTypes, preferredDriverIds) {
    setBusy(true)
    setNote(null)
    try {
      const next = await authedJson(supabase, '/api/stripe-payment-methods?action=tiger-pass', {
        method: 'POST',
        body: { op: 'preferences', preferredCarTypes, preferredDriverIds },
      })
      setStatus(next)
      if (next.demoDriversIgnored) setNote(next.demoNote)
    } catch (err) {
      setNote(err?.message || 'Could not save preferences')
    } finally {
      setBusy(false)
    }
  }

  async function onCheckout() {
    setBusy(true)
    setNote(null)
    try {
      const session = await authedJson(supabase, '/api/stripe-payment-methods?action=tiger-pass', {
        method: 'POST',
        body: { op: 'checkout', origin: window.location.origin },
      })
      if (session?.url) {
        window.location.href = session.url
        return
      }
      setNote('Checkout did not return a payment URL. No charge was made.')
    } catch (err) {
      setNote(err?.message || 'Could not start checkout. No charge was made.')
    } finally {
      setBusy(false)
    }
  }

  async function onCancel() {
    setBusy(true)
    setNote(null)
    try {
      const next = await authedJson(supabase, '/api/stripe-payment-methods?action=tiger-pass', {
        method: 'POST',
        body: { op: 'cancel' },
      })
      setStatus(next)
      setNote(next.cancelAtPeriodEnd ? `${next.name} ends at the close of this period.` : `${next.name} is canceled.`)
    } catch (err) {
      setNote(err?.message || 'Could not cancel')
    } finally {
      setBusy(false)
    }
  }

  async function onUnfavorite(driverId) {
    if (!status) return
    setBusy(true)
    try {
      const next = await authedJson(supabase, '/api/stripe-payment-methods?action=favorite-drivers', {
        method: 'POST',
        body: { op: 'set', driverIds: status.favoriteDriverIds.filter((id) => id !== driverId) },
      })
      setStatus(next)
      setDrivers((rows) => rows.filter((driver) => next.favoriteDriverIds.includes(driver.id)))
    } catch (err) {
      setNote(err?.message || 'Could not update favorites')
    } finally {
      setBusy(false)
    }
  }

  if (!user?.id) return null
  const name = status?.name || TIGER_PASS_NAME
  const cars = status?.carTypes || []
  const selectedCars = status?.preferredCarTypes || []
  const preferred = new Set(status?.preferredDriverIds || [])
  const pastDue = status?.status === 'past_due'
  const ending = Boolean(status?.active && status?.cancelAtPeriodEnd)

  return (
    <section className="glass-panel" style={{ marginTop: 14, padding: 16, borderRadius: 18 }}>
      <div style={{ fontWeight: 800, color: 'var(--purple)' }}>{name}</div>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45, marginTop: 6 }}>
        {status?.summary || 'Loading the frequent-rider pass.'}
      </p>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4 }}>
        {status?.priceLabel} · {status?.active ? 'Discount is on' : 'Discount starts after checkout'}
      </p>
      {pastDue ? (
        <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 8 }}>
          Payment is past due, so the discount is off until Stripe marks this subscription active again.
        </p>
      ) : null}
      {ending ? (
        <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 8 }}>
          {name} stays on through the end of this period.
        </p>
      ) : null}
      {status?.active && !ending ? (
        <button type="button" className="pressable" disabled={busy} onClick={onCancel}
          style={{ marginTop: 10, padding: '10px 14px', borderRadius: 12, fontWeight: 700, color: 'var(--purple)', border: '1px solid rgba(82,45,128,0.3)', background: 'transparent' }}>
          Cancel pass
        </button>
      ) : null}
      {!status?.active && !pastDue ? (
        <button type="button" className="pressable" disabled={busy || !status} onClick={onCheckout}
          style={{ marginTop: 10, padding: '10px 14px', borderRadius: 12, fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg, var(--orange), #ff7a1a)', border: 'none' }}>
          {busy ? 'Opening…' : `Subscribe${status?.priceLabel ? ` · ${status.priceLabel}` : ''}`}
        </button>
      ) : null}

      <div style={{ marginTop: 16, fontWeight: 800 }}>Preferred ride types</div>
      <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 4 }}>Standard, Wait & Save, and Extra Comfort only.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {cars.map((car) => {
          const on = selectedCars.includes(car.id)
          return (
            <button key={car.id} type="button" className="pressable" disabled={busy}
              onClick={() => savePreferences(
                on ? selectedCars.filter((id) => id !== car.id) : [...selectedCars, car.id],
                status?.preferredDriverIds || [],
              )}
              style={{
                padding: '8px 12px', borderRadius: 999, fontWeight: 700, fontSize: 13,
                background: on ? 'var(--purple)' : 'transparent',
                color: on ? '#fff' : 'var(--purple)',
                border: '1px solid rgba(82,45,128,0.35)',
              }}>
              {car.name}
            </button>
          )
        })}
      </div>

      <div style={{ marginTop: 16, fontWeight: 800 }}>Favorite drivers</div>
      <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', lineHeight: 1.45, marginTop: 4 }}>{status?.demoNote}</p>
      {drivers.length === 0 ? <p style={{ fontSize: 13, marginTop: 8 }}>No favorite drivers yet. Save one from Pick a driver.</p> : null}
      {drivers.map((driver) => {
        const on = preferred.has(driver.id)
        return (
          <div key={driver.id} style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{driver.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>{driver.vehicleLabel}</div>
            </div>
            <button type="button" className="pressable" disabled={busy}
              onClick={() => savePreferences(selectedCars, on
                ? (status?.preferredDriverIds || []).filter((id) => id !== driver.id)
                : [...(status?.preferredDriverIds || []), driver.id])}
              style={{ fontWeight: 700, color: 'var(--purple)', background: 'transparent', border: 'none' }}>
              {on ? 'Preferred' : 'Prefer'}
            </button>
            <button type="button" className="pressable" disabled={busy} onClick={() => onUnfavorite(driver.id)}
              style={{ fontWeight: 700, color: 'var(--ink-secondary)', background: 'transparent', border: 'none' }}>
              Remove
            </button>
          </div>
        )
      })}
      {note ? <p role="status" style={{ marginTop: 12, fontSize: 13, color: 'var(--purple)' }}>{note}</p> : null}
    </section>
  )
}
