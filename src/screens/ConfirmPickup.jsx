import { useState } from 'react'
import { CampusMap, STADIUM } from '../components/CampusMap'
import { AddressSuggest } from '../components/AddressSuggest'
import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'
import { useStudentStatus } from '../lib/useStudentStatus'
import { applyStudentDiscount } from '../lib/pricing'
import { AIRPORT_RATES, depositCents } from '../lib/stripeCheckout'
import { lookupCatalogPlace, placeFromStop } from '../lib/placeCatalog'
import { finiteCoordinate, placeFromCoordinates, readBrowserPosition, reverseGeocodeLabel } from '../lib/currentPlace'
import { destPoint } from '../../packages/rides-native/places.js'
import {
  airportCodeFromLabel,
  depositSurfaceCopy,
  studentSurfaceCopy,
} from '../../packages/rides-native/riderMoney.js'

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
  const [promptOpen, setPromptOpen] = useState(false)
  const { runOrPrompt } = useRequireAuthForAction()
  const student = useStudentStatus()
  const studentOffer = studentSurfaceCopy(student, 'confirm')
  const airport = airportCodeFromLabel(dropoff.label)
  const rate = airport ? AIRPORT_RATES[airport] : null
  const studentFare = rate
    ? applyStudentDiscount(rate.fareCents, { isStudent: student.verified, tier: 'standard' })
    : null
  const depositCopy = studentFare
    ? depositSurfaceCopy(
      { fareCents: studentFare.fareCents, depositCents: depositCents(studentFare.fareCents) },
      'confirm',
      { studentDiscountCents: studentFare.discountCents },
    )
    : null

  const nextParams = {
    dest: dropoff.label,
    destLat: String(dropoff.lat),
    destLng: String(dropoff.lng),
    pickup: pickup.label,
    pickupLat: String(pickup.lat),
    pickupLng: String(pickup.lng),
  }

  const goTiers = () => navigate('tiers', nextParams)

  const onConfirm = () => {
    runOrPrompt(goTiers, {
      setPromptOpen,
      nextPath: 'tiers',
      nextParams,
    })
  }

  async function onLocate() {
    setLocating(true)
    setLocateNote(null)
    try {
      const fix = await readBrowserPosition()
      const label = await reverseGeocodeLabel(fix.lat, fix.lng)
      const place = placeFromCoordinates(fix.lat, fix.lng, label)
      if (place) setPickup(place)
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
            dragPin
            center={[pickup.lat, pickup.lng]}
            marker={[pickup.lat, pickup.lng]}
            onPinMove={(next) => {
              const place = placeFromCoordinates(next?.[0], next?.[1], pickup.label === 'Memorial Stadium' ? 'Dropped pin' : pickup.label)
              if (place) setPickup(place)
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
          Use current location, type an address, or drag the pin
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
          onChange={setPickup}
          placeholder="Type a pickup — Grand Marc, stadium, or a street"
        />
        <AddressSuggest
          label="Drop-off address"
          value={dropoff}
          onChange={setDropoff}
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
        {depositCopy && (
          <p style={{ fontSize: 13, color: '#522D80', fontWeight: 700, lineHeight: 1.45, marginTop: 0 }}>
            {depositCopy}
          </p>
        )}
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
