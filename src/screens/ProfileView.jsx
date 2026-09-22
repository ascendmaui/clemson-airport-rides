import { useEffect, useState } from 'react'
import { getHashRoute, navigate } from '../lib/navigation'
import { fetchProfile } from '../lib/ratings'
import { isClemsonEmail } from '../lib/studentDomain'

export function ProfileView() {
  const { params } = getHashRoute()
  const id = params.id
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!id) {
      setError('Missing profile id')
      return
    }
    fetchProfile(id)
      .then(setProfile)
      .catch((e) => setError(e.message))
  }, [id])

  if (error) {
    return <div style={{ padding: 24 }}><p style={{ color: 'var(--danger)' }}>{error}</p></div>
  }
  if (!profile) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-secondary)' }}>Loading profile…</div>
  }

  const student = profile.student_verified_at || isClemsonEmail(profile.email)
  const avg = profile.rating_avg != null ? Number(profile.rating_avg).toFixed(1) : '—'
  const count = profile.rating_count || 0

  return (
    <div className="fade-in" style={{ minHeight: '100%', padding: '20px 20px 40px', maxWidth: 480, margin: '0 auto' }}>
      <button type="button" className="pressable glass-pill" onClick={() => window.history.back()} style={{ width: 40, height: 40, borderRadius: 12, marginBottom: 12 }}>←</button>
      <div className="glass-panel glass-panel--elevated" style={{ padding: 20, borderRadius: 20 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18,
            background: profile.avatar_url ? `url(${profile.avatar_url}) center/cover` : 'linear-gradient(135deg, var(--orange), var(--purple))',
            color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 22,
          }}>
            {!profile.avatar_url && (profile.full_name || '?').slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--purple)' }}>{profile.full_name || 'Rider'}</h1>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
              {profile.role || 'rider'}{student ? ' · Clemson student' : ''}
            </div>
            <div style={{ marginTop: 4, fontWeight: 600 }}>★ {avg} <span style={{ fontWeight: 500, color: 'var(--ink-tertiary)' }}>({count})</span></div>
          </div>
        </div>
        {profile.bio && <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.45, color: 'var(--ink-secondary)' }}>{profile.bio}</p>}
        {profile.vehicle && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 14, background: 'rgba(82,45,128,0.06)' }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--purple)' }}>Vehicle</div>
            <div style={{ fontSize: 14, marginTop: 4 }}>
              {[profile.vehicle.color, profile.vehicle.make, profile.vehicle.model].filter(Boolean).join(' ')}
              {profile.vehicle.plate ? ` · ${profile.vehicle.plate}` : ''}
            </div>
          </div>
        )}
        {profile.recentRatings?.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent ratings</div>
            {profile.recentRatings.map((r, i) => (
              <div key={i} style={{ fontSize: 13, marginBottom: 8, color: 'var(--ink-secondary)' }}>
                {'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}{r.comment ? ` — ${r.comment}` : ''}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
