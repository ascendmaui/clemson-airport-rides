import { useEffect, useRef, useState } from 'react'
import { CampusMap, STADIUM } from '../components/CampusMap'
import { TierRow } from '../components/TierRow'
import { PrimaryButton } from '../components/PrimaryButton'
import { UpsellModal } from '../components/UpsellModal'
import { navigate } from '../lib/navigation'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'
import { SurgeBadge } from '../components/SurgeBadge'
import { GameDayStatus } from '../components/GameDayStatus'
import { GameDaySurgeNote } from '../components/GameDayBoard'
import { fetchRideQuote } from '../lib/rideBilling'
import { useGameDayNotice } from '../lib/useGameDayNotice'
import { useGameDayExperience } from '../../packages/rides-native/useGameDayExperience.js'
import { supabase } from '../lib/supabase'
import { useStudentStatus } from '../lib/useStudentStatus'
import { studentSurfaceCopy } from '../../packages/rides-native/riderMoney.js'
import { bookableRideTiers } from '../../packages/rides-native/places.js'
import { useRideOptions } from '../lib/useRideOptions'
import { isOfferedRideTier, NO_DRIVERS_AVAILABLE_COPY, SCHEDULE_AHEAD_LABEL } from '../../shared/rideOptions.js'
import { SiteIcon } from '../components/SiteIcon'

export function RideTiers({
  dest = '1900 GSP Dr',
  pickup = '',
  pickupLat = '',
  pickupLng = '',
  destLat = '',
  destLng = '',
  billing = '',
  tier: initialTier = '',
  passengers: initialPassengers = '',
}) {
  const rideOptions = useRideOptions()
  const availableIds = rideOptions?.availableTierIds || []
  const tiers = rideOptions ? bookableRideTiers().filter((tier) => availableIds.includes(tier.id)) : []
  const presetTier = isOfferedRideTier(initialTier) ? String(initialTier).trim().toLowerCase() : ''
  const [selected, setSelected] = useState(null)
  const [seats, setSeats] = useState(() => {
    const n = Math.round(Number(initialPassengers))
    return n === 2 ? 2 : 1
  })
  const [upsell, setUpsell] = useState(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [quote, setQuote] = useState(null)
  const [quoteError, setQuoteError] = useState(null)
  const userPickedTier = useRef(false)
  const { runOrPrompt } = useRequireAuthForAction()
  const student = useStudentStatus()
  const studentOffer = studentSurfaceCopy(student, 'tiers')
  const game = useGameDayNotice()
  const gameDay = useGameDayExperience(supabase)

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
    if (presetTier && tiers.some((tier) => tier.id === presetTier)) {
      userPickedTier.current = true
      const preset = tiers.find((tier) => tier.id === presetTier)
      if (!selected || selected.id !== preset.id) setSelected(preset)
      return
    }
    const preferredId = (quote?.preferredCarTypes || []).find((id) => tiers.some((tier) => tier.id === id))
    const next = tiers.find((tier) => tier.id === preferredId) || tiers[0]
    if (!selected || selected.id !== next.id) setSelected(next)
  }, [tiers, selected, quote, presetTier])

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
      ...(row.id === 'carpool' ? { passengers: String(seats) } : {}),
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
    // One scroll for the whole page: the app shell scrolls; nothing in here has its own
    // overflow or a fixed height, so the map, notices and ride cards move together.
    <div className="fade-in ride-tiers" style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', background: 'transparent', maxWidth: 640, margin: '0 auto', width: '100%' }}>
      <div style={{ padding: '12px 16px 0' }}>
        <button type="button" className="pressable glass-pill nav-back-btn" aria-label="Back to pickup confirmation" onClick={() => navigate('confirm', { dest, destLat, destLng, pickup, pickupLat, pickupLng, ...(billing ? { billing } : {}) })} style={{ marginBottom: 8 }}><SiteIcon name="arrow-left" size={20} /></button>
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
          {gameDay.ready ? <GameDaySurgeNote model={gameDay.model} audience="rider" /> : null}
        </div>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-secondary)' }}>
          To <strong style={{ color: 'var(--ink)' }}>{dest}</strong>
        </p>
      </div>

      <section
        aria-label="Choose a ride"
        style={{
          flex: 1,
          marginTop: 14,
          padding: '4px 16px 0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em', margin: '0 2px 10px', color: 'var(--ink)' }}>Choose a ride</h2>
        <div className="tier-list" style={{ flex: 1 }}>
          {quoteError && (
            <p role="alert" style={{ color: 'var(--danger, #b00020)', fontSize: 13, fontWeight: 700, margin: '0 2px' }}>
              {quoteError}
            </p>
          )}
          {rideOptions && tiers.length === 0 ? (
            <div style={{ padding: '18px 16px', borderRadius: 18, background: '#fff', border: '1.5px solid rgba(17,17,26,0.08)', boxShadow: '0 4px 14px rgba(17,17,26,0.05)' }}>
              <p style={{ fontWeight: 800, color: '#522D80' }}>
                {rideOptions.viewerOnlineDriver ? 'You are the only driver online' : (rideOptions.emptyMessage || NO_DRIVERS_AVAILABLE_COPY)}
              </p>
              {rideOptions.viewerOnlineDriver ? (
                <p style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
                  This account is online in the driver app, and a rider cannot book their own car. Sign in here with a different rider account to test a booking.
                </p>
              ) : null}
              <button type="button" className="pressable" onClick={() => navigate('schedule')} style={{ marginTop: 8, fontWeight: 800, color: '#F56600', minHeight: 44 }}>
                {SCHEDULE_AHEAD_LABEL}
              </button>
            </div>
          ) : null}
          {tiers.map((t) => {
            const row = quotedTier(t.id)
            const sameAsStandard = t.id === 'wait' && row && standardFare != null && row.fareCents === standardFare
            const savedPercent = (t.id === 'wait' || t.id === 'carpool') && row && standardFare > 0 && row.fareCents < standardFare
              ? Math.round((1 - row.fareCents / standardFare) * 100)
              : 0
            const studentNote = row?.discountCents > 0 ? 'Clemson student · 10% off Standard' : ''
            const meta = [
              t.id === 'carpool'
                ? '50% of Standard per seat'
                : sameAsStandard ? '4 seats' : savedPercent > 0 ? `Save ${savedPercent}%` : t.meta,
              studentNote,
            ].filter(Boolean).join(' · ')
            return (
              <TierRow
                key={t.id}
                tier={{
                  ...t,
                  price: row
                    ? (t.id === 'carpool' && selected?.id === 'carpool' ? (row.fareCents * seats) / 100 : row.fareCents / 100)
                    : null,
                  meta,
                }}
                selected={selected?.id === t.id}
                onSelect={onSelectTier}
              />
            )
          })}
        </div>
        <div className="ride-tiers__cta">
          {selected?.id === 'carpool' ? (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
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
          {selected?.id === 'carpool' && quotedTier('carpool')?.fareCents ? (
            <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>
              {seats === 1 ? '1 seat' : '2 seats'} · ${((quotedTier('carpool').fareCents * seats) / 100).toFixed(2)}
            </p>
          ) : null}
          <PrimaryButton
            className="primary-cta"
            variant="orange"
            onClick={onConfirm}
            disabled={!quote || !selected}
          >
            {!selected ? 'Choose a ride' : !quote ? 'Loading fare…' : `Select ${selected.name}`}
          </PrimaryButton>
        </div>
      </section>

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
