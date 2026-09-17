import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'

/** Soft auth gate helpers + "Sign in to book your ride" modal. */
export function resumeAfterAuth(params = {}) {
  const next = params.next || 'home'
  const { next: _n, ...rest } = params
  navigate(next, rest)
}

export function useRequireAuthForAction() {
  const { user, loading } = useAuth()
  const runOrPrompt = (action, { setPromptOpen, nextPath, nextParams } = {}) => {
    if (loading) return
    if (user) {
      action?.()
      return
    }
    setPromptOpen?.(true)
  }
  return { user, loading, runOrPrompt, isAuthed: Boolean(user) }
}

export function SignInToBookModal({ open, onClose, nextPath, nextParams = {} }) {
  if (!open) return null

  const goSignIn = () => {
    onClose?.()
    navigate('sign-in', { next: nextPath || 'home', ...nextParams })
  }
  const goSignUp = () => {
    onClose?.()
    navigate('sign-up', { next: nextPath || 'home', ...nextParams })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-in-to-book-title"
      className="glass-overlay fade-in"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        background: 'rgba(11,18,32,0.42)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="modal-card glass-panel glass-panel--elevated"
        style={{
          width: '100%',
          maxWidth: 480,
          margin: '0 12px calc(16px + var(--safe-bottom))',
          padding: '22px 22px 20px',
          borderRadius: 24,
        }}
      >
        <div className="sheet-handle" />
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(82,45,128,0.18), rgba(245,102,0,0.2))',
            display: 'grid',
            placeItems: 'center',
            fontSize: 22,
            marginBottom: 14,
            border: '1px solid rgba(255,255,255,0.35)',
          }}
        >
          🐯
        </div>
        <h2 id="sign-in-to-book-title" style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4 }}>
          Sign in to book your ride
        </h2>
        <p style={{ marginTop: 8, color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
          Browse freely — login is only needed when you request a ride or pay the 25% deposit.
        </p>
        <button
          type="button"
          className="pressable primary-cta"
          onClick={goSignIn}
          style={{
            width: '100%',
            marginTop: 18,
            padding: '15px 20px',
            borderRadius: 14,
            background: 'var(--orange)',
            color: '#fff',
            fontWeight: 600,
            fontSize: 17,
            boxShadow: 'var(--shadow-cta)',
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          className="pressable"
          onClick={goSignUp}
          style={{
            width: '100%',
            marginTop: 10,
            padding: 12,
            fontWeight: 600,
            color: 'var(--purple)',
          }}
        >
          Create account
        </button>
        <button
          type="button"
          className="pressable"
          onClick={onClose}
          style={{
            width: '100%',
            marginTop: 4,
            padding: 10,
            fontWeight: 500,
            color: 'var(--ink-tertiary)',
            fontSize: 13,
          }}
        >
          Keep browsing
        </button>
      </div>
    </div>
  )
}
