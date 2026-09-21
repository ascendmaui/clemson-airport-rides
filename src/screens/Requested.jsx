import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'

export function Requested({ dest = 'GSP Airport', trip = '', driver = 'your driver' }) {
  return (
    <div className="fade-in" style={{ minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div className="glass-panel glass-panel--elevated" style={{ padding: 24, borderRadius: 20 }}>
        <div style={{ fontSize: 13, letterSpacing: 1.4, fontWeight: 700, color: 'var(--orange)', marginBottom: 8 }}>
          REQUESTED
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8 }}>
          {driver} is on the list
        </h1>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 15, lineHeight: 1.45 }}>
          Trip saved to Supabase as <strong>requested</strong> toward {dest}.
          {trip ? ` ID ${trip.slice(0, 8)}…` : ''}
        </p>
        <div style={{ marginTop: 20 }}>
          <PrimaryButton onClick={() => navigate('home')}>Back home</PrimaryButton>
        </div>
      </div>
    </div>
  )
}
