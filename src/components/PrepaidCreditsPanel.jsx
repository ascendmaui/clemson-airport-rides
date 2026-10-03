import { useEffect, useState } from 'react'
import { PrimaryButton } from './PrimaryButton'
import { buyCredits, fetchCredits } from '../lib/payments'
import { formatUsdFromCents } from '../lib/pricing'
import { PaymentFailedSheet } from './PaymentFailedSheet'
import { navigate } from '../lib/navigation'
import { pushToast } from '../lib/toasts'
import { A11yModalDialog } from './A11yModal'
import { prepaidPurchaseSummary } from '../../shared/prepaidTiers.js'

export function PrepaidCreditsPanel({ onPurchased }) {
  const [tiers, setTiers] = useState([])
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [failure, setFailure] = useState(null)
  const [pending, setPending] = useState(null)

  async function load() {
    try {
      const data = await fetchCredits()
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
      setUnavailable(false)
      pushToast({
        kind: 'fare_charged',
        title: 'Credits added',
        body: formatUsdFromCents(data.grantedCents),
        category: 'billing',
      })
      onPurchased?.()
      return true
    } catch (err) {
      if (err.failure) setFailure(err.failure)
      else setNote(err.message || 'Could not buy credits')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function onConfirmPurchase() {
    if (!pending) return
    const ok = await onBuy(pending.id)
    if (ok) setPending(null)
  }

  function onCancelPurchase() {
    if (busy) return
    setPending(null)
  }

  return (
    <div id="credits-panel" className="glass-panel" style={{ marginTop: 14, padding: 16, borderRadius: 18 }}>
      <div style={{ fontWeight: 800, color: 'var(--purple)' }}>Prepaid credits</div>
      <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4, lineHeight: 1.45 }}>
        Used before your default card on fares, tips, and fees. If a pack cannot be charged, nothing is added.
        Confirm the credit, bonus, and total charged before the card is charged.
      </div>
      {unavailable && (
        <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginBottom: 8 }}>
          Credit wallet is not on this database yet. Buying credits will say so instead of failing quietly. Apply supabase/payment_failure_hardening.sql to store balances.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tiers.map((tier) => (
          <PrimaryButton key={tier.id} variant="purple" disabled={busy} onClick={() => setPending(tier)}>
            {busy ? 'Charging…' : `${tier.label} · ${formatUsdFromCents(tier.priceCents)}`}
          </PrimaryButton>
        ))}
      </div>
      <A11yModalDialog
        open={Boolean(pending)}
        onClose={onCancelPurchase}
        titleId="prepaid-confirm-title"
      >
        {pending && (
          <div style={{ padding: 22, maxWidth: 420 }} data-testid="prepaid-confirm">
            <h2 id="prepaid-confirm-title" style={{ margin: '0 0 8px', color: 'var(--purple)' }}>
              {prepaidPurchaseSummary(pending).title}
            </h2>
            <p style={{ margin: '0 0 16px', lineHeight: 1.45 }}>{prepaidPurchaseSummary(pending).body}</p>
            <PrimaryButton onClick={onConfirmPurchase} disabled={busy} data-testid="prepaid-confirm-charge">
              {busy ? 'Charging…' : prepaidPurchaseSummary(pending).confirmLabel}
            </PrimaryButton>
            <button
              type="button"
              className="pressable"
              onClick={onCancelPurchase}
              disabled={busy}
              data-testid="prepaid-confirm-cancel"
              style={{ display: 'block', width: '100%', marginTop: 10, fontWeight: 700, color: 'var(--ink-secondary)' }}
            >
              {prepaidPurchaseSummary(pending).cancelLabel}
            </button>
          </div>
        )}
      </A11yModalDialog>
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
