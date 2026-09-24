import { useEffect, useState } from 'react'
import { CampusMap, STADIUM } from '../components/CampusMap'
import { TierRow } from '../components/TierRow'
import { PrimaryButton } from '../components/PrimaryButton'
import { UpsellModal } from '../components/UpsellModal'
import { navigate } from '../lib/navigation'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'
import { SurgeBadge } from '../components/SurgeBadge'
import { GameDayStatus } from '../components/GameDayStatus'
import { quoteWithSurge } from '../lib/pricing'
import { useGameDayNotice } from '../lib/useGameDayNotice'
import { useStudentStatus } from '../lib/useStudentStatus'
import { STUDENT_DISCOUNT_LABEL, displayTierPrice } from '../../packages/rides-native/riderMoney.js'

const TIERS = [
  { id: 'standard', name: 'Standard', icon: '🚗', eta: '4 min', meta: '4 seats', price: 18.5 },
  { id: 'wait', name: 'Wait & Save', icon: '⏱️', eta: '12 min', meta: 'Save ~20%', price: 14.2 },
  { id: 'comfort', name: 'Extra Comfort', icon: '✨', eta: '6 min', meta: 'Newer cars', price: 23.0 },
  { id: 'xl', name: 'XL', icon: '🚐', eta: '8 min', meta: '6 seats', price: 28.75 },
  { id: 'pet', name: 'Pet', icon: '🐶', eta: '9 min', meta: 'Pet-friendly', price: 21.0 },
  { id: 'tesla', name: 'Self-Driving Tesla Model 3', icon: '⚡', eta: '7 min', meta: 'Premium · self-driving capable', price: 36.0, premium: true, badge: 'TESLA' },
]

export function RideTiers({ dest = '1900 GSP Dr' }) {
  const [selected, setSelected] = useState(TIERS[0])
  const [upsell, setUpsell] = useState(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [surge, setSurge] = useState(null)
  const { runOrPrompt } = useRequireAuthForAction()
  const student = useStudentStatus()
  const game = useGameDayNotice()

  useEffect(() => {
    let alive = true
    quoteWithSurge({ miles: 3, minutes: 10, airport: false, isStudent: student.verified })
      .then((q) => { if (alive) setSurge(q.surge) })
      .catch(() => {})
    return () => { alive = false }
  }, [student.verified])

  const surgeMul = surge?.multiplier > 1 ? surge.multiplier : 1

  const onSelectTier = (tier) => {
    setSelected(tier)
  }

  const openDrivers = (tierId) => {
    const row = TIERS.find((tier) => tier.id === tierId) || selected
    const quoted = displayTierPrice(row.price, {
      isStudent: student.verified,
      tier: row.id,
      surgeMultiplier: surgeMul,
    })
    navigate('pick-driver', {
      dest,
      tier: row.id,
      listCents: String(quoted.fareCents + quoted.discountCents),
    })
  }

  const proceedRequest = () => {
    if (selected.id === 'standard') {
      setUpsell('comfort')
      return
    }
    if (selected.id === 'comfort') {
      setUpsell('tesla')
      return
    }
    openDrivers(selected.id)
  }

  const onConfirm = () => {
    runOrPrompt(proceedRequest, {
      setPromptOpen,
      nextPath: 'tiers',
      nextParams: { dest },
    })
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent' }}>
      <div style={{ padding: '12px 16px 0' }}>
        <button type="button" className="pressable glass-pill" onClick={() => navigate('confirm', { dest })} style={{ fontSize: 20, marginBottom: 8, width: 40, height: 40, borderRadius: 12 }}>←</button>
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
          {student.verified ? `🐯 ${STUDENT_DISCOUNT_LABEL}` : '🐯 Claim Clemson student pricing · 10% off Standard'}
        </div>
        <button
          type="button"
          className="pressable"
          onClick={() => navigate('account', { tab: 'student' })}
          style={{ display: 'block', marginTop: 8, fontSize: 12, fontWeight: 700, color: '#522D80' }}
        >
          {student.verified ? 'Student pricing is saved on your profile' : 'Verify a Clemson email'}
        </button>
        <div style={{ marginTop: 8 }}>
          <SurgeBadge surge={surge} />
        </div>
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
          {TIERS.map((t) => {
            const quoted = displayTierPrice(t.price, {
              isStudent: student.verified,
              tier: t.id,
              surgeMultiplier: surgeMul,
            })
            return (
              <TierRow
                key={t.id}
                tier={{
                  ...t,
                  price: quoted.price,
                  meta: quoted.label ? `${t.meta} · ${quoted.label}` : t.meta,
                }}
                selected={selected.id === t.id}
                onSelect={onSelectTier}
              />
            )
          })}
        </div>
        <div style={{ padding: '12px 8px 0' }}>
          <PrimaryButton
            className="primary-cta"
            variant={selected.premium ? 'purple' : 'orange'}
            onClick={onConfirm}
          >
            Select {selected.name.split(' ')[0] === 'Self-Driving' ? 'Tesla' : selected.name}
          </PrimaryButton>
        </div>
      </div>

      <UpsellModal
        open={upsell === 'comfort'}
        variant="comfort"
        upgradePrice={4.5}
        onClose={() => {
          setUpsell(null)
          openDrivers(selected.id)
        }}
        onUpgrade={() => {
          setSelected(TIERS.find((t) => t.id === 'comfort'))
          setUpsell(null)
        }}
      />
      <UpsellModal
        open={upsell === 'tesla'}
        variant="tesla"
        upgradePrice={13.0}
        onClose={() => {
          setUpsell(null)
          openDrivers(selected.id)
        }}
        onUpgrade={() => {
          setSelected(TIERS.find((t) => t.id === 'tesla'))
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
