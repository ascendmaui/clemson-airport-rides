import { useEffect, useRef, useState } from 'react'
import { BottomTabs } from '../components/BottomTabs'
import { PrimaryButton } from '../components/PrimaryButton'
import { BillingPanel } from '../components/BillingPanel'
import {
  IconBell, IconCard, IconCar, IconHelp, IconPrivacy, IconProfile,
  IconSettings, IconSignOut, IconStudent, IconShare,
} from '../components/icons'
import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import { fetchProfile, updateMyProfile, findPendingRatingTrip } from '../lib/ratings'
import {
  CAMPUS_SPOTS, RIDE_STYLES, PRIVACY_OPTIONS, GALLERY_KINDS,
  uploadAvatar, uploadGalleryItem, deleteGalleryItem, updateGalleryVisibility,
} from '../lib/profiles'
import {
  NOTIFICATION_CATEGORIES, DEFAULT_NOTIFICATION_PREFS,
  fetchNotificationPrefs, saveNotificationPrefs,
} from '../lib/notificationPrefs'
import { useToasts, pushToast } from '../lib/toasts'
import { isClemsonEmail } from '../lib/studentDomain'
import { fetchMyDriverApplication, isAdminIdentity, onboardingLabel } from '../lib/driverOnboarding'
import { ReferFriendsPanel } from './ReferFriends'
import { isIncentiveAdmin } from '../lib/driverIncentiveMath'

const chip = (on) => ({
  padding: '8px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600,
  background: on ? 'linear-gradient(135deg, var(--orange), #ff8a2b)' : 'rgba(255,255,255,0.55)',
  color: on ? '#fff' : 'var(--purple)',
  border: on ? 'none' : '1px solid rgba(82,45,128,0.15)',
  boxShadow: on ? '0 4px 14px rgba(245,102,0,0.28)' : 'none',
})

function Section({ title, subtitle, children, icon: Icon }) {
  return (
    <div className="glass-panel" style={{ marginTop: 14, padding: 16, borderRadius: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {Icon ? <Icon size={20} /> : null}
        <div style={{ fontWeight: 800, color: 'var(--purple)' }}>{title}</div>
      </div>
      {subtitle && <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginBottom: 10, marginTop: 2 }}>{subtitle}</div>}
      {!subtitle && <div style={{ height: 8 }} />}
      {children}
    </div>
  )
}

const NAV = [
  { id: 'profile', label: 'Profile', Icon: IconProfile },
  { id: 'refer', label: 'Refer friends', Icon: IconShare },
  { id: 'notifications', label: 'Alerts', Icon: IconBell },
  { id: 'billing', label: 'Billing', Icon: IconCard },
  { id: 'vehicle', label: 'Vehicle', Icon: IconCar },
  { id: 'student', label: 'Student', Icon: IconStudent },
  { id: 'privacy', label: 'Privacy', Icon: IconPrivacy },
  { id: 'help', label: 'Help', Icon: IconHelp },
]

const ACCOUNT_TABS = new Set(NAV.map((n) => n.id))

function tabFromHash() {
  const { path, params } = getHashRoute()
  if (path === 'account' && ACCOUNT_TABS.has(params.tab)) return params.tab
  return 'profile'
}

