import { useState } from 'react'
import { CampusMap, STADIUM } from '../components/CampusMap'
import { CURRENT_LOCATION_LABEL, destPoint, resolvePickupPoint } from '../../packages/rides-native/places.js'
import { currentLocationDeniedCopy, readBrowserCurrentLocation } from '../lib/currentLocation'
import { useDrivingPreview } from '../lib/useDrivingPreview'
import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'
import { useStudentStatus } from '../lib/useStudentStatus'
import { applyStudentDiscount } from '../lib/pricing'
import { AIRPORT_RATES, depositCents } from '../lib/stripeCheckout'
import {
  airportCodeFromLabel,
  depositSurfaceCopy,
  studentSurfaceCopy,
} from '../../packages/rides-native/riderMoney.js'

export function ConfirmPickup({ dest = 'GSP Airport', pickup: pickupParam = '', pickupLat = '', pickupLng = '' }) {
  const seeded = (pickupParam || pickupLat) ? resolvePickupPoint(pickupParam, pickupLat, pickupLng) : null
  const [address, setAddress] = useState(seeded?.fromDevice ? seeded.label : (pickupParam || 'Memorial Stadium · Lot 5'))
  const [note, setNote] = useState('')
  const [pin, setPin] = useState(seeded?.fromDevice ? [seeded.latitude, seeded.longitude] : STADIUM)
  const [fromDevice, setFromDevice] = useState(Boolean(seeded?.fromDevice))
  const [promptOpen, setPromptOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [pickupNote, setPickupNote] = useState(null)
  const { runOrPrompt } = useRequireAuthForAction()
  const student = useStudentStatus()
  const studentOffer = studentSurfaceCopy(student, 'confirm')
  const airport = airportCodeFromLabel(dest)
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

  const drop = destPoint(dest)
  const preview = useDrivingPreview(
    fromDevice ? [pin[0], pin[1]] : null,
    fromDevice ? [drop.latitude, drop.longitude] : null,
  )
  const tierParams = fromDevice
    ? { dest, pickup: address, note, pickupLat: String(pin[0]), pickupLng: String(pin[1]) }
    : { dest, pickup: address, note }

  const goTiers = () => navigate('tiers', tierParams)

  const onConfirm = () => {
    runOrPrompt(goTiers, {
      setPromptOpen,
      nextPath: 'tiers',
      nextParams: tierParams,
    })
  }

  const onCurrentLocation = async () => {
    setLocating(true)
    setPickupNote(null)
    const result = await readBrowserCurrentLocation()
    setLocating(false)
    if (!result.ok) {
      setPickupNote(currentLocationDeniedCopy(result.reason))
      return
    }
    setAddress(result.place.label)
    setPin([result.place.lat, result.place.lng])
    setFromDevice(true)
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent' }}>
      <div style={{ padding: '16px 20px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="pressable glass-pill nav-back-btn" aria-label="Back to home" onClick={() => navigate('home')}>←</button>
        <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.3 }}>Confirm pickup spot</h1>
      </div>

      <div style={{ padding: '0 16px' }}>
        <div className="glass-panel" style={{ borderRadius: 18, overflow: 'hidden', padding: 4 }}>
          <CampusMap
            height={260}
            interactive
            dragPin={!fromDevice}
            marker={fromDevice ? null : pin}
            onPinMove={fromDevice ? undefined : setPin}
            route={fromDevice ? (preview?.path || [pin, [drop.latitude, drop.longitude]]) : null}
            stops={fromDevice ? [
              { id: 'pickup', lat: pin[0], lng: pin[1], label: 'Pickup', color: '#522D80' },
              { id: 'dropoff', lat: drop.latitude, lng: drop.longitude, label: dest, color: '#F56600' },
            ] : null}
            center={fromDevice ? pin : undefined}
          />
        </div>
        {fromDevice ? (
          <p style={{ fontSize: 14, fontWeight: 800, color: '#522D80', marginTop: 8, textAlign: 'center' }}>
            To destination · {preview?.etaLabel || 'Estimating…'}
          </p>
        ) : null}
        <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 8, textAlign: 'center' }}>
          {fromDevice ? 'Pickup is your current location. The line follows the road when Directions is available.' : 'Drag the map to adjust your pin'}
        </p>
      </div>

      <div
        className="sheet glass-panel--elevated"
        style={{
          marginTop: 'auto',
          padding: '12px 20px calc(28px + var(--safe-bottom))',
        }}
      >
        <div className="sheet-handle" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Pickup address</label>
          <button
            type="button"
            className="pressable"
            onClick={onCurrentLocation}
            disabled={locating}
            aria-pressed={fromDevice}
            aria-label="Current location"
            style={{
              border: 'none',
              borderRadius: 999,
              background: fromDevice ? '#522D80' : '#F56600',
              color: '#fff',
              fontWeight: 800,
              fontSize: 13,
              padding: '8px 12px',
              minHeight: 36,
            }}
          >
            {locating ? 'Finding location…' : CURRENT_LOCATION_LABEL}
          </button>
        </div>
        {pickupNote ? (
          <p style={{ color: '#B42318', fontSize: 13, fontWeight: 600, marginTop: 8 }}>{pickupNote}</p>
        ) : null}
        <input
          className="glass-input"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value)
            setFromDevice(false)
          }}
          style={{
            width: '100%',
            marginTop: 6,
            padding: '12px 14px',
            borderRadius: 12,
            marginBottom: 14,
          }}
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
        <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 8 }}>
          Going to <strong>{dest}</strong>
        </p>
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
        nextParams={tierParams}
      />
    </div>
  )
}
