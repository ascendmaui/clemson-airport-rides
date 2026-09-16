import { PrimaryButton } from './PrimaryButton'

export function UpsellModal({ open, onClose, onUpgrade, variant = 'comfort', upgradePrice = 4.5 }) {
  if (!open) return null
  const isTesla = variant === 'tesla'
  return (
    <div
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
          style={{
            height: 140,
            borderRadius: 16,
            background: isTesla
              ? 'linear-gradient(135deg, #F3EEF8, #E8E0F0)'
              : 'linear-gradient(135deg, #FFF4EC, #F3EEF8)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 56,
            marginBottom: 18,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
          }}
        >
          {isTesla ? '🚗' : '✨'}
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, marginBottom: 8 }}>
          {isTesla
            ? 'Upgrade to a self-driving Tesla Model 3'
            : 'Ride in a roomy, clean new car'}
        </h2>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 15, lineHeight: 1.45, marginBottom: 22 }}>
          {isTesla
            ? 'Premium Tesla · self-driving capable. Treat yourself to the Clemson fleet upgrade.'
            : 'Upgrade and treat yourself to Extra Comfort.'}
        </p>
        <PrimaryButton variant={isTesla ? 'purple' : 'orange'} onClick={onUpgrade}>
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
