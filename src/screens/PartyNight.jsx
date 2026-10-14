import { useEffect, useMemo, useState } from 'react'
import { BottomTabs } from '../components/BottomTabs'
import { PlacePicker } from '../components/PlacePicker'
import { PrimaryButton } from '../components/PrimaryButton'
import { useAuth } from '../lib/auth'
import { FRIEND_PLACES } from '../lib/friendRides'
import { navigate, partyNightInviteUrl } from '../lib/navigation'
import { partyNightRequest } from '../lib/partyNightApi'
import {
  HOLD_NOTE,
  MAX_PARTY_SIZE,
  PARTY_ZONE,
  REMINDER_QUIET,
  SPLIT_NOTE,
  formatPartyPickup,
  formatPartyUsd,
  partyNightExplainer,
  partyPickupReminder,
  presentReturnQueue,
  quotePartyNight,
  suggestNightOut,
} from '../../shared/partyNight.js'

const LIBRARY = FRIEND_PLACES.find((place) => place.label === 'Cooper Library')
  || { label: 'Cooper Library', lat: 34.6757, lng: -82.8365 }
const COLLEGE = FRIEND_PLACES.find((place) => place.label === 'Downtown Clemson')
  || { label: PARTY_ZONE.label, lat: PARTY_ZONE.lat, lng: PARTY_ZONE.lng }
const RETURN_PICKUP = { label: PARTY_ZONE.label, lat: PARTY_ZONE.lat, lng: PARTY_ZONE.lng }
const EXPLAINER = partyNightExplainer()

const card = {
  marginTop: 16,
  padding: 16,
  borderRadius: 16,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  boxShadow: 'var(--shadow-soft)',
}

const fieldLabel = { fontSize: 13, fontWeight: 700, color: 'var(--ink-secondary)' }

function goTab(id) {
  if (id === 'home' || id === 'rides') navigate('home')
  else navigate(id)
}

function riderLabel(user) {
  return user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Rider'
}

export function PartyNightScreen({ token = '' }) {
  const { user } = useAuth()
  const [view, setView] = useState('explain')
  const [night, setNight] = useState(null)
  const [reminders, setReminders] = useState([])
  const [queue, setQueue] = useState(null)
  const [loading, setLoading] = useState(Boolean(token))
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!token) {
      setNight(null)
      setLoading(false)
      return undefined
    }
    let alive = true
    setLoading(true)
    setError(null)
    partyNightRequest('get', { token })
      .then((data) => { if (alive) setNight(data.night) })
      .catch((err) => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [token])

  useEffect(() => {
    if (!user) return undefined
    let alive = true
    partyNightRequest('reminders', {})
      .then((data) => { if (alive) setReminders(data.reminders || []) })
      .catch(() => {})
    partyNightRequest('return-queue', {})
      .then((data) => { if (alive) setQueue(data.queue) })
      .catch(() => {})
    return () => { alive = false }
  }, [user, token, night?.memberCount, night?.status])

  const localQueue = useMemo(
    () => presentReturnQueue([], { riderId: user?.id || null }),
    [user?.id],
  )
  const returnQueue = queue || localQueue

  return (
    <div className="route-fade" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--surface)' }}>
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 96 }}>
        <header style={{
          padding: '28px 22px 22px',
          background: 'linear-gradient(145deg, #F56600 0%, #522D80 72%)',
          color: '#fff',
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.4 }}>CLEMSON RIDES</div>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1.05, margin: '8px 0 0' }}>
            Party night
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.45, maxWidth: 420 }}>
            {EXPLAINER.lede}
          </p>
        </header>

        <div style={{ padding: '8px 20px 28px' }}>
          {error && (
            <p role="alert" style={{ ...card, color: 'var(--danger-text)', fontWeight: 700 }}>
              {error}
            </p>
          )}
          {!token && <ReminderList reminders={reminders} />}
          {token ? (
            <Lobby
              token={token}
              night={night}
              loading={loading}
              user={user}
              queue={returnQueue}
              onNight={setNight}
              onQueue={setQueue}
              onError={setError}
            />
          ) : view === 'plan' ? (
            <Planner
              user={user}
              onBack={() => setView('explain')}
              onError={setError}
            />
          ) : view === 'return' ? (
            <ReturnQueue
              user={user}
              queue={returnQueue}
              onBack={() => setView('explain')}
              onQueue={setQueue}
              onError={setError}
            />
          ) : (
            <Explainer
              onPlan={() => setView('plan')}
              onReturn={() => setView('return')}
              queue={returnQueue}
            />
          )}
        </div>
      </div>
      <BottomTabs active="schedule" onChange={goTab} />
    </div>
  )
}

