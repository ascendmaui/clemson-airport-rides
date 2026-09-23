import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { useTripWait } from '../lib/useTripWait'
import { formatUsd } from '../lib/waitFee'
import { navigate } from '../lib/navigation'

function firstNameOnly(fullName) {
  const token = String(fullName || '').trim().split(/\s+/)[0]
  return token || ''
}

function chargeNote(charge) {
  if (!charge || charge.status === 'skipped' || charge.status === 'succeeded') return null
  if (charge.status === 'pending') {
    return charge.reason === 'no_card'
      ? 'Saved card missing — fee is owed and will retry when a card is on file.'
      : 'Fee recorded. Card charge is pending.'
  }
  if (charge.status === 'failed') {
    return 'Fee recorded. Card charge did not go through.'
  }
  return null
}

export function WaitFeeCard({
  trip,
  quote,
  role,
  busy = false,
  error = null,
  charge = null,
  onStart,
  onCancel,
}) {
  const [who, setWho] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const otherId = role === 'driver' ? trip?.rider_id : trip?.driver_id

  useEffect(() => {
    if (!supabase || !otherId) return undefined
    let alive = true
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', otherId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setWho(firstNameOnly(data?.full_name))
      })
    return () => { alive = false }
  }, [otherId])

  if (!trip) return null

  if (trip.status === 'cancelled_wait') {
    return <WaitReceipt trip={trip} role={role} who={who} charge={charge} />
  }

  if (trip.status !== 'arrived') {
    if ((trip.status === 'in_progress' || trip.status === 'completed') && Number(trip.wait_fee_cents) > 0) {
      return (
        <p style={{ marginTop: 10, fontSize: 13, color: 'var(--ink-secondary)' }}>
          Wait fee {formatUsd(trip.wait_fee_cents)} included for the driver.
        </p>
      )
    }
    return null
  }

  const waitingFor = who || (role === 'driver' ? 'rider' : 'driver')
  const note = chargeNote(charge)

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          borderRadius: 16,
          background: '#522D80',
          color: '#fff',
        }}
      >
        <div>
          <div style={{ fontSize: 11, letterSpacing: 0.8, fontWeight: 700, opacity: 0.85 }}>
            WAITING{who ? ` · ${who}` : ''}
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
            {quote?.clock || '0:00'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4 }}>
            {quote?.inGrace ? 'Grace' : 'Wait fee'}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#F56600' }}>
            {formatUsd(quote?.waitFeeCents || 0)}
          </div>
        </div>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-secondary)', lineHeight: 1.4 }}>
        {quote?.inGrace
          ? `3-minute grace, then $1.00 per minute. Waiting for ${waitingFor}.`
          : `$1.00 per minute after grace. Waiting for ${waitingFor}.`}
        {role === 'driver'
          ? ' You can keep waiting. At 7:00 the ride cancels automatically.'
          : ' At 7:00 the ride cancels automatically ($4.00 wait + $1.00 cancel fee).'}
      </p>
      {role === 'driver' && quote?.autoDue && (
        <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 700, color: '#522D80' }}>
          7:00 — canceling and charging the $5.00 cancellation.
        </p>
      )}
      {role === 'driver' && onStart && !quote?.autoDue && (
        <button
          type="button"
          className="pressable"
          onClick={onStart}
          disabled={busy}
          style={{
            width: '100%',
            marginTop: 12,
            padding: '15px 20px',
            borderRadius: 16,
            background: 'linear-gradient(135deg, #522D80 0%, #6b3fa0 100%)',
            color: '#fff',
            fontWeight: 600,
            fontSize: 17,
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? 'Updating…' : 'Start trip'}
        </button>
      )}
      {role === 'driver' && quote?.cancelAvailable && onCancel && !confirmCancel && (
        <button
          type="button"
          className="pressable"
          onClick={() => setConfirmCancel(true)}
          disabled={busy}
          style={{
            width: '100%',
            marginTop: 8,
            padding: 12,
            fontWeight: 700,
            color: '#F56600',
          }}
        >
          Cancel ride
        </button>
      )}
      {role === 'driver' && confirmCancel && (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
            Cancel now and charge {formatUsd(quote?.waitFeeCents || 0)} wait fee? You can keep waiting instead.
          </p>
          <button
            type="button"
            className="pressable"
            onClick={onCancel}
            disabled={busy}
            style={{ width: '100%', padding: 12, fontWeight: 700, color: '#F56600' }}
          >
            Confirm cancel
          </button>
          <button
            type="button"
            className="pressable"
            onClick={() => setConfirmCancel(false)}
            style={{ width: '100%', padding: 12, fontWeight: 600, color: '#522D80' }}
          >
            Keep waiting
          </button>
        </div>
      )}
      {note && <p style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-secondary)' }}>{note}</p>}
      {error && <p style={{ marginTop: 8, fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}

export function WaitReceipt({ trip, role, who = '', charge = null }) {
  const wait = Number(trip.wait_fee_cents) || 0
  const cancel = Number(trip.cancel_fee_cents) || 0
  const platform = Number(trip.platform_fee_cents) || 0
  const driverEarn = Number(trip.driver_wait_earnings_cents) || 0
  const total = wait + cancel
  const auto = trip.wait_cancel_reason === 'auto'
  const note = chargeNote(charge)
  const name = who || (role === 'driver' ? 'rider' : 'driver')

  return (
    <div
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: 16,
        background: '#fff',
        border: '1px solid rgba(82,45,128,0.25)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: '#F56600' }}>
        {auto ? 'RIDE CANCELED AT 7:00' : 'RIDE CANCELED'}
      </div>
      {role === 'rider' ? (
        <>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.4, marginTop: 4 }}>
            {formatUsd(total)}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
            {auto
              ? `${formatUsd(wait)} wait + ${formatUsd(cancel)} cancel fee. Platform keeps ${formatUsd(platform)}. ${name} receives ${formatUsd(driverEarn)}.`
              : `Wait fee ${formatUsd(wait)}. ${name} receives ${formatUsd(driverEarn)}.`}
          </p>
        </>
      ) : (
        <>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.4, marginTop: 4, color: '#522D80' }}>
            You earned {formatUsd(driverEarn)}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
            {auto
              ? `${name} is charged ${formatUsd(total)} (${formatUsd(wait)} wait + ${formatUsd(cancel)} cancel). Platform keeps ${formatUsd(platform)}.`
              : `Wait fee ${formatUsd(wait)} goes to you.`}
          </p>
        </>
      )}
      {note && <p style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-secondary)' }}>{note}</p>}
    </div>
  )
}