export function AccountScreen() {
  const { user, configured, signOut } = useAuth()
  const { setPrefsCache } = useToasts()
  const fileRef = useRef(null)
  const galleryRef = useRef(null)
  const [tab, setTab] = useState(tabFromHash)
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
  const [prefs, setPrefs] = useState({ ...DEFAULT_NOTIFICATION_PREFS })
  const [prefsNote, setPrefsNote] = useState(null)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [application, setApplication] = useState(null)
  const isDriver = profile?.role === 'driver' || profile?.role === 'both'
  const isAdmin = isAdminIdentity({
    jwtEmail: user?.email,
    role: profile?.role,
    isAdmin: profile?.is_admin,
  })

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
    fetchMyDriverApplication(user.id).then(setApplication).catch(() => setApplication(null))
  }

  useEffect(() => {
    const sync = () => setTab(tabFromHash())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  function selectTab(id) {
    if (!ACCOUNT_TABS.has(id)) return
    setTab(id)
    const { path, params } = getHashRoute()
    if (path === 'account' && params.tab === id) return
    navigate('account', { tab: id })
  }

  useEffect(() => {
    if (!user?.id) return
    reload().catch(() => {})
    findPendingRatingTrip(user.id).then(setPendingRate).catch(() => {})
    fetchNotificationPrefs(user.id).then(({ prefs: p, softFail, persisted }) => {
      setPrefs(p)
      setPrefsCache(p)
      if (softFail) {
        setPrefsNote(`Saved locally — profiles.notification_prefs unavailable (${softFail})`)
      } else if (!persisted) {
        setPrefsNote(null)
      } else {
        setPrefsNote(null)
      }
    })
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  async function onTogglePref(id) {
    if (!user?.id) return
    const next = { ...prefs, [id]: !prefs[id] }
    setPrefs(next)
    setPrefsCache(next)
    setPrefsSaving(true)
    const res = await saveNotificationPrefs(user.id, next)
    setPrefsSaving(false)
    setPrefs(res.prefs)
    setPrefsCache(res.prefs)
    if (res.softFail) {
      setPrefsNote(`Local only — ${res.softFail}`)
    } else if (res.persisted) {
      setPrefsNote('Saved to profile')
      setTimeout(() => setPrefsNote(null), 1800)
    }
  }

  async function onSignOut() {
    try { await signOut() } catch {}
    navigate('landing')
  }

  const avg = profile?.rating_avg != null ? Number(profile.rating_avg).toFixed(1) : '—'
  const count = profile?.rating_count || 0
  const kinds = GALLERY_KINDS.filter((k) => !k.driversOnly || isDriver)
  const studentOk = Boolean(profile?.student_verified_at) || isClemsonEmail(user?.email)

  return (
    <div className="route-fade" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: '20px 18px 28px', overflowY: 'auto' }}>
        <button type="button" className="pressable glass-pill" onClick={() => navigate('home')}
          style={{ width: 40, height: 40, borderRadius: 12, marginBottom: 10, display: 'grid', placeItems: 'center' }}>
          <IconSettings size={18} color="#522D80" />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <IconProfile size={26} />
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--purple)', letterSpacing: -0.3 }}>Account</h1>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 12 }}>
          Profile, alerts, billing & driver settings
        </p>

        {isIncentiveAdmin(user, profile) && (
          <button
            type="button"
            className="pressable"
            onClick={() => navigate('incentives')}
            style={{
              width: '100%',
              marginBottom: 12,
              padding: '12px 14px',
              borderRadius: 14,
              fontWeight: 800,
              color: '#fff',
              background: 'linear-gradient(135deg, #F56600, #522D80)',
            }}
          >
            Driver incentives
          </button>
        )}

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

        <div className="account-nav" role="tablist" aria-label="Account sections">
          {NAV.map((n) => {
            const on = tab === n.id
            const Icon = n.Icon
            return (
              <button
                key={n.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={`account-nav-item pressable${on ? ' active' : ''}`}
                onClick={() => selectTab(n.id)}
              >
                <Icon size={18} color={on ? '#F56600' : '#522D80'} />
                <span>{n.label}</span>
              </button>
            )
          })}
        </div>

        {tab === 'profile' && (
          <>
            <div className="glass-panel glass-panel--elevated" style={{ padding: 18, borderRadius: 22, marginTop: 14,
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
                  <div style={{ marginTop: 4, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <IconStarInline avg={avg} count={count} />
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
                      {s.id}
                    </button>
                  )
                })}
              </div>
              <input value={music} onChange={(e) => setMusic(e.target.value)} placeholder="Music taste — indie, country, silence…"
                style={{ width: '100%', marginTop: 12, padding: 12, borderRadius: 14,
                  border: '1px solid rgba(82,45,128,0.12)', background: 'rgba(255,255,255,0.55)' }} />
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
          </>
        )}

        {tab === 'refer' && <ReferFriendsPanel userId={user?.id} />}

        {tab === 'notifications' && (
          <Section title="Notifications" subtitle="Choose which toasts you see" icon={IconBell}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {NOTIFICATION_CATEGORIES.map((c) => {
                const on = prefs[c.id] !== false
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="pressable"
                    onClick={() => onTogglePref(c.id)}
                    disabled={prefsSaving}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                      padding: 12, borderRadius: 14,
                      background: on ? 'rgba(82,45,128,0.10)' : 'rgba(255,255,255,0.45)',
                      border: on ? '1.5px solid rgba(82,45,128,0.35)' : '1px solid rgba(82,45,128,0.1)',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 44, height: 26, borderRadius: 999, padding: 3, flexShrink: 0,
                        background: on ? 'linear-gradient(135deg, var(--orange), #ff8a2b)' : 'rgba(11,18,32,0.12)',
                        transition: 'background 180ms',
                      }}
                    >
                      <span style={{
                        display: 'block', width: 20, height: 20, borderRadius: 999, background: '#fff',
                        transform: on ? 'translateX(18px)' : 'translateX(0)',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                        transition: 'transform 180ms',
                      }} />
                    </span>
                    <span style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: 'var(--purple)' }}>{c.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>{c.hint}</div>
                    </span>
                  </button>
                )
              })}
            </div>
            {prefsNote && (
              <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 12 }}>{prefsNote}</div>
            )}
            <button
              type="button"
              className="pressable"
              onClick={() => pushToast({
                kind: 'system',
                title: 'Demo toast',
                body: 'Empty-state preview — real events fire from trip / friends / bills.',
                category: 'system',
              })}
              style={{
                display: 'block', width: '100%', marginTop: 14, padding: 12, borderRadius: 14,
                fontWeight: 700, color: 'var(--purple)',
                border: '1.5px dashed rgba(82,45,128,0.3)', background: 'rgba(255,255,255,0.4)',
              }}
            >
              Preview a system toast
            </button>
          </Section>
        )}

        {tab === 'billing' && (
          <div style={{ marginTop: 14 }}>
            <BillingPanel profile={profile} onProfileRefresh={() => reload().catch(() => {})} />
          </div>
        )}

        {tab === 'vehicle' && (
          <Section title="Vehicle / Driver" subtitle="Approval required before you can receive rides" icon={IconCar}>
            <div style={{
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 12,
              background: application?.onboarding_status === 'approved' ? 'rgba(31,138,76,0.1)' : 'rgba(245,102,0,0.1)',
              color: 'var(--purple)',
              fontWeight: 700,
              fontSize: 13,
            }}>
              {onboardingLabel(application?.onboarding_status)}
            </div>
            {profile?.vehicle ? (
              <div style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--ink)' }}>
                <div style={{ fontWeight: 700 }}>
                  {profile.vehicle.color || ''} {profile.vehicle.make} {profile.vehicle.model}
                </div>
                <div style={{ color: 'var(--ink-secondary)', fontSize: 13 }}>
                  Plate {profile.vehicle.plate || '—'}
                  {profile.vehicle.seats ? ` · ${profile.vehicle.seats} seats` : ''}
                  {profile.vehicle.tier ? ` · ${profile.vehicle.tier}` : ''}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 12 }}>
                No registered vehicle yet. Sign up as a driver to add make, model, color, plate, and capacity.
              </div>
            )}
            <button type="button" className="pressable" onClick={() => selectTab('billing')}
              style={{ display: 'block', width: '100%', marginTop: 12, padding: 12, borderRadius: 14, fontWeight: 700,
                color: 'var(--purple)', border: '1.5px solid rgba(82,45,128,0.3)', background: 'rgba(255,255,255,0.55)' }}>
              Payment method
            </button>
            <button type="button" className="pressable" onClick={() => navigate('driver-onboarding')}
              style={{ display: 'block', width: '100%', marginTop: 12, padding: 12, borderRadius: 14, fontWeight: 700,
                color: '#fff', background: 'linear-gradient(135deg, var(--orange), #ff7a1a)' }}>
              {application?.onboarding_status === 'approved' ? 'View driver application' : 'Continue driver application'}
            </button>
            {isAdmin && (
              <button type="button" className="pressable" onClick={() => navigate('admin')}
                style={{ display: 'block', width: '100%', marginTop: 10, padding: 12, borderRadius: 14, fontWeight: 700,
                  color: '#fff', background: 'linear-gradient(135deg, #522D80, #6b3fa0)' }}>
                Review driver applications
              </button>
            )}
            <button type="button" className="pressable" onClick={() => navigate('driver')}
              style={{ display: 'block', width: '100%', marginTop: 10, padding: 12, borderRadius: 14, fontWeight: 700,
                color: 'var(--purple)', border: '1.5px solid rgba(82,45,128,0.3)', background: 'rgba(255,255,255,0.55)' }}>
              Switch to driver mode →
            </button>
            <button type="button" className="pressable" onClick={() => navigate('carpool', { drive: '1' })}
              style={{ display: 'block', marginTop: 10, fontWeight: 700, color: 'var(--purple)' }}>
              Offer a carpool →
            </button>
          </Section>
        )}

        {tab === 'student' && (
          <Section title="Student verification" subtitle="Clemson email unlocks student rates" icon={IconStudent}>
            <div style={{
              padding: 14, borderRadius: 14,
              background: studentOk ? 'rgba(31,138,76,0.10)' : 'rgba(245,102,0,0.10)',
              border: `1px solid ${studentOk ? 'rgba(31,138,76,0.25)' : 'rgba(245,102,0,0.25)'}`,
            }}>
              <div style={{ fontWeight: 700, color: 'var(--purple)' }}>
                {studentOk ? 'Verified student' : 'Not verified'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4 }}>
                {user?.email || 'No email'}
                {profile?.student_verified_at
                  ? ` · verified ${new Date(profile.student_verified_at).toLocaleDateString()}`
                  : ''}
              </div>
            </div>
            {!studentOk && (
              <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 12, lineHeight: 1.45 }}>
                Sign up or update your account with a @clemson.edu / @g.clemson.edu email to unlock student discount.
              </p>
            )}
          </Section>
        )}

        {tab === 'privacy' && (
          <Section title="Privacy & safety" subtitle="Who sees your vibe + gallery" icon={IconPrivacy}>
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
            <div style={{ marginTop: 12 }}>
              <PrimaryButton onClick={onSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save privacy'}
              </PrimaryButton>
            </div>
            {msg && <div style={{ fontSize: 13, marginTop: 10, color: 'var(--ink-secondary)', textAlign: 'center' }}>{msg}</div>}
          </Section>
        )}

        {tab === 'help' && (
          <Section title="Help & support" subtitle="We’re here for campus rides" icon={IconHelp}>
            <a
              href="mailto:rides@clemson.edu?subject=Clemson%20RIDES%20help"
              className="pressable"
              style={{
                display: 'block', padding: 14, borderRadius: 14, fontWeight: 700, color: 'var(--purple)',
                background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(82,45,128,0.12)', marginBottom: 10,
              }}
            >
              Email support →
            </a>
            <button
              type="button"
              className="pressable"
              data-testid="help-lost-found"
              onClick={() => navigate('lost-found')}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: 14, borderRadius: 14, fontWeight: 700,
                color: 'var(--purple)', background: 'rgba(255,255,255,0.55)',
                border: '1px solid rgba(82,45,128,0.12)', marginBottom: 10,
              }}
            >
              Lost & found →
            </button>
            <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', margin: '0 0 8px', lineHeight: 1.45 }}>
              Separate from help. Report an item left in a vehicle after a ride.
            </p>
            <button type="button" className="pressable" onClick={() => navigate('terms')}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}>
              Terms of service
            </button>
            <button type="button" className="pressable" onClick={() => navigate('privacy')}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}>
              Privacy policy
            </button>
            <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 8, lineHeight: 1.45 }}>
              FAQ: Book from Home · Schedule airports · Friends for group splits · Account → Billing to activate card.
            </div>
          </Section>
        )}

        <div className="glass-panel" style={{ marginTop: 18, padding: 16, borderRadius: 18 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Session</div>
          <div style={{ fontSize: 13, color: 'var(--ink-tertiary)', marginBottom: 12 }}>
            {configured ? user?.email || 'Signed in' : 'Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY'}
          </div>
          <button type="button" className="pressable primary-cta" onClick={onSignOut}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', marginTop: 4, padding: 14, borderRadius: 14,
              background: 'linear-gradient(135deg, var(--orange) 0%, #ff7a1a 100%)',
              color: '#fff', fontWeight: 700, boxShadow: 'var(--shadow-cta)' }}>
            <IconSignOut size={18} color="#fff" />
            Sign out
          </button>
        </div>
      </div>
      <BottomTabs active="account" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}

function IconStarInline({ avg, count }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="m12 3.6 2.2 4.6 5 .7-3.6 3.6.9 5.1L12 15.6 7.5 17.6l.9-5.1L4.8 8.9l5-.7L12 3.6Z" stroke="#F56600" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
      <span>{avg}</span>
      <span style={{ fontWeight: 500, color: 'var(--ink-tertiary)', fontSize: 13 }}>({count} ratings · read-only)</span>
    </span>
  )
}
