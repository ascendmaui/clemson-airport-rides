import { useEffect, useRef, useState } from 'react'
import { BottomTabs } from '../components/BottomTabs'
import { PrimaryButton } from '../components/PrimaryButton'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'
import { fetchProfile, updateMyProfile, findPendingRatingTrip } from '../lib/ratings'
import {
  CAMPUS_SPOTS, RIDE_STYLES, PRIVACY_OPTIONS, GALLERY_KINDS,
  uploadAvatar, uploadGalleryItem, deleteGalleryItem, updateGalleryVisibility,
} from '../lib/profiles'

const chip = (on) => ({
  padding: '8px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600,
  background: on ? 'linear-gradient(135deg, var(--orange), #ff8a2b)' : 'rgba(255,255,255,0.55)',
  color: on ? '#fff' : 'var(--purple)',
  border: on ? 'none' : '1px solid rgba(82,45,128,0.15)',
  boxShadow: on ? '0 4px 14px rgba(245,102,0,0.28)' : 'none',
})

function Section({ title, subtitle, children }) {
  return (
    <div className="glass-panel" style={{ marginTop: 14, padding: 16, borderRadius: 18 }}>
      <div style={{ fontWeight: 800, color: 'var(--purple)' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginBottom: 10, marginTop: 2 }}>{subtitle}</div>}
      {!subtitle && <div style={{ height: 8 }} />}
      {children}
    </div>
  )
}