const OPEN_WAIT = ['accepted', 'arriving', 'arrived', 'cancelled_wait', 'in_progress']

/** Rider home hook so the live wait is visible without staying on the trip screen. */
export function RiderWaitBanner() {
  const { user } = useAuth()
  const [trip, setTrip] = useState(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    async function load() {
      const { data } = await supabase
        .from('trips')
        .select('*')
        .eq('rider_id', user.id)
        .in('status', OPEN_WAIT)
        .order('requested_at', { ascending: false })
        .limit(1)
      if (!alive) return
      const row = data?.[0] || null
      if (row?.status === 'cancelled_wait' && row.canceled_at) {
        const age = Date.now() - new Date(row.canceled_at).getTime()
        if (age > 2 * 60 * 60 * 1000) {
          setTrip(null)
          return
        }
      }
      setTrip(row && (row.status === 'arrived' || row.status === 'cancelled_wait') ? row : null)
    }
    load()
    const channel = supabase
      .channel(`rider-wait-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `rider_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new
          if (!row) return
          if (row.status === 'arrived' || row.status === 'cancelled_wait') setTrip(row)
          else if (trip?.id === row.id) setTrip(null)
        },
      )
      .subscribe()
    const poll = setInterval(load, 12000)
    return () => {
      alive = false
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [user?.id, trip?.id])

  const wait = useTripWait(trip, (next) => {
    setTrip((prev) => (prev && next && prev.id === next.id ? { ...prev, ...next } : next))
  })

  if (!trip || hidden) return null
  if (trip.status !== 'arrived' && trip.status !== 'cancelled_wait') return null

  return (
    <div className="glass-panel card-soft" style={{ marginTop: 16, borderRadius: 18, padding: 14 }}>
      <WaitFeeCard trip={trip} quote={wait.quote} role="rider" charge={wait.charge} error={wait.error} />
      <button
        type="button"
        className="pressable"
        onClick={() => navigate('requested', { trip: trip.id, dest: trip.dropoff_label || '' })}
        style={{ marginTop: 8, fontWeight: 700, color: '#522D80' }}
      >
        Open trip
      </button>
      {trip.status === 'cancelled_wait' && (
        <button
          type="button"
          className="pressable"
          onClick={() => setHidden(true)}
          style={{ marginLeft: 12, fontWeight: 600, color: 'var(--ink-tertiary)' }}
        >
          Dismiss
        </button>
      )}
    </div>
  )
}
