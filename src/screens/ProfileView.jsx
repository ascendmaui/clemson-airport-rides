import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { getHashRoute } from '../lib/navigation'
import { fetchFullProfile } from '../lib/profiles'

export function ProfileView() {
  const { user } = useAuth()
  const { params } = getHashRoute()
  const id = params.id
  const matchedHint = params.matched === '1' || params.matched === 'true'
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!id) {
      setError('Missing profile id')
      return
    }
    fetchFullProfile(id, { viewerId: user?.id || null, assumeMatched: matchedHint })
      .then(setProfile)
      .catch((e) => setError(e.message))
  }, [id, user?.id, matchedHint])

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      </div>
    )
  }
  if (!profile) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-secondary)' }}>
        Loading profile…
      </div>
    )
  }

  const minimal = profile._access === 'minimal' || profile._access === 'matched_locked'
  const avg = profile.rating_avg != null ? Number(profile.rating_avg).toFixed(1) : '—'
  const count = profile.rating_count || 0
  const spots = profile.favorite_spots || []
  const styles = (profile.ride_style || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
  const gallery = (profile.gallery || []).filter((g) => g.public_url)

  return (
    <div
      className="fade-in"
      style={{ minHeight: '100%', padding: '20px 18px 40px', maxWidth: 480, margin: '0 auto' }}
    >
      <button
        type="button"
        className="pressable glass-pill"
        onClick={() => window.history.back()}
        style={{ width: 40, height: 40, borderRadius: 12, marginBottom: 12 }}
      >
        ←
      </button>

      <div
        className="glass-panel glass-panel--elevated"
        style={{
          padding: 20,
          borderRadius: 22,
          background:
            'linear-gradient(165deg, rgba(255,255,255,0.82), rgba(82,45,128,0.10) 50%, rgba(245,102,0,0.12))',
        }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              background: profile.avatar_url
                ? `url(${profile.avatar_url}) center/cover`
                : 'linear-gradient(135deg, var(--orange), var(--purple))',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: 26,
              boxShadow: '0 10px 28px rgba(82,45,128,0.28)',
              flexShrink: 0,
            }}
          >
            {!profile.avatar_url && (profile.full_name || '?').slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: 1.3,
                fontWeight: 700,
                color: 'var(--orange)',
              }}
            >
              CLEMSON RIDES
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--purple)', letterSpacing: -0.3 }}>
              {profile.full_name || 'Rider'}
            </h1>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
              {profile.role || 'rider'}
              {profile.student_verified_at ? ' · verified student' : ''}
            </div>
            <div style={{ marginTop: 4, fontWeight: 700 }}>
              ★ {avg}{' '}
              <span style={{ fontWeight: 500, color: 'var(--ink-tertiary)' }}>({count})</span>
            </div>
          </div>
        </div>

        {minimal && (
          <p style={{ marginTop: 14, fontSize: 13, color: 'var(--ink-tertiary)', lineHeight: 1.4 }}>
            This profile is {profile.profile_privacy === 'private' ? 'private' : 'matched-only'}. You’ll
            see more vibe details once you’re on a ride together.
          </p>
        )}

        {!minimal && profile.bio && (
          <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.45, color: 'var(--ink-secondary)' }}>
            {profile.bio}
          </p>
        )}

        {!minimal && styles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {styles.map((s) => (
              <span
                key={s}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                  background: 'rgba(82,45,128,0.12)',
                  color: 'var(--purple)',
                }}
              >
                {s}
              </span>
            ))}
          </div>
        )}

        {!minimal && profile.music_taste && (
          <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-secondary)' }}>
            🎵 {profile.music_taste}
          </div>
        )}

        {!minimal && spots.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--purple)', marginBottom: 8 }}>
              Favorite spots
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {spots.map((s) => (
                <span
                  key={s}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    background: 'rgba(245,102,0,0.12)',
                    color: 'var(--orange)',
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {!minimal && profile.vehicle && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 14,
              background: 'rgba(82,45,128,0.06)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--purple)' }}>Vehicle</div>
            <div style={{ fontSize: 14, marginTop: 4 }}>
              {[profile.vehicle.color, profile.vehicle.make, profile.vehicle.model]
                .filter(Boolean)
                .join(' ')}
              {profile.vehicle.plate ? ` · ${profile.vehicle.plate}` : ''}
            </div>
          </div>
        )}

        {!minimal && gallery.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--purple)' }}>Gallery</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {gallery.map((g) => (
                <div
                  key={g.id}
                  title={g.caption || g.kind}
                  style={{
                    aspectRatio: '1',
                    borderRadius: 12,
                    background: `url(${g.public_url}) center/cover`,
                    boxShadow: '0 4px 12px rgba(11,18,32,0.08)',
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {!minimal && profile.recentRatings?.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent ratings</div>
            {profile.recentRatings.map((r, i) => (
              <div key={i} style={{ fontSize: 13, marginBottom: 8, color: 'var(--ink-secondary)' }}>
                {'★'.repeat(r.stars)}
                {'☆'.repeat(5 - r.stars)}
                {r.comment ? ` — ${r.comment}` : ''}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
