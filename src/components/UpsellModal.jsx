import { PrimaryButton } from './PrimaryButton'
import { useModalA11y } from './A11yModal'

export function UpsellModal({ open, onClose, onUpgrade, upgradePrice = 4.5 }) {
  const dialogRef = useModalA11y({ isOpen: open, onClose })

  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upsell-modal-title"
      className="route-fade"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(11,18,32,0.48)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--surface)',
          padding: 24,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            height: 140,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #FFF4EC, #F3EEF8)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 56,
            marginBottom: 18,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
          }}
        >
          ✨
        </div>
        <h2 id="upsell-modal-title" style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, marginBottom: 8 }}>
          Ride in a roomy, clean new car
        </h2>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 15, lineHeight: 1.45, marginBottom: 22 }}>
          Upgrade and treat yourself to Extra Comfort.
        </p>
        <PrimaryButton variant="orange" onClick={onUpgrade}>
          Upgrade for ${upgradePrice.toFixed(2)} more
        </PrimaryButton>
        <button
          type="button"
          className="pressable"
          onClick={onClose}
          style={{
            width: '100%',
            marginTop: 12,
            padding: 12,
            fontWeight: 600,
            fontSize: 16,
            color: 'var(--ink-secondary)',
          }}
        >
          Not now
        </button>
      </div>
    </div>
  )
}
