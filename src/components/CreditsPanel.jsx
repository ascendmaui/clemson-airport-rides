import { useEffect, useState } from 'react'
import { PrimaryButton } from './PrimaryButton'
import { buyCredits, fetchCredits } from '../lib/payments'
import { formatUsdFromCents } from '../lib/pricing'
import { PaymentFailedSheet } from './PaymentFailedSheet'
import { navigate } from '../lib/navigation'
import { pushToast } from '../lib/toasts'

export function CreditsPanel() {
  const [balance, setBalance] = useState(null)
  const [tiers, setTiers] = useState([])
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [failure, setFailure] = useState(null)

  async function load() {
    try {
      const data = await fetchCredits()
      setBalance(data.balanceCents)
      setTiers(data.tiers || [])
      setUnavailable(Boolean(data.unavailable))
    } catch (err) {
      setNote(err.message || 'Could not load credits')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function onBuy(tierId) {
    setBusy(true)
    setNote(null)
    setFailure(null)
    try {
      const data = await buyCredits(tierId)
      setBalance(data.balanceCents)
      setUnavailable(false)
      pushToast({
        kind: 'fare_charged',
        title: 'Credits added',
        body: formatUsdFromCents(data.grantedCents),
        category: 'billing',
      })
    } catch (err) {
      if (err.failure) setFailure(err.failure)
      else setNote(err.message || 'Could not buy credits')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="credits-panel" className="glass-panel" style={{ marginTop: 14, padding: 16, borderRadius: 18 }}>
      <div style={{ fontWeight: 800, color: 'var(--purple)' }}>Prepaid credits</div>
      <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4, lineHeight: 1.45 }}>
        Used before your default card on fares, tips, and fees. If a pack cannot be charged, nothing is added.
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, margin: '12px 0', color: 'var(--ink)' }}>
        {balance == null ? '…' : formatUsdFromCents(balance)}
      </div>
      {unavailable && (
        <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginBottom: 8 }}>
          Credit wallet is not on this database yet. Buying credits will say so instead of failing quietly. Apply supabase/payment_failure_hardening.sql to store balances.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tiers.map((tier) => (
          <PrimaryButton key={tier.id} variant="purple" disabled={busy} onClick={() => onBuy(tier.id)}>
            {busy ? 'Charging…' : `${tier.label} · ${formatUsdFromCents(tier.priceCents)}`}
          </PrimaryButton>
        ))}
      </div>
      {note && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{note}</div>}
      <PaymentFailedSheet
        failure={failure}
        busy={busy}
        onRetry={() => setFailure(null)}
        onAddCard={() => navigate('account', { tab: 'billing' })}
        onUseCredits={() => setNote('Add a credit pack, or retry the ride charge once a balance is available.')}
        onBuyCredits={() => setFailure(null)}
        onDismiss={() => setFailure(null)}
      />
    </div>
  )
}
