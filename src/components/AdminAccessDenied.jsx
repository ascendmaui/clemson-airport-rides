import { ADMIN_ACCESS_REQUIRED } from '../lib/adminAccessCopy'
import { navigate } from '../lib/navigation'

export function AdminAccessDenied() {
  return (
    <div className="fade-in" style={{ minHeight: '100%', background: 'var(--surface-muted)', padding: 24 }}>
      <button type="button" className="pressable" onClick={() => navigate('account')} style={{ fontSize: 20 }}>←</button>
      <h1 style={{ color: 'var(--purple)', marginTop: 12 }}>Admin only</h1>
      <p style={{ color: 'var(--ink-secondary)', lineHeight: 1.45 }}>{ADMIN_ACCESS_REQUIRED}</p>
    </div>
  )
}
