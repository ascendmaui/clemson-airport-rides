import { useState } from 'react'
import { collectTripPayment } from '../lib/payments'
import { formatUsdFromCents } from '../lib/pricing'
import { PaymentFailedSheet } from './PaymentFailedSheet'
import { navigate } from '../lib/navigation'
import { pushToast } from '../lib/toasts'

const TIP_CENTS = [200, 500, 1000]

export function TipCharge({ tripId }) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const [paid, setPaid] = useState(null)
  const [pendingTip, setPendingTip] = useState(null)

  async function charge(cents, methods) {
    setBusy(true)
    setFailure(null)
    try {
      const result = await collectTripPayment({
        tripId,
        amountCents: cents,
        kind: 'tip',
        methods: methods || ['credits', 'card'],
        idempotencyKey: `tip:${tripId}:${cents}`,
      })
      setPaid(cents)
      setPendingTip(null)
      pushToast({
        kind: 'fare_charged',
        title: 'Tip sent',
        body: formatUsdFromCents(cents),
        category: 'billing',
      })
      return result
    } catch (err) {
      setPendingTip(cents)
      const failureBody = err.failure || {
        code: 'charge_failed',
        message: err.message || 'Tip was not charged.',
        alternatives: ['add_card', 'use_credits', 'buy_credits', 'retry'],
        amountDueCents: cents,
      }
      setFailure(failureBody)
      pushToast({
        kind: 'payment_failed',
        title: 'Tip not charged',
        body: failureBody.message,
        category: 'billing',
      })
      return null
    } finally {
      setBusy(false)
    }
  }

  if (paid) {
    return (
      <div style={{ marginTop: 14, fontSize: 13, fontWeight: 700, color: 'var(--purple)' }}>
        Tip of {formatUsdFromCents(paid)} paid. Thanks.
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 800, color: 'var(--purple)', marginBottom: 8 }}>Add a tip</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {TIP_CENTS.map((cents) => (
          <button
            key={cents}
            type="button"
            className="pressable"
            disabled={busy}
            onClick={() => charge(cents)}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 14,
              fontWeight: 800,
              color: 'var(--purple)',
              background: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(82,45,128,0.2)',
            }}
          >
            {formatUsdFromCents(cents)}
          </button>
        ))}
      </div>
      <PaymentFailedSheet
        failure={failure}
        busy={busy}
        onRetry={() => pendingTip && charge(pendingTip)}
        onAddCard={() => navigate('account', { tab: 'billing' })}
        onUseCredits={() => pendingTip && charge(pendingTip, ['credits', 'card'])}
        onBuyCredits={() => navigate('account', { tab: 'billing' })}
        onDismiss={() => setFailure(null)}
      />
    </div>
  )
}