function Explainer({ onPlan, onReturn, queue }) {
  return (
    <section aria-labelledby="party-explainer-title">
      <h2 id="party-explainer-title" style={{ fontSize: 22, letterSpacing: -0.4, color: '#522D80', marginTop: 8 }}>
        How a party night works
      </h2>
      <ol style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
        {EXPLAINER.sections.map((section, index) => (
          <li key={section.id} style={card}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{
                flex: '0 0 auto',
                width: 32,
                height: 32,
                borderRadius: 999,
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                color: '#fff',
                background: index % 2 === 0 ? '#F56600' : '#522D80',
              }}>{index + 1}</span>
              <div>
                <h3 style={{ fontSize: 16, margin: 0, color: '#522D80' }}>{section.title}</h3>
                <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--ink-secondary)' }}>{section.body}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div style={{ marginTop: 18 }}>
        <PrimaryButton onClick={onPlan}>Plan the night</PrimaryButton>
        <button
          type="button"
          className="pressable"
          onClick={onReturn}
          style={secondaryButton}
        >
          {queue.open ? 'Late-night return queue is open' : 'Late-night return queue'}
        </button>
      </div>
    </section>
  )
}

function Planner({ user, onBack, onError }) {
  const suggested = useMemo(() => suggestNightOut(), [])
  const [date, setDate] = useState(suggested.date)
  const [time, setTime] = useState(suggested.time)
  const [pickup, setPickup] = useState(LIBRARY)
  const [dropoff, setDropoff] = useState(COLLEGE)
  const [partySize, setPartySize] = useState(4)
  const [returnOptIn, setReturnOptIn] = useState(true)
  const [busy, setBusy] = useState(false)
  const quote = useMemo(
    () => quotePartyNight({ pickup, dropoff, partySize }),
    [pickup, dropoff, partySize],
  )

  async function onCreate() {
    if (!user) { navigate('sign-in'); return }
    if (!quote.ok) { onError(quote.error); return }
    setBusy(true)
    onError(null)
    try {
      const data = await partyNightRequest('create', {
        pickup,
        dropoff,
        date,
        time,
        displayName: riderLabel(user),
        returnOptIn,
      })
      navigate('party-night', { token: data.night.token })
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="party-plan-title">
      <button type="button" onClick={onBack} style={textButton}>How party night works</button>
      <h2 id="party-plan-title" style={{ fontSize: 22, color: '#522D80', letterSpacing: -0.4, marginTop: 8 }}>
        Schedule the night out
      </h2>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45, marginTop: 6 }}>
        Times are Eastern. Friends join from the link after you confirm, and the fare splits as they join.
      </p>
      <div style={card}>
        <label htmlFor="party-date" style={fieldLabel}>Date</label>
        <input
          id="party-date"
          type="date"
          className="glass-input"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          style={inputStyle}
        />
        <label htmlFor="party-time" style={fieldLabel}>Pickup time (Eastern)</label>
        <input
          id="party-time"
          type="time"
          className="glass-input"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          style={inputStyle}
        />
        <PlacePicker label="Pickup" mode="pickup" value={pickup} onChange={setPickup} presets={FRIEND_PLACES} showCoordinates={false} />
        <PlacePicker label="Drop-off" mode="dropoff" value={dropoff} onChange={setDropoff} presets={FRIEND_PLACES} showCoordinates={false} />
        <div style={{ ...fieldLabel, marginBottom: 8 }}>Preview the split</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }} role="group" aria-label="Preview group size">
          {Array.from({ length: MAX_PARTY_SIZE }, (_, index) => index + 1).map((size) => {
            const on = partySize === size
            return (
              <button
                key={size}
                type="button"
                className="pressable"
                aria-pressed={on}
                onClick={() => setPartySize(size)}
                style={{
                  minWidth: 44,
                  minHeight: 44,
                  borderRadius: 999,
                  fontWeight: 800,
                  color: on ? '#fff' : '#522D80',
                  background: on ? '#F56600' : 'rgba(82,45,128,0.08)',
                  border: on ? '1px solid #F56600' : '1px solid rgba(82,45,128,0.25)',
                }}
              >{size}</button>
            )
          })}
        </div>
        {quote.ok ? (
          <SplitPreview quote={quote} />
        ) : (
          <p role="status" style={{ color: 'var(--danger-text)', fontWeight: 700 }}>{quote.error}</p>
        )}
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '14px 0', fontSize: 14, fontWeight: 700, color: '#522D80' }}>
          <input
            type="checkbox"
            checked={returnOptIn}
            onChange={(event) => setReturnOptIn(event.target.checked)}
            style={{ width: 20, height: 20, marginTop: 2 }}
          />
          <span>Line up a late-night ride home from {PARTY_ZONE.label}. The return queue opens Thursday, Friday, and Saturday, 10pm to 3am.</span>
        </label>
        <PrimaryButton onClick={onCreate} loading={busy} disabled={!quote.ok || busy}>
          {busy ? 'Scheduling…' : 'Schedule and get a link'}
        </PrimaryButton>
      </div>
    </section>
  )
}

