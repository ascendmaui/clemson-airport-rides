import { useEffect, useRef, useState } from 'react'
import { CampusMap, STADIUM } from '../components/CampusMap'
import { TierRow } from '../components/TierRow'
import { PrimaryButton } from '../components/PrimaryButton'
import { UpsellModal } from '../components/UpsellModal'
import { navigate } from '../lib/navigation'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'
import { SurgeBadge } from '../components/SurgeBadge'
import { GameDayStatus } from '../components/GameDayStatus'
import { fetchRideQuote } from '../lib/rideBilling'
import { useGameDayNotice } from '../lib/useGameDayNotice'
import { useStudentStatus } from '../lib/useStudentStatus'
import { studentSurfaceCopy } from '../../packages/rides-native/riderMoney.js'
import { bookableRideTiers } from '../../packages/rides-native/places.js'
import { useRideOptions } from '../lib/useRideOptions'
import { NO_DRIVERS_AVAILABLE_COPY, SCHEDULE_AHEAD_LABEL } from '../../shared/rideOptions.js'

export function RideTiers({
  dest = '1900 GSP Dr',
  pickup = '',
  pickupLat = '',
  pickupLng = '',
  destLat = '',
  destLng = '',
  billing = '',
}) {
  const rideOptions = useRideOptions()
  const availableIds = rideOptions?.availableTierIds || []
  const tiers = rideOptions ? bookableRideTiers().filter((tier) => availableIds.includes(tier.id)) : []
  const [selected, setSelected] = useState(null)
  const [upsell, setUpsell] = useState(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [quote, setQuote] = useState(null)
  const [quoteError, setQuoteError] = useState(null)
  const userPickedTier = useRef(false)
  const { runOrPrompt } = useRequireAuthForAction()
  const student = useStudentStatus()
  const studentOffer = studentSurfaceCopy(student, 'tiers')
  const game = useGameDayNotice()

  useEffect(() => {
    let alive = true
    setQuote(null)
    setQuoteError(null)
    fetchRideQuote({
      pickupLabel: pickup,
      pickupLat,
      pickupLng,
      dest,
      destLat,
      destLng,
    })
      .then((data) => { if (alive) setQuote(data) })
      .catch((err) => { if (alive) setQuoteError(err?.message || 'Fare unavailable') })
    return () => { alive = false }
  }, [pickup, pickupLat, pickupLng, dest, destLat, destLng])

  const quotedTier = (id) => (quote?.tiers || []).find((row) => row.id === id) || null
  const standardFare = quotedTier('standard')?.fareCents
  const comfortFare = quotedTier('comfort')?.fareCents
  const upgradeCents = standardFare != null && comfortFare != null ? comfortFare - standardFare : 0

  useEffect(() => {
    if (!tiers.length) {
      setSelected(null)
      return
    }
    if (userPickedTier.current && selected && tiers.some((tier) => tier.id === selected.id)) return
    const preferredId = (quote?.preferredCarTypes || []).find((id) => tiers.some((tier) => tier.id === id))
    const next = tiers.find((tier) => tier.id === preferredId) || tiers[0]
    if (!selected || selected.id !== next.id) setSelected(next)
  }, [tiers, selected, quote])

  const onSelectTier = (tier) => {
    userPickedTier.current = true
    setSelected(tier)
  }

  const openDrivers = (tierId) => {
    const row = tiers.find((tier) => tier.id === tierId) || selected
    if (!row) return
    navigate('pick-driver', {
      dest,
      destLat,
      destLng,
      pickup,
      pickupLat,
      pickupLng,
      tier: row.id,
      ...(billing ? { billing } : {}),
    })
  }

  const proceedRequest = () => {
    if (!selected) return
    if (selected.id === 'standard' && upgradeCents > 0 && tiers.some((tier) => tier.id === 'comfort')) {
      setUpsell('comfort')
      return
    }
    openDrivers(selected.id)
  }

  const onConfirm = () => {
    runOrPrompt(proceedRequest, {
      setPromptOpen,
      nextPath: 'tiers',
      nextParams: { dest, destLat, destLng, pickup, pickupLat, pickupLng, ...(billing ? { billing } : {}) },
    })
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent' }}>
      <div style={{ padding: '12px 16px 0' }}>
        <button type="button" className="pressable glass-pill nav-back-btn" aria-label="Back to pickup confirmation" onClick={() => navigate('confirm', { dest, destLat, destLng, pickup, pickupLat, pickupLng, ...(billing ? { billing } : {}) })} style={{ marginBottom: 8 }}>←</button>
        <div className="glass-panel" style={{ borderRadius: 16, overflow: 'hidden', padding: 4 }}>
          <CampusMap
            height={140}
            marker={STADIUM}
            route={[STADIUM, [34.8957, -82.2189]]}
          />
        </div>
        <div
          className="glass-panel glass-panel--purple"
          style={{
            marginTop: 10,
            padding: '8px 12px',
            borderRadius: 999,
            color: 'var(--purple)',
            fontSize: 12,
            fontWeight: 600,
            display: 'inline-flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          {studentOffer.title}
        </div>
        <button
          type="button"
          className="pressable"
          onClick={() => navigate('account', { tab: 'student' })}
          style={{ display: 'block', width: '100%', marginTop: 8, fontSize: 12, fontWeight: 700, color: '#522D80', textAlign: 'left', lineHeight: 1.45, whiteSpace: 'normal', overflowWrap: 'anywhere' }}
        >
          {studentOffer.detail}
        </button>
        <div style={{ marginTop: 8 }}>
          <SurgeBadge surge={quote?.surge} />
        </div>
        {quote?.tigerPassApplied ? (
          <p style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: '#522D80' }}>
            {quote.tigerPassName} · {quote.tigerPassDiscountBps / 100}% off this fare
          </p>
        ) : null}
        <div style={{ marginTop: 8 }}>
          <GameDayStatus notice={game.notice} ready={game.ready} compact />
        </div>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-secondary)' }}>
          To <strong style={{ color: 'var(--ink)' }}>{dest}</strong>
        </p>
      </div>

      <div
        className="sheet"
        style={{
          flex: 1,
          marginTop: 12,
          padding: '8px 12px 20px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="sheet-handle" />
        <div style={{ flex: 1 }}>
          {quoteError && (
            <p role="alert" style={{ color: 'var(--danger, #b00020)', fontSize: 13, fontWeight: 700, margin: '8px 8px 0' }}>
              {quoteError}
            </p>
          )}
          {rideOptions && tiers.length === 0 ? (
            <div style={{ padding: '12px 8px' }}>
              <p style={{ fontWeight: 800, color: '#522D80' }}>{rideOptions.emptyMessage || NO_DRIVERS_AVAILABLE_COPY}</p>
              <button type="button" className="pressable" onClick={() => navigate('schedule')} style={{ marginTop: 8, fontWeight: 800, color: '#F56600' }}>
                {SCHEDULE_AHEAD_LABEL}
              </button>
            </div>
          ) : null}
          {tiers.map((t) => {
            const row = quotedTier(t.id)
            const sameAsStandard = t.id === 'wait' && row && standardFare != null && row.fareCents === standardFare
            const savedPercent = t.id === 'wait' && row && standardFare > 0 && row.fareCents < standardFare
              ? Math.round((1 - row.fareCents / standardFare) * 100)
              : 0
            const studentNote = row?.discountCents > 0 ? 'Clemson student · 10% off Standard' : ''
            const meta = [
              sameAsStandard ? '4 seats' : savedPercent > 0 ? `Save ${savedPercent}%` : t.meta,
              studentNote,
            ].filter(Boolean).join(' · ')
            return (
              <TierRow
                key={t.id}
                tier={{
                  ...t,
                  price: row ? row.fareCents / 100 : null,
                  meta,
                }}
                selected={selected?.id === t.id}
                onSelect={onSelectTier}
              />
            )
          })}
        </div>
        <div style={{ padding: '12px 8px 0' }}>
          <PrimaryButton
            className="primary-cta"
            variant="orange"
            onClick={onConfirm}
            disabled={!quote || !selected}
          >
            {!quote ? 'Loading fare…' : `Select ${selected.name}`}
          </PrimaryButton>
        </div>
      </div>

      <UpsellModal
        open={upsell === 'comfort'}
        variant="comfort"
        upgradePrice={upgradeCents / 100}
        onClose={() => {
          setUpsell(null)
          openDrivers(selected.id)
        }}
        onUpgrade={() => {
          setSelected(tiers.find((t) => t.id === 'comfort') || selected)
          setUpsell(null)
        }}
      />
      <SignInToBookModal
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        nextPath="tiers"
        nextParams={{ dest }}
      />
    </div>
  )
}
