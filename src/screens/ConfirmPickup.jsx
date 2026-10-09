import { useEffect, useState } from 'react'
import { CampusMap, STADIUM } from '../components/CampusMap'
import { AddressSuggest } from '../components/AddressSuggest'
import { BillingPicker } from '../components/BillingPicker'
import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'
import { useAuth } from '../lib/auth'
import { useStudentStatus } from '../lib/useStudentStatus'
import { fetchBillingQuote } from '../lib/rideBilling'
import { lookupCatalogPlace, placeFromStop } from '../lib/placeCatalog'
import { finiteCoordinate, placeFromCoordinates, readBrowserPosition, reverseGeocodeLabel } from '../lib/currentPlace'
import { destPoint } from '../../packages/rides-native/places.js'
import { studentSurfaceCopy } from '../../packages/rides-native/riderMoney.js'
import { SCHEDULE_AHEAD_LABEL } from '../../shared/rideOptions.js'

function placeForLabel(label, fallbackPoint) {
  const known = placeFromStop(lookupCatalogPlace(label))
  if (known) return known
  return {
    label: label || 'Drop-off',
    lat: fallbackPoint.latitude,
    lng: fallbackPoint.longitude,
  }
}

export function ConfirmPickup({
  dest = 'GSP Airport',
  pickup: initialPickup = '',
  pickupLat = '',
  pickupLng = '',
  tier = '',
}) {
  const [pickup, setPickup] = useState(() => {
    const lat = finiteCoordinate(pickupLat)
    const lng = finiteCoordinate(pickupLng)
    if (initialPickup && lat != null && lng != null) {
      return { label: initialPickup, lat, lng }
    }
    return { label: 'Memorial Stadium', lat: STADIUM[0], lng: STADIUM[1] }
  })
  const [dropoff, setDropoff] = useState(() => placeForLabel(dest, destPoint(dest)))
  const [note, setNote] = useState('')
  const [locating, setLocating] = useState(false)
  const [locateNote, setLocateNote] = useState(null)
  const [focus, setFocus] = useState(() => [pickup.lat, pickup.lng])
  const [dragPickup, setDragPickup] = useState(true)
  const [promptOpen, setPromptOpen] = useState(false)
  const [offer, setOffer] = useState(null)
  const [billingLoading, setBillingLoading] = useState(false)
  const [billingChoice, setBillingChoice] = useState('no_card')
  const { user } = useAuth()
  const { runOrPrompt } = useRequireAuthForAction()
  const student = useStudentStatus()
  const studentOffer = studentSurfaceCopy(student, 'confirm')

  useEffect(() => {
    if (!user?.id) {
      setOffer(null)
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
    })
      .then((next) => {
        if (!alive) return
        setOffer(next)
        setBillingChoice((current) => {
          if (current === 'credits' && next?.creditsSelectable) return 'credits'
          return 'no_card'
        })
      })
      .catch(() => {
        if (alive) setOffer(null)
      })
      .finally(() => {
        if (alive) setBillingLoading(false)
      })
    return () => {
      alive = false
    }
  }, [user?.id, pickup.label, pickup.lat, pickup.lng, dropoff.label, dropoff.lat, dropoff.lng])

  const nextParams = {
    dest: dropoff.label,
    destLat: String(dropoff.lat),
    destLng: String(dropoff.lng),
    pickup: pickup.label,
    pickupLat: String(pickup.lat),
    pickupLng: String(pickup.lng),
    ...(offer ? { billing: billingChoice } : {}),
    ...(tier ? { tier } : {}),
  }

  const goTiers = () => navigate('tiers', nextParams)

  const onConfirm = () => {
    runOrPrompt(goTiers, {
      setPromptOpen,
      nextPath: 'tiers',
      nextParams,
    })
  }

  function pinPlace(place, setter, field) {
    if (!place) return
    setter(place)
    if (place.lat != null && place.lng != null) setFocus([place.lat, place.lng])
    setDragPickup(field !== 'dropoff')
  }

  async function onLocate() {
    setLocating(true)
    setLocateNote(null)
    try {
      const fix = await readBrowserPosition()
      const label = await reverseGeocodeLabel(fix.lat, fix.lng)
      const place = placeFromCoordinates(fix.lat, fix.lng, label)
      pinPlace(place, setPickup, 'pickup')
    } catch (err) {
      setLocateNote(err?.message || 'Could not get current location. Check permissions.')
    } finally {
      setLocating(false)
    }
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent' }}>
      <div style={{ padding: '16px 20px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="pressable glass-pill nav-back-btn" aria-label="Back to home" onClick={() => navigate('home')}>←</button>
        <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.3 }}>Confirm pickup spot</h1>
      </div>

      <div style={{ padding: '0 16px' }}>
        <div className="glass-panel" style={{ borderRadius: 18, overflow: 'hidden', padding: 4, position: 'relative' }}>
          <CampusMap
            height={260}
            interactive
            dragPin={dragPickup}
            center={focus}
            marker={[pickup.lat, pickup.lng]}
            pickupPosition={[pickup.lat, pickup.lng]}
            dropoffPosition={[dropoff.lat, dropoff.lng]}
            onPinMove={(next) => {
              const place = placeFromCoordinates(next?.[0], next?.[1], pickup.label === 'Memorial Stadium' ? 'Dropped pin' : pickup.label)
              pinPlace(place, setPickup, 'pickup')
            }}
          />
          <button
            type="button"
            className="pressable"
            aria-label="Use current location as pickup"
            disabled={locating}
            onClick={onLocate}
            style={{
              position: 'absolute',
              right: 16,
              bottom: 16,
              zIndex: 2,
              width: 44,
              height: 44,
              borderRadius: 22,
              background: '#fff',
              color: 'var(--orange)',
              fontWeight: 800,
              fontSize: 20,
              boxShadow: '0 2px 10px rgba(11,18,32,0.22)',
            }}
          >
            {locating ? '…' : '◎'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 8, textAlign: 'center' }}>
          The location icon on pickup and drop-off pins that stop. Drag still moves the pickup pin.
        </p>
        {locateNote ? (
          <p style={{ fontSize: 12, color: 'var(--danger, #b00020)', marginTop: 4, textAlign: 'center' }}>{locateNote}</p>
        ) : null}
      </div>

      <div
        className="sheet glass-panel--elevated"
        style={{
          marginTop: 'auto',
          padding: '12px 20px calc(28px + var(--safe-bottom))',
          overflowY: 'auto',
        }}
      >
        <div className="sheet-handle" />
        <AddressSuggest
          label="Pickup address"
          value={pickup}
          onChange={(place) => pinPlace(place, setPickup, 'pickup')}
          placeholder="Type a pickup — Grand Marc, stadium, or a street"
        />
        <AddressSuggest
          label="Drop-off address"
          value={dropoff}
          onChange={(place) => pinPlace(place, setDropoff, 'dropoff')}
          placeholder="Type a drop-off — campus, GSP, or a street"
        />
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Add note for driver</label>
        <textarea
          className="glass-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Near the orange gates, wearing purple hoodie"
          rows={2}
          style={{
            width: '100%',
            marginTop: 6,
            padding: '12px 14px',
            borderRadius: 12,
            resize: 'none',
            marginBottom: 8,
          }}
        />
        <BillingPicker
          offer={user?.id ? offer : null}
          selected={billingChoice}
          onSelect={setBillingChoice}
          loading={Boolean(user?.id) && billingLoading}
          signedIn={Boolean(user?.id)}
        />
        <button
          type="button"
          className="pressable"
          onClick={() => navigate('account', { tab: 'student' })}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            marginBottom: 14,
            fontSize: 13,
            fontWeight: 800,
            color: studentOffer.granted ? '#F56600' : '#522D80',
            lineHeight: 1.45,
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
          }}
        >
          {studentOffer.title}
        </button>
        <button
          type="button"
          className="pressable"
          onClick={() => navigate('schedule', nextParams)}
          style={{
            display: 'block',
            width: '100%',
            minHeight: 44,
            textAlign: 'left',
            marginBottom: 12,
            fontSize: 13,
            fontWeight: 800,
            color: '#F56600',
            lineHeight: 1.45,
          }}
        >
          {SCHEDULE_AHEAD_LABEL}
        </button>
        <PrimaryButton className="primary-cta" onClick={onConfirm}>
          Confirm and request
        </PrimaryButton>
      </div>
      <SignInToBookModal
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        nextPath="tiers"
        nextParams={nextParams}
      />
    </div>
  )
}