function SplitPreview({ quote }) {
  const sample = quote.people[0]
  return (
    <div aria-live="polite">
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
        Estimated fare <strong>{formatPartyUsd(quote.estimatedFareCents)}</strong> for the car.
        With {quote.partySize} {quote.partySize === 1 ? 'person' : 'people'}, each share is <strong>{formatPartyUsd(sample.shareCents)}</strong>.
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.45, color: '#522D80', fontWeight: 700 }}>
        Pre-authorization hold {formatPartyUsd(sample.holdCents)} per person. Charged at trip end.
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.45, color: 'var(--ink-secondary)' }}>{SPLIT_NOTE}</p>
    </div>
  )
}

function Lobby({ token, night, loading, user, queue, onNight, onQueue, onError }) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const link = partyNightInviteUrl(token)
  const reminder = night ? partyPickupReminder(night) : null
  const self = night?.members?.find((member) => member.isSelf)

  async function run(action, extra = {}) {
    if (!user) { navigate('sign-in'); return }
    setBusy(true)
    onError(null)
    try {
      const data = await partyNightRequest(action, { token, displayName: riderLabel(user), ...extra })
      if (data.night) onNight(data.night)
      if (data.queue) onQueue(data.queue)
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard?.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (loading) {
    return <p style={{ marginTop: 18, color: 'var(--ink-secondary)' }}>Loading this party night…</p>
  }
  if (!night) return null

  return (
    <section aria-labelledby="party-lobby-title">
      <button type="button" onClick={() => navigate('party-night')} style={textButton}>How party night works</button>
      <h2 id="party-lobby-title" style={{ fontSize: 22, color: '#522D80', letterSpacing: -0.4, marginTop: 8 }}>
        {night.pickupLabel} → {night.dropoffLabel}
      </h2>
      <p style={{ marginTop: 6, fontWeight: 700 }}>{night.pickupText || formatPartyPickup(night.pickupAt)}</p>
      {night.status === 'canceled' && (
        <p role="status" style={{ ...card, fontWeight: 800, color: '#522D80' }}>This party night was canceled.</p>
      )}
      <div role="status" style={{ ...card, background: reminder ? 'rgba(245,102,0,0.10)' : 'var(--surface)' }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: '#BA4700' }}>PICKUP REMINDER</div>
        <p style={{ margin: '6px 0 0', fontSize: 18, fontWeight: 800, color: '#522D80' }}>
          {reminder ? reminder.label : REMINDER_QUIET}
        </p>
      </div>
      <div style={card}>
        <h3 style={{ margin: 0, fontSize: 16, color: '#522D80' }}>The group · {night.memberCount} of {MAX_PARTY_SIZE}</h3>
        <p style={{ margin: '6px 0 12px', fontSize: 13, lineHeight: 1.45, color: 'var(--ink-secondary)' }}>{HOLD_NOTE}</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {(night.members || []).map((member) => (
            <li key={member.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 800 }}>
                {member.firstName}
                {member.isOrganizer ? ' · scheduled it' : ''}
                {member.isSelf ? ' · you' : ''}
              </span>
              <span style={{ textAlign: 'right' }}>
                <span style={{ display: 'block', fontWeight: 800 }}>{formatPartyUsd(member.shareCents)}</span>
                <span style={{ display: 'block', fontSize: 12, color: '#522D80' }}>Hold {formatPartyUsd(member.holdCents)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p style={{ margin: '12px 0 0', fontWeight: 800, color: '#522D80' }}>
          Fare {formatPartyUsd(night.estimatedFareCents)}. Pre-authorization holds, charged at trip end.
        </p>
      </div>
      <div style={card}>
        <label htmlFor="party-invite" style={fieldLabel}>Invite link</label>
        <input id="party-invite" readOnly value={link} style={inputStyle} />
        <button type="button" className="pressable" onClick={copyLink} style={secondaryButton}>
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
        {night.status !== 'canceled' && !self && night.seatsLeft > 0 && (
          <PrimaryButton onClick={() => run('join')} loading={busy} disabled={busy}>Join and split the fare</PrimaryButton>
        )}
        {night.status !== 'canceled' && !self && night.seatsLeft === 0 && (
          <p style={{ marginTop: 12, fontWeight: 800, color: '#522D80' }}>This party night is full.</p>
        )}
        {self && night.status !== 'canceled' && (
          <button type="button" className="pressable" onClick={() => run('leave')} disabled={busy} style={secondaryButton}>
            Leave this party night
          </button>
        )}
        {self?.isOrganizer && night.status !== 'canceled' && (
          confirmCancel ? (
            <button type="button" className="pressable" onClick={() => run('cancel')} disabled={busy} style={{ ...secondaryButton, color: 'var(--danger-text)' }}>
              Yes, cancel this party night
            </button>
          ) : (
            <button type="button" className="pressable" onClick={() => setConfirmCancel(true)} style={textButton}>
              Cancel this party night
            </button>
          )
        )}
      </div>
      <ReturnQueue
        user={user}
        queue={queue}
        partyNightId={night.id}
        onQueue={onQueue}
        onError={onError}
      />
    </section>
  )
}

function ReturnQueue({ user, queue, partyNightId = null, onBack, onQueue, onError }) {
  const [dropoff, setDropoff] = useState(LIBRARY)
  const [busy, setBusy] = useState(false)

  async function join() {
    if (!user) { navigate('sign-in'); return }
    setBusy(true)
    onError(null)
    try {
      const data = await partyNightRequest('return-join', {
        pickup: RETURN_PICKUP,
        dropoff,
        partyNightId,
        displayName: riderLabel(user),
      })
      onQueue(data.queue)
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function leave() {
    setBusy(true)
    onError(null)
    try {
      const data = await partyNightRequest('return-leave', {})
      onQueue(data.queue)
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="party-return-title" style={onBack ? undefined : card}>
      {onBack && <button type="button" onClick={onBack} style={textButton}>How party night works</button>}
      <h2 id="party-return-title" style={{ fontSize: onBack ? 22 : 16, color: '#522D80', letterSpacing: -0.3, marginTop: onBack ? 8 : 0 }}>
        Late-night return queue
      </h2>
      <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--ink-secondary)' }}>{queue.note}</p>
      <p role="status" style={{ margin: '10px 0 0', fontWeight: 800, color: queue.open ? '#BA4700' : '#522D80' }}>
        {queue.open
          ? (queue.joined
            ? `You are ${queue.position} of ${queue.size} for a ride home from ${PARTY_ZONE.label}.`
            : (queue.size
              ? `${queue.size} ${queue.size === 1 ? 'rider is' : 'riders are'} waiting. The queue is open.`
              : 'The queue is open. Nobody is waiting yet.'))
          : queue.closedMessage}
      </p>
      {queue.joined && queue.dropoffLabel && (
        <p style={{ marginTop: 8, fontSize: 14 }}>Headed to {queue.dropoffLabel}.</p>
      )}
      <div style={{ marginTop: 12 }}>
        <PlacePicker label="Ride home to" mode="dropoff" value={dropoff} onChange={setDropoff} presets={FRIEND_PLACES} showCoordinates={false} />
        <PrimaryButton variant="purple" onClick={join} loading={busy} disabled={!queue.open || busy}>
          {queue.joined ? 'Update my ride home' : 'Join the return queue'}
        </PrimaryButton>
        {queue.joined && (
          <button type="button" className="pressable" onClick={leave} disabled={busy} style={secondaryButton}>
            Leave the return queue
          </button>
        )}
      </div>
    </section>
  )
}

function ReminderList({ reminders }) {
  if (!reminders?.length) return null
  return (
    <div style={{ marginTop: 8 }}>
      {reminders.map((reminder) => (
        <button
          key={reminder.nightId}
          type="button"
          className="pressable"
          onClick={() => navigate('party-night', { token: reminder.token })}
          style={{ ...card, width: '100%', textAlign: 'left', background: 'rgba(245,102,0,0.10)' }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: '#BA4700' }}>PICKUP REMINDER</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#522D80', marginTop: 4 }}>{reminder.label}</div>
          <div style={{ fontSize: 14, marginTop: 4 }}>{reminder.pickupLabel} → {reminder.dropoffLabel}</div>
        </button>
      ))}
    </div>
  )
}

const inputStyle = {
  width: '100%',
  marginTop: 6,
  marginBottom: 14,
  padding: '12px 14px',
  borderRadius: 12,
  minHeight: 44,
}

const secondaryButton = {
  display: 'block',
  width: '100%',
  marginTop: 10,
  minHeight: 44,
  padding: '12px 14px',
  borderRadius: 14,
  fontWeight: 800,
  color: '#522D80',
  border: '1.5px solid rgba(82,45,128,0.35)',
  background: 'rgba(82,45,128,0.06)',
}

const textButton = {
  marginTop: 12,
  minHeight: 44,
  fontWeight: 800,
  color: '#522D80',
  background: 'none',
}
