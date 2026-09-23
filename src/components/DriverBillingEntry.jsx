import { navigate } from '../lib/navigation'

/** Driver mode has no bottom tabs. This opens the same Account → Billing screen riders use. */
export function DriverBillingEntry() {
  return (
    <button
      type="button"
      className="pressable"
      data-testid="driver-billing-entry"
      onClick={() => navigate('account', { tab: 'billing' })}
      style={{
        position: 'absolute',
        top: 68,
        right: 16,
        zIndex: 40,
        padding: '8px 12px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        color: 'var(--purple)',
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid rgba(82,45,128,0.22)',
        boxShadow: 'var(--shadow-pill)',
      }}
    >
      Billing
    </button>
  )
}
