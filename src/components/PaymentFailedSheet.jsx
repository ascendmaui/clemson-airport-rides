import { PrimaryButton } from './PrimaryButton'
import { formatUsdFromCents } from '../lib/pricing'

const LABELS = {
  retry: 'Retry payment',
  add_card: 'Add another card',
  use_credits: 'Use prepaid credits',
  buy_credits: 'Buy credits',
}

export function PaymentFailedSheet({
  failure,
  busy = false,
  onRetry,
  onAddCard,
  onUseCredits,
  onBuyCredits,
  onDismiss,
}) {
  if (!failure) return null
  const actions = {
    retry: onRetry,
    add_card: onAddCard,
    use_credits: onUseCredits,
    buy_credits: onBuyCredits,
  }
  const alternatives = failure.alternatives?.length ? failure.alternatives : ['add_card', 'use_credits', 'retry']
  const due = failure.amountDueCents != null ? formatUsdFromCents(failure.amountDueCents) : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-failed-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(11, 18, 32, 0.45)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: 12,
      }}
    >
      <div
        className="glass-panel glass-panel--elevated"
        style={{
          width: 'min(440px, 100%)',
          borderRadius: 22,
          padding: 20,
          marginBottom: 8,
          background: 'linear-gradient(165deg, #fff, rgba(245,102,0,0.08))',
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: 1.2, fontWeight: 800, color: 'var(--orange)' }}>
          PAYMENT NEEDED
        </div>
        <h2 id="payment-failed-title" style={{ fontSize: 22, fontWeight: 800, color: 'var(--purple)', margin: '6px 0 8px' }}>
          {due ? `${due} still due` : 'Payment did not go through'}
        </h2>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45, marginTop: 0 }}>
          {failure.message || 'Retry, add a card, or use prepaid credits. The trip stays open until this is paid.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          {alternatives.map((key) => {
            const fn = actions[key]
            if (!fn || !LABELS[key]) return null
            const primary = key === 'retry' || key === 'add_card'
            if (primary) {
              return (
                <PrimaryButton key={key} onClick={fn} disabled={busy} variant={key === 'add_card' ? 'purple' : 'orange'}>
                  {busy ? 'Working…' : LABELS[key]}
                </PrimaryButton>
              )
            }
            return (
              <button
                key={key}
                type="button"
                className="pressable"
                disabled={busy}
                onClick={fn}
                style={{
                  padding: 12,
                  borderRadius: 14,
                  fontWeight: 700,
                  color: 'var(--purple)',
                  border: '1.5px solid rgba(82,45,128,0.3)',
                  background: 'rgba(255,255,255,0.7)',
                }}
              >
                {LABELS[key]}
              </button>
            )
          })}
        </div>
        {onDismiss && (
          <button
            type="button"
            className="pressable"
            onClick={onDismiss}
            style={{ display: 'block', width: '100%', marginTop: 10, fontWeight: 600, color: 'var(--ink-tertiary)' }}
          >
            Close — trip stays unpaid
          </button>
        )}
      </div>
    </div>
  )
}
