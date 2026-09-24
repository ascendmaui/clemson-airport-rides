import { useEffect, useMemo, useState } from 'react'
import { PlacePicker } from './PlacePicker'
import { PrimaryButton } from './PrimaryButton'
import { FRIEND_PLACES } from '../lib/friendRides'
import { useAuth } from '../lib/auth'
import { useStudentStatus } from '../lib/useStudentStatus'
import { formatUsdFromCents } from '../lib/pricing'
import { SignInToBookModal, useRequireAuthForAction } from './SignInToBookModal'
import {
  AIRPORT_PLACES,
  formatPickupAt,
  SCHEDULE_PURPOSES,
  toRiderScheduleCard,
  validateSchedule,
} from '../lib/scheduledRideModel'
import {
  cancelScheduledTrip,
  createScheduledTrip,
  estimateScheduledFare,
  listMyScheduledTrips,
} from '../lib/scheduledRides'
import { TESLA_FLEET_NOTICE } from '../../packages/rides-native/tripTags.js'

const PLACES = [
  ...FRIEND_PLACES,
  ...AIRPORT_PLACES.filter((a) => a.code !== 'GSP'),
]

function todayInputValue() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

export function ScheduledRidePlanner() {
  const { user } = useAuth()
  const { runOrPrompt } = useRequireAuthForAction()
  const [promptOpen, setPromptOpen] = useState(false)
  const [purpose, setPurpose] = useState('party_weekend')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('21:00')
  const [fleet, setFleet] = useState('standard')
  const [pickup, setPickup] = useState(null)
  const [dropoff, setDropoff] = useState(null)
  const [quote, setQuote] = useState(null)
  const [quoteError, setQuoteError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const [mine, setMine] = useState([])
  const [listError, setListError] = useState(null)

  const isStudent = useStudentStatus().verified
  const minDate = useMemo(() => todayInputValue(), [])

  async function refreshMine() {
    if (!user?.id) {
      setMine([])
      return
    }
    try {
      const rows = await listMyScheduledTrips(user.id)
      setMine(rows)
      setListError(null)
    } catch (err) {
      setListError(err.message || 'Could not load scheduled rides')
    }
  }

  useEffect(() => {
    let alive = true
    if (!user?.id) {
      setMine([])
      return undefined
    }
    listMyScheduledTrips(user.id)
      .then((rows) => {
        if (!alive) return
        setMine(rows)
        setListError(null)
      })
      .catch((err) => {
        if (!alive) return
        setListError(err.message || 'Could not load scheduled rides')
      })
    return () => {
      alive = false
    }
  }, [user?.id, saved])

  useEffect(() => {
    if (purpose !== 'airport' || dropoff) return
    setDropoff(AIRPORT_PLACES[0])
  }, [purpose, dropoff])

  useEffect(() => {
    let alive = true
    if (pickup?.lat == null || dropoff?.lat == null) {
      setQuote(null)
      setQuoteError(null)
      return undefined
    }
    estimateScheduledFare({ pickup, dropoff, isStudent: isStudent && fleet !== 'tesla' })
      .then((next) => {
        if (!alive) return
        setQuote(next)
        setQuoteError(null)
      })
      .catch((err) => {
        if (!alive) return
        setQuote(null)
        setQuoteError(err.message || 'Fare estimate unavailable')
      })
    return () => {
      alive = false
    }
  }, [pickup, dropoff, isStudent, fleet])

  async function onSchedule() {
    setError(null)
    setSaved(null)
    const check = validateSchedule({ date, time, pickup, dropoff })
    if (!check.ok) {
      setError(check.errors[0])
      return
    }
    setBusy(true)
    try {
      const priced = quote || await estimateScheduledFare({ pickup, dropoff, isStudent: isStudent && fleet !== 'tesla', at: check.pickupAt })
      const row = await createScheduledTrip({
        user,
        pickup,
        dropoff,
        pickupAt: check.pickupAt,
        purpose,
        fareCents: priced?.fareCents || 0,
        depositCents: priced?.estimate ? 0 : (priced?.depositCents || 0),
        fareIsEstimate: priced?.estimate !== false,
        isStudent: fleet === 'tesla' ? false : isStudent,
        studentDiscountCents: fleet === 'tesla' ? 0 : (priced?.discountCents || 0),
        studentLabel: fleet === 'tesla' ? null : (priced?.studentLabel || null),
        tier: fleet,
      })
      setSaved(row)
      setDate('')
      setTime('')
      await refreshMine()
    } catch (err) {
      setError(err.message || 'Could not schedule ride')
    } finally {
      setBusy(false)
    }
  }

  async function onCancel(id) {
    setError(null)
    try {
      await cancelScheduledTrip(id)
      await refreshMine()
    } catch (err) {
      setError(err.message || 'Could not cancel')
    }
  }

  const cards = mine
    .map(toRiderScheduleCard)
    .filter((c) => c && c.status !== 'canceled')
  const upcoming = cards.filter((c) => c.status !== 'completed')
  const completed = cards.filter((c) => c.status === 'completed')

  return (
    <section style={{ marginBottom: 28 }} aria-label="Schedule a ride">
      <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3, color: '#522D80' }}>
        Schedule a ride
      </h2>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 6, marginBottom: 14 }}>
        Weekend and party trips to the airport or campus, plus early classes and other planned pickups. Pick a date and time, confirm, then find it under Your scheduled rides. Drivers see your first name. Map pins stay hidden until the ride is done, then only an approximate pin is shown.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {SCHEDULE_PURPOSES.map((p) => {
          const on = purpose === p.id
          return (
            <button
              key={p.id}
              type="button"
              className="pressable"
              onClick={() => setPurpose(p.id)}
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
              {p.label}
            </button>
          )
        })}
      </div>

      {purpose === 'party_weekend' && (
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 0 }}>
            Friday night through Sunday. Use a campus spot or GSP, CLT, or ATL.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="pressable"
              onClick={() => {
                setPickup(PLACES.find((place) => place.label === 'Memorial Stadium') || null)
                setDropoff(PLACES.find((place) => place.label === 'GSP Airport') || null)
              }}
              style={{ padding: '8px 12px', borderRadius: 999, fontWeight: 700, fontSize: 13, color: '#522D80', background: 'rgba(245,102,0,0.12)', border: '1px solid rgba(245,102,0,0.45)' }}
            >
              Stadium → GSP
            </button>
            <button
              type="button"
              className="pressable"
              onClick={() => {
                setPickup(PLACES.find((place) => place.label === 'Downtown Clemson') || null)
                setDropoff(PLACES.find((place) => place.label === 'Cooper Library') || null)
              }}
              style={{ padding: '8px 12px', borderRadius: 999, fontWeight: 700, fontSize: 13, color: '#fff', background: '#522D80', border: '1px solid #522D80' }}
            >
              Downtown → campus
            </button>
          </div>
        </div>
      )}

      <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Date</label>
      <input
        type="date"
        className="glass-input"
        min={minDate}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        style={{ width: '100%', marginTop: 6, marginBottom: 14, padding: '12px 14px', borderRadius: 12 }}
      />
      <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Pickup time</label>
      <input
        type="time"
        className="glass-input"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        style={{ width: '100%', marginTop: 6, marginBottom: 14, padding: '12px 14px', borderRadius: 12 }}
      />

      <PlacePicker label="Pickup" mode="pickup" value={pickup} onChange={setPickup} presets={PLACES} showCoordinates={false} />
      <PlacePicker label="Drop-off" mode="dropoff" value={dropoff} onChange={setDropoff} presets={PLACES} showCoordinates={false} />

      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)', marginBottom: 8 }}>Vehicle</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {[
          { id: 'standard', label: 'Standard' },
          { id: 'tesla', label: 'Tesla Model 3' },
        ].map((option) => {
          const on = fleet === option.id
          return (
            <button
              key={option.id}
              type="button"
              className="pressable"
              onClick={() => setFleet(option.id)}
              style={{
                padding: '8px 12px',
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 13,
                color: on ? '#fff' : '#522D80',
                background: on ? (option.id === 'tesla' ? '#522D80' : '#F56600') : 'rgba(82,45,128,0.08)',
                border: on ? '1px solid transparent' : '1px solid rgba(82,45,128,0.25)',
              }}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {fleet === 'tesla' && (
        <p style={{ fontSize: 13, lineHeight: 1.45, color: '#522D80', fontWeight: 650, marginTop: 0 }}>
          {TESLA_FLEET_NOTICE}
        </p>
      )}

      <div className="glass-panel glass-panel--elevated" style={{ padding: 16, borderRadius: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: 'var(--ink-secondary)' }}>{quote?.estimate === false ? 'Fare' : 'Fare estimate'}</span>
          <strong style={{ color: '#522D80' }}>{quote ? formatUsdFromCents(quote.fareCents) : '—'}</strong>
        </div>
        {quote?.studentLabel && (
          <div style={{ fontSize: 12, color: '#F56600', fontWeight: 700 }}>{quote.studentLabel}</div>
        )}
        <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 8 }}>
          {quote?.source === 'airport_flat'
            ? `${quote.airport} flat rate. Pay the deposit in Airport deposit below if you want to hold it now.`
            : 'Estimate from distance. Final fare can change when a driver accepts.'}
          {quote?.miles != null ? ` · ${quote.miles} mi` : ''}
        </p>
        {quoteError && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>{quoteError}</p>}
      </div>

      <div className="glass-panel" style={{ padding: 12, borderRadius: 14, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, color: '#522D80', marginBottom: 4 }}>
          {purpose === 'party_weekend' ? 'Confirm weekend / party' : 'Confirm this ride'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
          {date && time ? `${date} · ${time}` : 'Choose a date and time.'}
          {pickup?.label && dropoff?.label ? ` · ${pickup.label} → ${dropoff.label}` : ''}
          {fleet === 'tesla' ? ' · Tesla Model 3, driver at the wheel' : ''}
        </div>
      </div>

      <PrimaryButton
        onClick={() => runOrPrompt(onSchedule, { setPromptOpen, nextPath: 'schedule' })}
        disabled={busy}
        variant={purpose === 'party_weekend' || fleet === 'tesla' ? 'purple' : 'orange'}
      >
        {busy ? 'Confirming…' : purpose === 'party_weekend' ? 'Confirm weekend ride' : 'Confirm scheduled ride'}
      </PrimaryButton>

      {error && (
        <p role="alert" style={{ marginTop: 12, color: 'var(--danger)', fontSize: 13, fontWeight: 600 }}>{error}</p>
      )}
      {saved && (
        <p style={{ marginTop: 12, color: '#522D80', fontSize: 13, fontWeight: 700 }}>
          Scheduled for {formatPickupAt(saved.pickup_at)}. Drivers can accept it from their queue.
        </p>
      )}

      <div style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#522D80' }}>Your scheduled rides</h3>
        {listError && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{listError}</p>}
        {!user && (
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>Sign in to see rides you have scheduled.</p>
        )}
        {user && upcoming.length === 0 && completed.length === 0 && !listError && (
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
            No upcoming rides. Confirm a weekend airport or campus trip and it will show up here.
          </p>
        )}
        {upcoming.map((ride) => (
          <RideRow key={ride.id} ride={ride} onCancel={onCancel} />
        ))}
        {completed.length > 0 && (
          <>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#522D80', marginTop: 16 }}>Completed</h3>
            <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 0 }}>
              Approximate pickup pin only.
            </p>
            {completed.map((ride) => (
              <RideRow key={ride.id} ride={ride} />
            ))}
          </>
        )}
      </div>

      <SignInToBookModal open={promptOpen} onClose={() => setPromptOpen(false)} nextPath="schedule" />
    </section>
  )
}

function RideRow({ ride, onCancel }) {
  return (
    <div className="glass-panel" style={{ padding: 12, borderRadius: 14, marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ color: '#522D80' }}>{formatPickupAt(ride.pickupAt)}</strong>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#F56600', textTransform: 'capitalize' }}>{ride.status}</span>
      </div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{ride.pickupLabel} → {ride.dropoffLabel}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 4 }}>
        {ride.purpose ? `${ride.purpose} · ` : ''}
        {formatUsdFromCents(ride.fareCents)}
        {ride.estimate ? ' estimate' : ''}
        {ride.approxPin ? ` · Approx pin ${ride.approxPin}` : ''}
      </div>
      {ride.canCancel && onCancel && (
        <button
          type="button"
          className="pressable"
          onClick={() => onCancel(ride.id)}
          style={{ marginTop: 8, fontWeight: 700, color: '#522D80', fontSize: 13 }}
        >
          Cancel
        </button>
      )}
    </div>
  )
}
