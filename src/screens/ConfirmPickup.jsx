import { useState } from 'react'
import { CampusMap, STADIUM } from '../components/CampusMap'
import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'
import { useStudentStatus } from '../lib/useStudentStatus'
import { applyStudentDiscount } from '../lib/pricing'
import { AIRPORT_RATES, depositCents } from '../lib/stripeCheckout'
import {
  STUDENT_DISCOUNT_LABEL,
  airportCodeFromLabel,
  depositSurfaceCopy,
} from '../../packages/rides-native/riderMoney.js'

export function ConfirmPickup({ dest = 'GSP Airport' }) {
  const [address, setAddress] = useState('Memorial Stadium · Lot 5')
  const [note, setNote] = useState('')
  const [pin, setPin] = useState(STADIUM)
  const [promptOpen, setPromptOpen] = useState(false)
  const { runOrPrompt } = useRequireAuthForAction()
  const student = useStudentStatus()
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

  const goTiers = () => navigate('tiers', { dest, pickup: address })

  const onConfirm = () => {
    runOrPrompt(goTiers, {
      setPromptOpen,
      nextPath: 'tiers',
      nextParams: { dest, pickup: address },
    })
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent' }}>
      <div style={{ padding: '16px 20px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" className="pressable glass-pill" onClick={() => navigate('home')} style={{ fontSize: 20, width: 40, height: 40, borderRadius: 12 }}>←</button>
        <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.3 }}>Confirm pickup spot</h1>
      </div>

      <div style={{ padding: '0 16px' }}>
        <div className="glass-panel" style={{ borderRadius: 18, overflow: 'hidden', padding: 4 }}>
          <CampusMap height={260} interactive dragPin marker={pin} onPinMove={setPin} />
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 8, textAlign: 'center' }}>
          Drag the map to adjust your pin
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
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Pickup address</label>
        <input
          className="glass-input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
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
            color: student.verified ? '#F56600' : '#522D80',
          }}
        >
          {student.verified
            ? `${STUDENT_DISCOUNT_LABEL} applies on the Standard quote.`
            : 'Claim Clemson student pricing · 10% off Standard'}
        </button>
        <PrimaryButton className="primary-cta" onClick={onConfirm}>
          Confirm and request
        </PrimaryButton>
      </div>
      <SignInToBookModal
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        nextPath="tiers"
        nextParams={{ dest, pickup: address }}
      />
    </div>
  )
}
