import { useEffect, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { normalizeAmbassadorCode } from '../../packages/rides-native/shared/ambassadorAttribution.js'
import { useAuth } from '../lib/auth'
import { AMBASSADOR_CENTS_PER_SEAT, formatUsd } from '../lib/carpoolEngine'
import {
  carpoolProgram,
  claimAmbassadorAttribution,
  clearAmbassadorAttribution,
  rememberAmbassador,
} from '../lib/friendRides'
import { navigate } from '../lib/navigation'

/**
 * /ambassador is the student's own link.
 * /a/:code is the rider who opened that link. Riders never see payout amounts.
 */
export function AmbassadorScreen({ code: incoming = '' }) {
  if (String(incoming || '').trim()) {
    return <RiderAmbassadorLink code={normalizeAmbassadorCode(incoming)} />
  }
  return <AmbassadorDashboard />
}

function RiderAmbassadorLink({ code }) {
  const { user } = useAuth()
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(Boolean(code))

  useEffect(() => {
    if (!code) return undefined
    rememberAmbassador(code, user?.id || null)
    setSaved(true)
    if (!user?.id) return undefined
    let alive = true
    claimAmbassadorAttribution(code)
      .then((data) => {
        if (!alive) return
        if (data?.code) rememberAmbassador(data.code, user.id)
        setError(null)
      })
      .catch((err) => {
        if (!alive) return
        if (err?.status === 404 || err?.status === 409 || err?.payload?.code === 'own_link') {
          clearAmbassadorAttribution()
          setSaved(false)
        }
        setError(err.message)
      })
    return () => { alive = false }
  }, [code, user?.id])

  return (
    <div style={{ minHeight: '100%', padding: 24, background: 'var(--surface)' }}>
      <button type="button" className="pressable" onClick={() => navigate('carpool', { hub: '1' })}
        style={{ fontSize: 20, marginBottom: 12, width: 44, height: 44, borderRadius: 14, background: '#fff', boxShadow: 'var(--shadow-pill)' }}>←</button>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, color: '#F56600' }}>CAMPUS AMBASSADOR</div>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--purple)', letterSpacing: -0.4 }}>Referred by a campus ambassador</h1>
      <p style={{ color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
        This link attributes the carpool you book. It is not a discount, and your fare does not change.
      </p>
      {code && saved && (
        <p style={{ fontWeight: 700, color: 'var(--purple)' }}>
          {user ? 'Saved on your account.' : 'Saved on this device. Sign in so the next carpool keeps it.'}
        </p>
      )}
      {!code && <p style={{ fontWeight: 700 }}>This ambassador link is not valid.</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {!user && code && (
        <PrimaryButton onClick={() => navigate('sign-in')}>Sign in to keep this link</PrimaryButton>
      )}
      <button type="button" className="pressable" onClick={() => navigate('carpool', { hub: '1' })}
        style={{ marginTop: 20, fontWeight: 800, color: '#F56600' }}>
        Book a carpool →
      </button>
    </div>
  )
}

function AmbassadorDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!user) return undefined
    let alive = true
    carpoolProgram('ambassador')
      .then((data) => { if (alive) setStats(data) })
      .catch((err) => { if (alive) setError(err.message) })
    return () => { alive = false }
  }, [user])

  const link = stats?.link || null

  return (
    <div style={{ minHeight: '100%', padding: 24, background: 'var(--surface)' }}>
      <button type="button" className="pressable" onClick={() => navigate('carpool', { hub: '1' })}
        style={{ fontSize: 20, marginBottom: 12, width: 44, height: 44, borderRadius: 14, background: '#fff', boxShadow: 'var(--shadow-pill)' }}>←</button>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, color: '#F56600' }}>CAMPUS AMBASSADOR</div>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--purple)', letterSpacing: -0.4 }}>Get paid per carpool you start</h1>
      <p style={{ color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
        Share your link. When a completed carpool is attributed to it, you earn {formatUsd(AMBASSADOR_CENTS_PER_SEAT)} per seat
        on the payout ledger. This is an ambassador code, not a rider discount.
      </p>
      {!user && (
        <PrimaryButton onClick={() => navigate('sign-in')}>Sign in to get your link</PrimaryButton>
      )}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {stats?.code && (
        <div style={{ marginTop: 16, padding: 16, borderRadius: 16, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>Your code · {stats.code_type}</div>
          <div style={{ fontWeight: 800, fontSize: 20 }}>{stats.code}</div>
          <p style={{ fontSize: 13, wordBreak: 'break-all' }}>{link}</p>
          <button
            type="button"
            className="pressable"
            onClick={async () => {
              try { await navigator.clipboard?.writeText(link); setCopied(true) } catch { /* ignore */ }
            }}
            style={{ fontWeight: 800, color: 'var(--purple)' }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14 }}>
            <Stat label="Rides" value={stats.rides || 0} />
            <Stat label="Pending" value={formatUsd(stats.pendingCents || 0)} />
            <Stat label="Paid" value={formatUsd(stats.paidCents || 0)} />
          </div>
        </div>
      )}
      {stats?.error && <p style={{ color: 'var(--ink-secondary)', marginTop: 12 }}>{stats.error}</p>}
      <button type="button" className="pressable" onClick={() => navigate('carpool', { hub: '1' })}
        style={{ marginTop: 20, fontWeight: 800, color: '#F56600' }}>
        Book a carpool →
      </button>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ background: 'rgba(82,45,128,0.06)', borderRadius: 12, padding: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>{label}</div>
      <div style={{ fontWeight: 800 }}>{value}</div>
    </div>
  )
}