export function AccountScreen() {
  const { user, configured, signOut } = useAuth()
  const fileRef = useRef(null)
  const galleryRef = useRef(null)
  const [profile, setProfile] = useState(null)
  const [fullName, setFullName] = useState('')
  const [bio, setBio] = useState('')
  const [music, setMusic] = useState('')
  const [spots, setSpots] = useState([])
  const [styles, setStyles] = useState([])
  const [privacy, setPrivacy] = useState('matched')
  const [gallery, setGallery] = useState([])
  const [galKind, setGalKind] = useState('selfie')
  const [galVis, setGalVis] = useState('matched')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState(null)
  const [pendingRate, setPendingRate] = useState(null)
  const isDriver = profile?.role === 'driver' || profile?.role === 'both'

  async function reload() {
    if (!user?.id) return
    const p = await fetchProfile(user.id, { viewerId: user.id })
    setProfile(p)
    setFullName(p?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || '')
    setBio(p?.bio || '')
    setMusic(p?.music_taste || '')
    setSpots(Array.isArray(p?.favorite_spots) ? p.favorite_spots : [])
    setStyles((p?.ride_style || '').split('|').map((s) => s.trim()).filter(Boolean))
    setPrivacy(p?.profile_privacy || 'matched')
    setGallery(p?.gallery || [])
  }

  useEffect(() => {
    if (!user?.id) return
    reload().catch(() => {})
    findPendingRatingTrip(user.id).then(setPendingRate).catch(() => {})
  }, [user?.id])

  function toggleSpot(s) {
    setSpots((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s].slice(0, 6)))
  }
  function toggleStyle(s) {
    setStyles((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  async function onSave() {
    if (!user?.id) return
    setSaving(true); setMsg(null)
    try {
      await updateMyProfile(user.id, {
        full_name: fullName.trim() || null,
        bio: bio.trim() || null,
        music_taste: music.trim() || null,
        favorite_spots: spots,
        ride_style: styles.join(' | ') || null,
        profile_privacy: privacy,
      })
      setMsg('Profile saved')
      await reload()
    } catch (e) { setMsg(e.message || 'Save failed') }
    finally { setSaving(false) }
  }

  async function onAvatar(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user?.id) return
    setUploading(true); setMsg(null)
    try {
      await uploadAvatar(user.id, file)
      setMsg('Avatar updated')
      await reload()
    } catch (err) { setMsg(err.message || 'Avatar upload failed — confirm avatars bucket') }
    finally { setUploading(false) }
  }

  async function onGallery(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user?.id) return
    setUploading(true); setMsg(null)
    try {
      await uploadGalleryItem(user.id, file, { kind: galKind, visibility: galVis })
      setMsg('Photo added')
      await reload()
    } catch (err) { setMsg(err.message || 'Gallery upload failed — confirm gallery bucket') }
    finally { setUploading(false) }
  }

  async function onSignOut() {
    try { await signOut() } catch {}
    navigate('landing')
  }

  const avg = profile?.rating_avg != null ? Number(profile.rating_avg).toFixed(1) : '—'
  const count = profile?.rating_count || 0
  const kinds = GALLERY_KINDS.filter((k) => !k.driversOnly || isDriver)

  return (
    <div className="route-fade" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: '20px 18px 28px', overflowY: 'auto' }}>
        <button type="button" className="pressable glass-pill" onClick={() => navigate('home')}
          style={{ width: 40, height: 40, borderRadius: 12, marginBottom: 10 }}>←</button>

        {pendingRate && (
          <div className="glass-panel" style={{ padding: 14, borderRadius: 16, marginBottom: 14,
            background: 'linear-gradient(135deg, rgba(245,102,0,0.16), rgba(82,45,128,0.14))' }}>
            <div style={{ fontWeight: 700, color: 'var(--purple)', marginBottom: 4 }}>Rate your last ride?</div>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 10 }}>
              Soft reminder — {pendingRate.pickup_label || 'Pickup'} → {pendingRate.dropoff_label || 'Dropoff'}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="pressable" onClick={() => navigate('rate', { trip: pendingRate.id })}
                style={{ flex: 1, padding: 10, borderRadius: 12, fontWeight: 700, color: '#fff',
                  background: 'linear-gradient(135deg, var(--orange), #ff7a1a)' }}>Rate now</button>
              <button type="button" className="pressable" onClick={() => setPendingRate(null)}
                style={{ padding: '10px 14px', borderRadius: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}>Later</button>
            </div>
          </div>
        )}

        <div className="glass-panel glass-panel--elevated" style={{ padding: 18, borderRadius: 22,
          background: 'linear-gradient(160deg, rgba(255,255,255,0.78), rgba(82,45,128,0.08) 55%, rgba(245,102,0,0.10))' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <button type="button" className="pressable" onClick={() => fileRef.current?.click()} aria-label="Upload avatar"
              style={{ width: 76, height: 76, borderRadius: 22, flexShrink: 0, position: 'relative', overflow: 'hidden',
                background: profile?.avatar_url ? `url(${profile.avatar_url}) center/cover`
                  : 'linear-gradient(135deg, var(--orange), var(--purple))',
                color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 26,
                boxShadow: '0 8px 24px rgba(82,45,128,0.25)' }}>
              {!profile?.avatar_url && (fullName || '?').slice(0, 1).toUpperCase()}
              <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.45)',
                fontSize: 10, fontWeight: 700, padding: '3px 0' }}>{uploading ? '…' : 'Edit'}</span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatar} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, letterSpacing: 1.2, fontWeight: 700, color: 'var(--orange)' }}>YOUR VIBE</div>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Display name"
                style={{ width: '100%', marginTop: 4, fontSize: 22, fontWeight: 800, color: 'var(--purple)',
                  border: 'none', background: 'transparent', outline: 'none' }} />
              <div style={{ marginTop: 4, fontWeight: 700 }}>
                ★ {avg} <span style={{ fontWeight: 500, color: 'var(--ink-tertiary)', fontSize: 13 }}>({count} ratings · read-only)</span>
              </div>
            </div>
          </div>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={2}
            placeholder="Bio — e.g. Junior · architecture · GSP regular"
            style={{ width: '100%', marginTop: 14, padding: 12, borderRadius: 14,
              border: '1px solid rgba(82,45,128,0.12)', background: 'rgba(255,255,255,0.55)', resize: 'vertical' }} />
        </div>

        <Section title="Favorite campus spots" subtitle="Pick up to 6 chips">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {CAMPUS_SPOTS.map((s) => (
              <button key={s} type="button" className="pressable" onClick={() => toggleSpot(s)} style={chip(spots.includes(s))}>{s}</button>
            ))}
          </div>
        </Section>

        <Section title="Ride style" subtitle="Quiet / Chatty / Music / AC">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {RIDE_STYLES.map((s) => {
              const on = styles.includes(s.id)
              return (
                <button key={s.id} type="button" className="pressable" onClick={() => toggleStyle(s.id)}
                  style={{ padding: '10px 14px', borderRadius: 16, fontSize: 13, fontWeight: 700,
                    background: on ? 'rgba(82,45,128,0.92)' : 'rgba(255,255,255,0.55)',
                    color: on ? '#fff' : 'var(--ink)', border: on ? 'none' : '1px solid rgba(82,45,128,0.12)' }}>
                  {s.emoji} {s.id}
                </button>
              )
            })}
          </div>
          <input value={music} onChange={(e) => setMusic(e.target.value)} placeholder="Music taste — indie, country, silence…"
            style={{ width: '100%', marginTop: 12, padding: 12, borderRadius: 14,
              border: '1px solid rgba(82,45,128,0.12)', background: 'rgba(255,255,255,0.55)' }} />
        </Section>

        <Section title="Privacy" subtitle="Who sees your vibe + gallery">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PRIVACY_OPTIONS.map((o) => {
              const on = privacy === o.id
              return (
                <button key={o.id} type="button" className="pressable" onClick={() => setPrivacy(o.id)}
                  style={{ textAlign: 'left', padding: 12, borderRadius: 14,
                    background: on ? 'rgba(82,45,128,0.12)' : 'rgba(255,255,255,0.45)',
                    border: on ? '1.5px solid var(--purple)' : '1px solid rgba(82,45,128,0.1)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--purple)' }}>{o.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>{o.hint}</div>
                </button>
              )
            })}
          </div>
        </Section>

        <Section title="Gallery" subtitle="Selfie · car · campus — MVP self-serve, no admin review">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {kinds.map((k) => (
              <button key={k.id} type="button" className="pressable" onClick={() => setGalKind(k.id)}
                style={{ padding: '6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                  background: galKind === k.id ? 'var(--orange)' : 'rgba(255,255,255,0.5)',
                  color: galKind === k.id ? '#fff' : 'var(--ink-secondary)' }}>{k.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {['public', 'matched', 'private'].map((v) => (
              <button key={v} type="button" className="pressable" onClick={() => setGalVis(v)}
                style={{ flex: 1, padding: 8, borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'capitalize',
                  background: galVis === v ? 'rgba(82,45,128,0.9)' : 'rgba(255,255,255,0.5)',
                  color: galVis === v ? '#fff' : 'var(--ink-secondary)' }}>{v}</button>
            ))}
          </div>
          <button type="button" className="pressable" onClick={() => galleryRef.current?.click()} disabled={uploading}
            style={{ width: '100%', padding: 12, borderRadius: 14, fontWeight: 700, color: 'var(--purple)',
              border: '1.5px dashed rgba(82,45,128,0.35)', background: 'rgba(255,255,255,0.4)' }}>
            {uploading ? 'Uploading…' : `+ Add ${galKind} photo`}
          </button>
          <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onGallery} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
            {gallery.map((g) => (
              <div key={g.id} style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', aspectRatio: '1' }}>
                <div style={{ width: '100%', height: '100%',
                  background: g.public_url ? `url(${g.public_url}) center/cover` : 'var(--purple-soft)' }} />
                <div style={{ position: 'absolute', left: 6, bottom: 6, right: 6, display: 'flex', gap: 4, justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', textShadow: '0 1px 4px #000' }}>{g.kind} · {g.visibility}</span>
                  <button type="button" className="pressable" onClick={async () => {
                    try { await deleteGalleryItem(user.id, g); await reload() } catch (err) { setMsg(err.message) }
                  }} style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,0.45)', padding: '2px 6px', borderRadius: 8 }}>Del</button>
                </div>
                <select value={g.visibility} onChange={async (e) => {
                  try { await updateGalleryVisibility(user.id, g.id, e.target.value); await reload() } catch (err) { setMsg(err.message) }
                }} style={{ position: 'absolute', top: 6, right: 6, fontSize: 10, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.85)', padding: '2px 4px' }}>
                  <option value="public">public</option>
                  <option value="matched">matched</option>
                  <option value="private">private</option>
                </select>
              </div>
            ))}
          </div>
        </Section>

        <PrimaryButton onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</PrimaryButton>
        {msg && <div style={{ fontSize: 13, marginTop: 10, color: 'var(--ink-secondary)', textAlign: 'center' }}>{msg}</div>}
        {user?.id && (
          <button type="button" className="pressable" onClick={() => navigate('profile', { id: user.id })}
            style={{ display: 'block', margin: '14px auto 0', fontWeight: 700, color: 'var(--purple)' }}>
            Preview how others see you →
          </button>
        )}

        <div className="glass-panel" style={{ marginTop: 18, padding: 16, borderRadius: 18 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Session</div>
          <div style={{ fontSize: 13, color: 'var(--ink-tertiary)', marginBottom: 12 }}>
            {configured ? user?.email || 'Signed in' : 'Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY'}
          </div>
          <button type="button" className="pressable" onClick={() => navigate('driver')} style={{ fontWeight: 600, color: 'var(--purple)' }}>
            Switch to driver mode →
          </button>
          <button type="button" className="pressable primary-cta" onClick={onSignOut}
            style={{ display: 'block', width: '100%', marginTop: 16, padding: 14, borderRadius: 14,
              background: 'linear-gradient(135deg, var(--orange) 0%, #ff7a1a 100%)',
              color: '#fff', fontWeight: 700, boxShadow: 'var(--shadow-cta)' }}>
            Sign out
          </button>
        </div>
      </div>
      <BottomTabs active="account" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}
