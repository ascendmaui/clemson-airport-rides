import { useEffect, useMemo, useState } from 'react'
import { PlacePicker } from './PlacePicker'
import { BillingPicker } from './BillingPicker'
import { PrimaryButton } from './PrimaryButton'
import { FRIEND_PLACES } from '../lib/friendRides'
import { useAuth } from '../lib/auth'
import { formatUsdFromCents } from '../lib/pricing'
import { depositSurfaceCopy } from '../../packages/rides-native/riderMoney.js'
import { SignInToBookModal, useRequireAuthForAction } from './SignInToBookModal'
import {
  AIRPORT_PLACES,
  formatPickupAt,
  pickupAtFromLocal,
  SCHEDULE_PURPOSES,
  SCHEDULE_PRESETS,
  schedulePreset,
  toRiderScheduleCard,
  validateSchedule,
} from '../lib/scheduledRideModel'
import {
  cancelScheduledTrip,
  createScheduledTrip,
  estimateScheduledFare,
  listMyScheduledTrips,
} from '../lib/scheduledRides'
import { fetchBillingQuote } from '../lib/rideBilling'
import { useRideOptions } from '../lib/useRideOptions'
import { isOfferedRideTier, NO_DRIVERS_AVAILABLE_COPY, SCHEDULE_AHEAD_LABEL } from '../../shared/rideOptions.js'
import { BOOK_BACKUP_COPY } from '../../shared/backupDriverQueue.js'
import { getHashRoute } from '../lib/navigation'
import { lookupCatalogPlace, placeFromStop } from '../lib/placeCatalog'
import { NearTermSlots } from './NearTermSlots'

const TIER_LABELS = {
  standard: 'Standard',
  wait: 'Wait & Save',
  comfort: 'Extra Comfort',
  carpool: 'Carpool',
}

const PLACES = [
  ...FRIEND_PLACES,
  ...AIRPORT_PLACES.filter((a) => a.code !== 'GSP'),
]

function placeFromRouteLabel(label) {
  if (!label) return null
  const preset = PLACES.find((place) => place.label === label)
  if (preset) return preset
  return placeFromStop(lookupCatalogPlace(label))
}

function todayInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export function ScheduledRidePlanner() {
  const { user } = useAuth()
  const { runOrPrompt } = useRequireAuthForAction()
  const [promptOpen, setPromptOpen] = useState(false)
  const [purpose, setPurpose] = useState('party_weekend')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('21:00')
  const [fleet, setFleet] = useState('standard')
  const [seats, setSeats] = useState(1)
  const pickupAt = pickupAtFromLocal(date, time)
  const rideOptions = useRideOptions({ scheduledFor: pickupAt ? pickupAt.toISOString() : null })
  const tierChoices = rideOptions?.catalog?.length ? rideOptions.catalog : []
  const [pickup, setPickup] = useState(null)
  const [dropoff, setDropoff] = useState(null)
  const [quote, setQuote] = useState(null)
  const [quoteError, setQuoteError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const [mine, setMine] = useState([])
  const [listError, setListError] = useState(null)
  const [billingOffer, setBillingOffer] = useState(null)
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingChoice, setBillingChoice] = useState('no_card')
  const [backupBonusCents, setBackupBonusCents] = useState(0)

  const minDate = useMemo(() => todayInputValue(), [])

  useEffect(() => {
    const params = getHashRoute().params || {}
    if (params.near !== '1') return
    const pickupPlace = placeFromRouteLabel(params.pickup)
    const dropoffPlace = placeFromRouteLabel(params.dropoff)
    if (pickupPlace) setPickup(pickupPlace)
    if (dropoffPlace) setDropoff(dropoffPlace)
    if (isOfferedRideTier(params.tier)) setFleet(params.tier)
  }, [])

  useEffect(() => {
    if (!tierChoices.length) return
    if (!tierChoices.some((row) => row.id === fleet)) setFleet(tierChoices[0].id)
  }, [tierChoices, fleet])

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
    const load = () => listMyScheduledTrips(user.id)
      .then((rows) => {
        if (!alive) return
        setMine(rows)
        setListError(null)
      })
      .catch((err) => {
        if (!alive) return
        setListError(err.message || 'Could not load scheduled rides')
      })
    load()
    const timer = setInterval(load, 30_000)
    return () => {
      alive = false
      clearInterval(timer)
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
    estimateScheduledFare({
      pickup,
      dropoff,
      tier: fleet,
      passengers: fleet === 'carpool' ? seats : 1,
      at: pickupAtFromLocal(date, time) || new Date(),
    })
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
  }, [pickup, dropoff, fleet, seats, date, time, user?.id])

  useEffect(() => {
    if (!user?.id || pickup?.lat == null || dropoff?.lat == null) {
      setBillingOffer(null)
      setBillingLoading(false)
      return undefined
    }
    let alive = true
    setBillingLoading(true)
    fetchBillingQuote({
      pickupLabel: pickup.label,
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      dest: dropoff.label,
      destLat: dropoff.lat,
      destLng: dropoff.lng,
      tier: fleet,
      date: date || undefined,
      time: time || undefined,
    })
      .then((next) => {
        if (!alive) return
        setBillingOffer(next)
        setBillingChoice((current) => {
          if (current === 'credits' && next?.creditsSelectable) return 'credits'
          return 'no_card'
        })
      })
      .catch(() => {
        if (alive) setBillingOffer(null)
      })
      .finally(() => {
        if (alive) setBillingLoading(false)
      })
    return () => {
      alive = false
    }
  }, [user?.id, pickup, dropoff, fleet, date, time])

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
      const row = await createScheduledTrip({
        user,
        pickup,
        dropoff,
        pickupAt: check.pickupAt,
        purpose,
        tier: fleet,
        passengers: fleet === 'carpool' ? seats : null,
        billingChoice: billingOffer ? billingChoice : null,
        backupBonusCents: backupBonusCents || null,
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
        Weekend and party trips to the airport or campus, plus early classes and other planned pickups. Pick a date and time, confirm, then find it under Upcoming. Drivers see your first name. Map pins stay hidden until the ride is done, then only an approximate pin is shown.
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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {SCHEDULE_PRESETS.map(preset => (
          <button key={preset.id} type="button" className="pressable"
            style={{ padding: '10px 14px', borderRadius: 12, color: '#522D80', background: 'rgba(82,45,128,0.08)' }}
            onClick={() => {
            const next = schedulePreset(preset)
            setDate(next.date)
            setTime(next.time)
            setPurpose(next.purpose)
          }}>{preset.label}</button>
        ))}
      </div>
      <p>All pickup times are Eastern. Game-day times are suggestions; choose your actual event date and pickup time.</p>
      <label htmlFor="scheduled-date" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Date</label>
      <input
        id="scheduled-date"
        type="date"
        className="glass-input"
        min={minDate}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        style={{ width: '100%', marginTop: 6, marginBottom: 14, padding: '12px 14px', borderRadius: 12 }}
      />
      <label htmlFor="scheduled-time" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Pickup time (Eastern)</label>
      <input
        id="scheduled-time"
        type="time"
        className="glass-input"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        style={{ width: '100%', marginTop: 6, marginBottom: 14, padding: '12px 14px', borderRadius: 12 }}
      />

      <PlacePicker label="Pickup" mode="pickup" value={pickup} onChange={setPickup} presets={PLACES} showCoordinates={false} />
      <PlacePicker label="Drop-off" mode="dropoff" value={dropoff} onChange={setDropoff} presets={PLACES} showCoordinates={false} />

      <NearTermSlots
        pickup={pickup}
        dropoff={dropoff}
        tier={fleet}
        onTier={setFleet}
      />

      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)', marginBottom: 8 }}>Vehicle</div>
      {tierChoices.length === 0 ? (
        <p style={{ fontSize: 13, lineHeight: 1.45, color: '#522D80', fontWeight: 700 }}>
          {rideOptions?.emptyMessage || NO_DRIVERS_AVAILABLE_COPY}
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {tierChoices.map((option) => {
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
                  background: on ? '#F56600' : 'rgba(82,45,128,0.08)',
                  border: on ? '1px solid transparent' : '1px solid rgba(82,45,128,0.25)',
                }}
              >
                {option.name}
              </button>
            )
          })}
        </div>
      )}
      {fleet === 'carpool' ? (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[1, 2].map((count) => (
            <button
              key={count}
              type="button"
              className="pressable"
              aria-pressed={seats === count}
              onClick={() => setSeats(count)}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                fontWeight: 800,
                border: seats === count ? '2px solid #F56600' : '1px solid rgba(82,45,128,0.25)',
                background: seats === count ? 'rgba(245,102,0,0.12)' : 'transparent',
              }}
            >
              {count === 1 ? '1 seat' : '2 seats'}
            </button>
          ))}
        </div>
      ) : null}
      <p style={{ fontSize: 13, fontWeight: 700, color: '#F56600' }}>{SCHEDULE_AHEAD_LABEL}</p>

      <div className="glass-panel glass-panel--elevated" style={{ padding: 16, borderRadius: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: 'var(--ink-secondary)' }}>Fare</span>
          <strong style={{ color: '#522D80' }}>
            {quote?.scheduleDiscountApplied ? (
              <>
                <span style={{ textDecoration: 'line-through', color: 'var(--ink-tertiary)', marginRight: 8 }}>
                  {formatUsdFromCents(quote.fareBeforeScheduleDiscountCents)}
                </span>
                {formatUsdFromCents(quote.fareCents)}
              </>
            ) : (quote ? formatUsdFromCents(quote.fareCents) : '—')}
          </strong>
        </div>
        {quote?.studentLabel && (
          <div style={{ fontSize: 12, color: '#F56600', fontWeight: 700 }}>{quote.studentLabel}</div>
        )}
        <p style={{ fontSize: 12, color: '#522D80', marginTop: 8, lineHeight: 1.45 }}>
          {quote?.depositCents > 0
            ? `${depositSurfaceCopy(quote, 'confirm', { studentDiscountCents: quote.discountCents })} Scheduling does not charge your card.`
            : 'This is the fare saved on the ride.'}
          {quote?.estimate ? ' Road miles were estimated from the pins.' : ''}
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
          {fleet ? ` · ${tierChoices.find((row) => row.id === fleet)?.name || TIER_LABELS[fleet] || 'Standard'}` : ''}
        </div>
      </div>

      {pickup?.lat != null && dropoff?.lat != null && (
        <BillingPicker
          offer={user?.id ? billingOffer : null}
          selected={billingChoice}
          onSelect={setBillingChoice}
          loading={Boolean(user?.id) && billingLoading}
          signedIn={Boolean(user?.id)}
        />
      )}

      <div className="glass-panel" style={{ padding: 12, borderRadius: 14, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, color: '#522D80' }}>{BOOK_BACKUP_COPY}</div>
        <p style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
          Pickup is guaranteed: if the first driver flakes, the backup picks up and gets you there on time. The extra is included in the fare hold and charged when the trip ends.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {[[0, 'No backup'], [1000, '$10'], [1500, '$15']].map(([cents, label]) => {
            const on = backupBonusCents === cents
            return (
              <button
                key={label}
                type="button"
                className="pressable"
                onClick={() => setBackupBonusCents(cents)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  fontWeight: 800,
                  color: on ? '#fff' : '#522D80',
                  background: on ? '#F56600' : '#fff',
                  border: '1px solid rgba(82,45,128,0.2)',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <p>No card charge when you confirm. The fare hold, including a backup bonus when you add one, is captured when the trip ends. Campus rides enter matching about 45 minutes before pickup.</p>

      <PrimaryButton
        onClick={() => runOrPrompt(onSchedule, { setPromptOpen, nextPath: 'schedule' })}
        disabled={busy}
        variant={purpose === 'party_weekend' ? 'purple' : 'orange'}
      >
        {busy ? 'Confirming…' : purpose === 'party_weekend' ? 'Confirm weekend ride' : 'Confirm scheduled ride'}
      </PrimaryButton>

      {error && (
        <p role="alert" style={{ marginTop: 12, color: 'var(--danger)', fontSize: 13, fontWeight: 600 }}>{error}</p>
      )}
      {saved && (
        <p style={{ marginTop: 12, color: '#522D80', fontSize: 13, fontWeight: 700, lineHeight: 1.45 }}>
          Confirmed for {formatPickupAt(saved.pickup_at)}.
           No card was charged. Matching starts about 45 minutes before pickup; a driver is not guaranteed. The final fare is charged when the trip ends.
        </p>
      )}

      <div style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#522D80' }}>Upcoming</h3>
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
      {ride.backup?.status && (
        <div style={{ fontSize: 12, fontWeight: 800, color: '#F56600', marginTop: 4 }}>{ride.backup.status}</div>
      )}
      {ride.backup?.notice && (
        <div style={{ fontSize: 12, color: '#522D80', marginTop: 4 }}>{ride.backup.notice}</div>
      )}
        {ride.depositCents > 0 && (
        <div style={{ fontSize: 12, color: '#522D80', fontWeight: 700, marginTop: 4 }}>
          {depositSurfaceCopy(
            { fareCents: ride.fareCents, depositCents: ride.depositCents },
            'upcoming',
          )}
        </div>
      )}
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
