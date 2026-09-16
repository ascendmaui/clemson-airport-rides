import { createClient } from '@supabase/supabase-js'
import { MapContainer, TileLayer, Marker, Circle, Polyline, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useEffect, useState } from 'react'

/* ==== src/lib/navigation.js ==== */
export function getHashRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '') || 'landing'
  const [path, qs] = raw.split('?')
  const params = Object.fromEntries(new URLSearchParams(qs || ''))
  return { path, params }
}

export function navigate(path, params = {}) {
  const qs = new URLSearchParams(params).toString()
  window.location.hash = qs ? `#/${path}?${qs}` : `#/${path}`
}

/* ==== src/lib/stripeStub.js ==== */
/**
 * Stripe deposit stub — Phase A will call real PaymentIntent.
 * Airport flat rates: GSP $75 · CLT $175 · 25% deposit.
 */
export const AIRPORT_RATES = {
  GSP: { code: 'GSP', name: 'Greenville-Spartanburg (GSP)', total: 75 },
  CLT: { code: 'CLT', name: 'Charlotte Douglas (CLT)', total: 175 },
}

export function depositAmount(total) {
  return Math.round(total * 0.25 * 100) / 100
}

export async function createDepositIntent({ airport, riderName }) {
  const rate = AIRPORT_RATES[airport]
  if (!rate) throw new Error('Unknown airport')
  const deposit = depositAmount(rate.total)
  // TODO: POST /api/stripe/create-deposit-intent
  console.log('[Stripe stub] createDepositIntent', {
    airport,
    riderName,
    total: rate.total,
    deposit,
    currency: 'usd',
  })
  return {
    stub: true,
    clientSecret: 'pi_stub_clemson_deposit',
    deposit,
    total: rate.total,
    airport: rate.code,
  }
}

/* ==== src/lib/supabase.js ==== */

const url = import.meta.env.VITE_SUPABASE_URL || 'https://awktabuhijrshmsmagpq.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3a3RhYnVoaWpyc2htc21hZ3BxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MTcxODAsImV4cCI6MjEwNTA5MzE4MH0.946mY5a9uLkawuVb4bKx-lrpvd8S0qucSPXuftzTRlU'

export const supabaseConfigured = Boolean(url && key)

export const supabase = supabaseConfigured
  ? createClient(url, key)
  : null

/** Light wiring — schema already exists; no migrations from this app. */
export async function pingSupabase() {
  if (!supabase) return { ok: false, reason: 'missing VITE_SUPABASE_ANON_KEY' }
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1)
    if (error && error.code !== 'PGRST116') {
      return { ok: false, reason: error.message }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e) }
  }
}

/* ==== src/components/PrimaryButton.jsx ==== */
export function PrimaryButton({ children, onClick, variant = 'orange', fullWidth = true, disabled, className = '' }) {
  const bg = variant === 'purple'
    ? 'var(--purple)'
    : variant === 'gradient'
      ? 'linear-gradient(135deg, #522D80 0%, #F56600 100%)'
      : 'var(--orange)'
  return (
    <button
      type="button"
      className={`pressable ${className}`}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: fullWidth ? '100%' : undefined,
        padding: '14px 20px',
        borderRadius: 14,
        background: bg,
        color: '#fff',
        fontWeight: 600,
        fontSize: 17,
        opacity: disabled ? 0.5 : 1,
        boxShadow: 'var(--shadow-pill)',
        transition: 'transform 160ms ease',
      }}
    >
      {children}
    </button>
  )
}

export function PurpleAcceptButton(props) {
  return <PrimaryButton {...props} variant="purple" />
}

/* ==== src/components/Pill.jsx ==== */
export function Pill({ children, icon, tone = 'orange', onClick, active }) {
  const isOrange = tone === 'orange'
  return (
    <button
      type="button"
      className="pressable"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        borderRadius: 'var(--radius-pill)',
        background: active
          ? (isOrange ? 'var(--orange-soft)' : 'var(--purple-soft)')
          : 'var(--surface)',
        color: isOrange ? 'var(--orange)' : 'var(--purple)',
        border: `1.5px solid ${isOrange ? 'rgba(245,102,0,0.35)' : 'rgba(82,45,128,0.35)'}`,
        fontWeight: 600,
        fontSize: 14,
        boxShadow: 'var(--shadow-pill)',
        whiteSpace: 'nowrap',
      }}
    >
      {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
      {children}
    </button>
  )
}

/* ==== src/components/SearchField.jsx ==== */
export function SearchField({ value, onChange, onFocus, placeholder = 'Where are you going?', orangeOutline }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        background: 'var(--surface)',
        borderRadius: 16,
        border: orangeOutline ? '2px solid var(--orange)' : '1px solid var(--border)',
        boxShadow: orangeOutline ? '0 4px 16px rgba(245,102,0,0.12)' : 'var(--shadow-pill)',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--ink)',
          fontSize: 16,
          fontWeight: 500,
        }}
      />
    </div>
  )
}

/* ==== src/components/BottomTabs.jsx ==== */
const TABS = [
  { id: 'home', label: 'Rides', icon: '🚗' },
  { id: 'schedule', label: 'Schedule', icon: '📅' },
  { id: 'friends', label: 'Friends', icon: '👥' },
  { id: 'account', label: 'Account', icon: '👤' },
]

export function BottomTabs({ active, onChange }) {
  return (
    <nav
      style={{
        position: 'sticky',
        bottom: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(16px)',
        borderTop: '1px solid var(--border)',
        paddingBottom: 'var(--safe-bottom)',
        zIndex: 40,
      }}
    >
      {TABS.map((t) => {
        const isActive = active === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            style={{
              padding: '10px 4px 12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              color: isActive ? 'var(--orange)' : 'var(--ink-tertiary)',
              fontWeight: isActive ? 600 : 500,
              fontSize: 11,
            }}
          >
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}

/* ==== src/components/TierRow.jsx ==== */
export function TierRow({ tier, selected, onSelect }) {
  return (
    <button
      type="button"
      className="pressable"
      onClick={() => onSelect(tier)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        padding: '14px 12px',
        borderRadius: 14,
        background: selected ? 'var(--orange-soft)' : 'transparent',
        border: selected ? '1.5px solid rgba(245,102,0,0.35)' : '1.5px solid transparent',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: tier.premium ? 'var(--purple-soft)' : 'var(--surface-muted)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 24,
        }}
      >
        {tier.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{tier.name}</span>
          {tier.badge && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.4,
                color: 'var(--purple)',
                background: 'var(--purple-soft)',
                padding: '2px 7px',
                borderRadius: 999,
              }}
            >
              {tier.badge}
            </span>
          )}
        </div>
        <div style={{ color: 'var(--ink-secondary)', fontSize: 13, marginTop: 2 }}>
          {tier.eta} · {tier.meta}
        </div>
      </div>
      <div style={{ fontWeight: 600, fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>
        ${tier.price.toFixed(2)}
      </div>
      {selected && (
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--orange)',
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          ✓
        </div>
      )}
    </button>
  )
}

/* ==== src/components/UpsellModal.jsx ==== */

export function UpsellModal({ open, onClose, onUpgrade, variant = 'comfort', upgradePrice = 4.5 }) {
  if (!open) return null
  const isTesla = variant === 'tesla'
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(11,18,32,0.45)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--surface)',
          borderRadius: 24,
          padding: 24,
          boxShadow: 'var(--shadow-soft)',
          animation: 'modalIn 280ms ease-out',
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
          }}
        >
          {isTesla ? '🚗' : '✨'}
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, marginBottom: 8 }}>
          {isTesla
            ? 'Upgrade to a self-driving Tesla Model 3'
            : 'Ride in a roomy, clean new car'}
        </h2>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 15, lineHeight: 1.4, marginBottom: 22 }}>
          {isTesla
            ? 'Premium Tesla · self-driving capable. Treat yourself to the Clemson fleet upgrade.'
            : 'Upgrade and treat yourself to Extra Comfort.'}
        </p>
        <PrimaryButton variant={isTesla ? 'purple' : 'orange'} onClick={onUpgrade}>
          Upgrade for ${upgradePrice.toFixed(2)} more
        </PrimaryButton>
        <button
          type="button"
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

/* ==== src/components/CampusMap.jsx ==== */

const CLEMSON = [34.6784, -82.8397]
const STADIUM = [34.6788, -82.8430]

const pinIcon = new L.DivIcon({
  className: '',
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#F56600;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const purplePin = new L.DivIcon({
  className: '',
  html: `<div style="width:16px;height:16px;border-radius:50%;background:#522D80;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25)"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

function DragHandler({ onDrag }) {
  useMapEvents({
    move() {
      /* visual only */
    },
    dragend(e) {
      const c = e.target.getCenter()
      onDrag?.([c.lat, c.lng])
    },
  })
  return null
}

export function CampusMap({
  height = 160,
  interactive = false,
  center = CLEMSON,
  zoom = 14,
  showHeat = false,
  route = null,
  dragPin = false,
  onPinMove,
  marker = STADIUM,
}) {
  useEffect(() => {
    // fix default icon path issues in bundlers
  }, [])

  const wrapStyle = typeof height === 'number'
    ? { height, borderRadius: 16, overflow: 'hidden', position: 'relative' }
    : { height: height || '100%', width: '100%', borderRadius: 0, overflow: 'hidden', position: 'absolute', inset: 0 }

  return (
    <div style={wrapStyle}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        zoomControl={interactive}
        dragging={interactive || dragPin}
        scrollWheelZoom={interactive}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
        {showHeat && (
          <>
            <Circle center={[34.6795, -82.837]} radius={350} pathOptions={{ color: '#522D80', fillColor: '#522D80', fillOpacity: 0.22, weight: 0 }} />
            <Circle center={[34.676, -82.845]} radius={280} pathOptions={{ color: '#F56600', fillColor: '#F56600', fillOpacity: 0.16, weight: 0 }} />
          </>
        )}
        {route && <Polyline positions={route} pathOptions={{ color: '#522D80', weight: 4, opacity: 0.85 }} />}
        <Marker position={marker || center} icon={showHeat ? purplePin : pinIcon} />
        {dragPin && <DragHandler onDrag={onPinMove} />}
      </MapContainer>
    </div>
  )
}

export { CLEMSON, STADIUM }

/* ==== src/screens/Marketing.jsx ==== */

function QrPlaceholder({ label }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: 16,
          background: `
            repeating-conic-gradient(#0B1220 0% 25%, #fff 0% 50%) 0 0 / 12px 12px,
            #fff
          `,
          border: '2px solid var(--border)',
          display: 'grid',
          placeItems: 'center',
          margin: '0 auto 8px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 28,
            background: '#fff',
            borderRadius: 8,
            display: 'grid',
            placeItems: 'center',
            fontWeight: 700,
            fontSize: 11,
            color: 'var(--purple)',
            letterSpacing: 0.5,
          }}
        >
          QR
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--ink-tertiary)', marginTop: 2 }}>Coming soon</div>
    </div>
  )
}

export function Marketing() {
  return (
    <div className="fade-in" style={{ minHeight: '100%', background: 'var(--surface)' }}>
      <header
        style={{
          position: 'relative',
          height: 280,
          background: `
            linear-gradient(180deg, rgba(11,18,32,0.15) 0%, rgba(82,45,128,0.55) 55%, rgba(11,18,32,0.85) 100%),
            linear-gradient(135deg, #F56600 0%, #522D80 60%, #1a0f2e 100%),
            url(https://images.unsplash.com/photo-1566577739112-5180d4bf9390?w=1200&q=80) center/cover
          `,
          color: '#fff',
          padding: '28px 24px 32px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
        }}
      >
        <div style={{ fontSize: 13, letterSpacing: 2, fontWeight: 600, opacity: 0.9, marginBottom: 8 }}>
          RIDE • GAME • REPEAT
        </div>
        <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.1 }}>
          <span style={{ color: '#FFB370' }}>Clemson</span>{' '}
          <span style={{ color: '#E8D5FF' }}>RIDES</span>
        </h1>
        <div
          style={{
            marginTop: 12,
            display: 'inline-flex',
            alignSelf: 'flex-start',
            padding: '6px 12px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.8,
          }}
        >
          TIGERS GET YOU THERE
        </div>
      </header>

      <div style={{ padding: '28px 24px 40px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 10, letterSpacing: -0.3 }}>
          Clemson-only airport rides
        </h2>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 15, lineHeight: 1.45, marginBottom: 20 }}>
          Flat rates to GSP ($75) & CLT ($175). Skip the surge on game day. Premium self-driving Tesla fleet available.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
          <PrimaryButton onClick={() => navigate('home')}>Open rider app</PrimaryButton>
          <PrimaryButton variant="purple" onClick={() => navigate('driver')}>
            Driver mode
          </PrimaryButton>
        </div>

        <div
          style={{
            background: 'var(--surface-muted)',
            borderRadius: 20,
            padding: 24,
            border: '1px solid var(--border)',
          }}
        >
          <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6, textAlign: 'center' }}>
            Get the native apps
          </h3>
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)', textAlign: 'center', marginBottom: 20 }}>
            Scan to download when Expo EAS builds ship
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 36 }}>
            <QrPlaceholder label="iOS App Store" />
            <QrPlaceholder label="Google Play" />
          </div>
        </div>

        <p style={{ marginTop: 24, textAlign: 'center', fontSize: 12, color: 'var(--ink-tertiary)' }}>
          Web skeleton · Stripe & push stubbed · Schema live on Supabase
        </p>
      </div>
    </div>
  )
}

/* ==== src/screens/RiderHome.jsx ==== */

const SHORTCUTS = [
  { id: 'home', label: 'Home', sub: 'Simpsonville', icon: '🏠' },
  { id: 'clemson', label: 'Clemson University', sub: 'Sikes Hall', icon: '🎓' },
  { id: 'work', label: 'Work', sub: 'Saved place', icon: '💼' },
]

export function RiderHome({ riderName = 'John' }) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('home')

  const goSearch = (dest) => {
    navigate('confirm', { dest: dest || query || 'GSP Airport' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--surface-muted)' }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        {/* Hero */}
        <header
          style={{
            position: 'relative',
            height: 200,
            background: `
              linear-gradient(180deg, rgba(11,18,32,0.05) 0%, rgba(82,45,128,0.45) 50%, rgba(11,18,32,0.88) 100%),
              linear-gradient(120deg, #c45a12 0%, #522D80 70%),
              url(https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=1200&q=80) center/cover
            `,
            color: '#fff',
            padding: '20px 20px 18px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
        >
          <div style={{ position: 'absolute', top: 16, right: 16, opacity: 0.18, fontSize: 72, lineHeight: 1, userSelect: 'none' }}>
            🐾
          </div>
          <div style={{ position: 'absolute', top: 88, right: 20, opacity: 0.22, fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 18, transform: 'rotate(-8deg)' }}>
            GO TIGERS!
          </div>
          <div style={{ fontSize: 11, letterSpacing: 2.2, fontWeight: 600, opacity: 0.85, marginBottom: 6 }}>
            RIDE • GAME • REPEAT
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>
            <span style={{ color: '#FFB370' }}>Clemson</span>{' '}
            <span style={{ color: '#E8D5FF' }}>RIDES</span>
          </div>
          <div
            style={{
              marginTop: 8,
              alignSelf: 'flex-start',
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.14)',
              border: '1px solid rgba(255,255,255,0.22)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.7,
            }}
          >
            TIGERS GET YOU THERE
          </div>
        </header>

        <div style={{ padding: '20px 20px 0', position: 'relative' }}>
          {/* watermark */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              right: -10,
              top: 40,
              fontSize: 140,
              opacity: 0.04,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            🐾
          </div>

          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.4 }}>
            Welcome, {riderName}
          </h1>
          <p style={{ color: 'var(--ink-secondary)', fontSize: 15, marginTop: 4, marginBottom: 16 }}>
            Where are you headed, Tiger?
          </p>

          <SearchField
            value={query}
            onChange={setQuery}
            onFocus={() => {}}
            orangeOutline
          />
          <div style={{ height: 8 }} />
          <button
            type="button"
            className="pressable"
            onClick={() => goSearch()}
            style={{
              width: '100%',
              padding: '10px',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--orange)',
            }}
          >
            Search destination →
          </button>

          <div style={{ display: 'flex', gap: 10, marginTop: 8, overflowX: 'auto', paddingBottom: 4 }}>
            <Pill icon="🕐" tone="orange" onClick={() => navigate('schedule')}>
              Schedule a ride
            </Pill>
            <Pill icon="👥" tone="purple" onClick={() => navigate('friends')}>
              Ride with friends
            </Pill>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, overflowX: 'auto' }}>
            {SHORTCUTS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="pressable"
                onClick={() => goSearch(s.sub)}
                style={{
                  flex: '0 0 auto',
                  minWidth: 118,
                  padding: '14px 14px',
                  borderRadius: 16,
                  background: 'var(--surface)',
                  boxShadow: 'var(--shadow-pill)',
                  border: '1px solid var(--border)',
                  textAlign: 'left',
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{s.label}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-tertiary)', marginTop: 2 }}>{s.sub}</div>
              </button>
            ))}
          </div>

          <div
            style={{
              marginTop: 20,
              background: 'var(--surface)',
              borderRadius: 18,
              padding: 12,
              boxShadow: 'var(--shadow-soft)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 4px' }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>You are here</span>
              <span style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>Memorial Stadium</span>
            </div>
            <CampusMap height={150} marker={STADIUM} />
          </div>

          {/* Game Day promo */}
          <div
            style={{
              marginTop: 16,
              marginBottom: 16,
              borderRadius: 18,
              padding: 16,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-pill)',
              display: 'flex',
              gap: 14,
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: 'var(--orange-soft)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 24,
                flexShrink: 0,
              }}
            >
              🏈
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Game Day Rides</div>
              <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 2 }}>
                Skip the surge. Book ahead!
              </div>
            </div>
            <button
              type="button"
              className="pressable"
              onClick={() => navigate('schedule')}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, #522D80 0%, #F56600 100%)',
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                whiteSpace: 'nowrap',
                boxShadow: 'var(--shadow-pill)',
              }}
            >
              Schedule Now
            </button>
          </div>
        </div>
      </div>

      <BottomTabs
        active={tab}
        onChange={(id) => {
          setTab(id)
          if (id === 'schedule') navigate('schedule')
          else if (id === 'friends') navigate('friends')
          else if (id === 'account') navigate('account')
          else navigate('home')
        }}
      />
    </div>
  )
}

/* ==== src/screens/ConfirmPickup.jsx ==== */

export function ConfirmPickup({ dest = 'GSP Airport' }) {
  const [address, setAddress] = useState('Memorial Stadium · Lot 5')
  const [note, setNote] = useState('')
  const [pin, setPin] = useState(STADIUM)

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-muted)' }}>
      <div style={{ padding: '16px 20px 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={() => navigate('home')} style={{ fontSize: 20, padding: 4 }}>←</button>
        <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.3 }}>Confirm pickup spot</h1>
      </div>

      <div style={{ padding: '0 16px' }}>
        <CampusMap height={260} interactive dragPin marker={pin} onPinMove={setPin} />
        <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 8, textAlign: 'center' }}>
          Drag the map to adjust your pin
        </p>
      </div>

      <div
        style={{
          marginTop: 'auto',
          background: 'var(--surface)',
          borderRadius: '24px 24px 0 0',
          padding: '12px 20px 28px',
          boxShadow: 'var(--shadow-soft)',
          animation: 'sheetUp 300ms ease-out',
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 16px' }} />
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Pickup address</label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          style={{
            width: '100%',
            marginTop: 6,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface-muted)',
            marginBottom: 14,
          }}
        />
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Add note for driver</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Near the orange gates, wearing purple hoodie"
          rows={2}
          style={{
            width: '100%',
            marginTop: 6,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface-muted)',
            resize: 'none',
            marginBottom: 8,
          }}
        />
        <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 14 }}>
          Going to <strong>{dest}</strong>
        </p>
        <PrimaryButton onClick={() => navigate('tiers', { dest, pickup: address })}>
          Confirm and request
        </PrimaryButton>
      </div>
    </div>
  )
}

/* ==== src/screens/RideTiers.jsx ==== */

const TIERS = [
  { id: 'standard', name: 'Standard', icon: '🚗', eta: '4 min', meta: '4 seats', price: 18.5 },
  { id: 'wait', name: 'Wait & Save', icon: '⏱️', eta: '12 min', meta: 'Save ~20%', price: 14.2 },
  { id: 'comfort', name: 'Extra Comfort', icon: '✨', eta: '6 min', meta: 'Newer cars', price: 23.0 },
  { id: 'xl', name: 'XL', icon: '🚐', eta: '8 min', meta: '6 seats', price: 28.75 },
  { id: 'pet', name: 'Pet', icon: '🐾', eta: '9 min', meta: 'Pet-friendly', price: 21.0 },
  { id: 'tesla', name: 'Self-Driving Tesla Model 3', icon: '⚡', eta: '7 min', meta: 'Premium · self-driving capable', price: 36.0, premium: true, badge: 'TESLA' },
]

export function RideTiers({ dest = '1900 GSP Dr' }) {
  const [selected, setSelected] = useState(TIERS[0])
  const [upsell, setUpsell] = useState(null)

  const onSelectTier = (tier) => {
    setSelected(tier)
  }

  const onConfirm = () => {
    if (selected.id === 'standard') {
      setUpsell('comfort')
      return
    }
    if (selected.id === 'comfort') {
      setUpsell('tesla')
      return
    }
    alert(`Requested ${selected.name} to ${dest} — stub (no live dispatch yet)`)
    navigate('home')
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-muted)' }}>
      <div style={{ padding: '12px 16px 0' }}>
        <button type="button" onClick={() => navigate('confirm', { dest })} style={{ fontSize: 20, marginBottom: 8 }}>←</button>
        <CampusMap
          height={140}
          marker={STADIUM}
          route={[STADIUM, [34.8957, -82.2189]]}
        />
        <div
          style={{
            marginTop: 10,
            padding: '8px 12px',
            borderRadius: 999,
            background: 'var(--purple-soft)',
            color: 'var(--purple)',
            fontSize: 12,
            fontWeight: 600,
            display: 'inline-flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          🐯 Clemson student promo · 10% off Standard
        </div>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-secondary)' }}>
          To <strong style={{ color: 'var(--ink)' }}>{dest}</strong>
        </p>
      </div>

      <div
        style={{
          flex: 1,
          marginTop: 12,
          background: 'var(--surface)',
          borderRadius: '24px 24px 0 0',
          padding: '8px 12px 20px',
          boxShadow: 'var(--shadow-soft)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border)', margin: '4px auto 10px' }} />
        <div style={{ flex: 1 }}>
          {TIERS.map((t) => (
            <TierRow key={t.id} tier={t} selected={selected.id === t.id} onSelect={onSelectTier} />
          ))}
        </div>
        <div style={{ padding: '12px 8px 0' }}>
          <PrimaryButton
            variant={selected.premium ? 'purple' : 'orange'}
            onClick={onConfirm}
          >
            Select {selected.name.split(' ')[0] === 'Self-Driving' ? 'Tesla' : selected.name}
          </PrimaryButton>
        </div>
      </div>

      <UpsellModal
        open={upsell === 'comfort'}
        variant="comfort"
        upgradePrice={4.5}
        onClose={() => {
          setUpsell(null)
          alert(`Requested ${selected.name} — stub`)
          navigate('home')
        }}
        onUpgrade={() => {
          setSelected(TIERS.find((t) => t.id === 'comfort'))
          setUpsell(null)
        }}
      />
      <UpsellModal
        open={upsell === 'tesla'}
        variant="tesla"
        upgradePrice={13.0}
        onClose={() => {
          setUpsell(null)
          alert(`Requested Extra Comfort — stub`)
          navigate('home')
        }}
        onUpgrade={() => {
          setSelected(TIERS.find((t) => t.id === 'tesla'))
          setUpsell(null)
        }}
      />
    </div>
  )
}

/* ==== src/screens/ScheduleAirport.jsx ==== */

export function ScheduleAirport() {
  const [airport, setAirport] = useState('GSP')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const rate = AIRPORT_RATES[airport]
  const deposit = depositAmount(rate.total)

  const onBook = async () => {
    setBusy(true)
    try {
      const intent = await createDepositIntent({ airport, riderName: 'John' })
      setResult(intent)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--surface-muted)' }}>
      <div style={{ flex: 1, padding: '20px 20px 24px', overflowY: 'auto' }}>
        <button type="button" onClick={() => navigate('home')} style={{ fontSize: 20, marginBottom: 12 }}>←</button>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.4 }}>Schedule airport</h1>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 6, marginBottom: 20 }}>
          Flat rates · 25% deposit holds your ride
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {Object.values(AIRPORT_RATES).map((a) => (
            <button
              key={a.code}
              type="button"
              className="pressable"
              onClick={() => setAirport(a.code)}
              style={{
                flex: 1,
                padding: 16,
                borderRadius: 16,
                background: airport === a.code ? 'var(--orange-soft)' : 'var(--surface)',
                border: `1.5px solid ${airport === a.code ? 'rgba(245,102,0,0.4)' : 'var(--border)'}`,
                textAlign: 'left',
                boxShadow: 'var(--shadow-pill)',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 18 }}>{a.code}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 4 }}>{a.name.split('(')[0].trim()}</div>
              <div style={{ fontWeight: 600, fontSize: 20, marginTop: 10, color: 'var(--orange)' }}>${a.total}</div>
            </button>
          ))}
        </div>

        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{
            width: '100%',
            marginTop: 6,
            marginBottom: 14,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        />
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Pickup time</label>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          style={{
            width: '100%',
            marginTop: 6,
            marginBottom: 20,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        />

        <div
          style={{
            background: 'var(--surface)',
            borderRadius: 18,
            padding: 18,
            border: '1px solid var(--border)',
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'var(--ink-secondary)' }}>Trip total</span>
            <span style={{ fontWeight: 600 }}>${rate.total.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'var(--ink-secondary)' }}>Deposit due now (25%)</span>
            <span style={{ fontWeight: 700, color: 'var(--purple)', fontSize: 18 }}>${deposit.toFixed(2)}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>
            Remainder charged after drop-off · Stripe PaymentIntent stub
          </div>
        </div>

        <PrimaryButton variant="gradient" disabled={busy} onClick={onBook}>
          {busy ? 'Creating deposit…' : `Pay $${deposit.toFixed(2)} deposit`}
        </PrimaryButton>

        {result && (
          <div
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: 14,
              background: 'var(--purple-soft)',
              fontSize: 13,
              color: 'var(--purple)',
            }}
          >
            ✓ Deposit intent stubbed (console). clientSecret: {result.clientSecret}
            <br />
            TODO: wire live Stripe Checkout / PaymentElement.
          </div>
        )}
      </div>
      <BottomTabs active="schedule" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}

/* ==== src/screens/DriverHome.jsx ==== */

export function DriverHome() {
  const [priority, setPriority] = useState(false)
  const [offer, setOffer] = useState(false)
  const silverProgress = 2
  const silverTotal = 4

  return (
    <div style={{ position: 'relative', height: '100%', background: '#e8eaed' }}>
      <CampusMap height="100%" interactive showHeat center={CLEMSON} zoom={13} />

      {/* Top chrome */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          right: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 20,
        }}
      >
        <button
          type="button"
          onClick={() => navigate('landing')}
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.95)',
            boxShadow: 'var(--shadow-pill)',
            fontSize: 18,
          }}
        >
          ☰
        </button>
        <div
          style={{
            padding: '10px 18px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.95)',
            fontWeight: 700,
            fontSize: 17,
            boxShadow: 'var(--shadow-pill)',
          }}
        >
          $0.00
        </div>
        <button
          type="button"
          onClick={() => setOffer(true)}
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.95)',
            boxShadow: 'var(--shadow-pill)',
            fontSize: 18,
          }}
          title="Simulate incoming offer"
        >
          🔔
        </button>
      </div>

      {/* Bottom dock */}
      {!offer && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 20,
            background: 'var(--surface)',
            borderRadius: '24px 24px 0 0',
            padding: '12px 20px calc(20px + var(--safe-bottom))',
            boxShadow: 'var(--shadow-soft)',
            animation: 'sheetUp 300ms ease-out',
          }}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 14px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--success)' }} />
            <span style={{ fontWeight: 600, fontSize: 18 }}>You're online</span>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 0',
              borderTop: '1px solid var(--border)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>Priority Mode</div>
              <div style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>Higher-value rides first</div>
            </div>
            <button
              type="button"
              onClick={() => setPriority((p) => !p)}
              style={{
                width: 52,
                height: 30,
                borderRadius: 999,
                background: priority ? 'var(--purple)' : 'var(--border)',
                position: 'relative',
                transition: 'background 200ms',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  left: priority ? 24 : 3,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: '#fff',
                  boxShadow: 'var(--shadow-pill)',
                  transition: 'left 200ms',
                }}
              />
            </button>
          </div>

          <div style={{ padding: '12px 0 4px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>Unlock Silver</span>
              <span style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>{silverProgress}/{silverTotal}</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-muted)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${(silverProgress / silverTotal) * 100}%`,
                  height: '100%',
                  background: 'var(--orange)',
                  borderRadius: 999,
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 8 }}>
              Complete {silverTotal - silverProgress} more trips for Silver perks
            </p>
          </div>

          <button
            type="button"
            onClick={() => setOffer(true)}
            style={{ marginTop: 12, width: '100%', padding: 10, fontSize: 13, color: 'var(--purple)', fontWeight: 600 }}
          >
            Simulate incoming ride →
          </button>
        </div>
      )}

      {/* Incoming offer card */}
      {offer && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 30,
            background: 'var(--surface)',
            borderRadius: '24px 24px 0 0',
            padding: '12px 20px calc(24px + var(--safe-bottom))',
            boxShadow: 'var(--shadow-soft)',
            animation: 'sheetUp 300ms ease-out',
          }}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 14px' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5 }}>$22.40</div>
            <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>~$38/hr est.</div>
          </div>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--orange)', fontWeight: 700 }}>●</span>
              <div>
                <div style={{ fontWeight: 600 }}>Pickup · 3 min (0.8 mi)</div>
                <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>Memorial Stadium Lot 5</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--purple)', fontWeight: 700 }}>■</span>
              <div>
                <div style={{ fontWeight: 600 }}>Dropoff · 18 min (11 mi)</div>
                <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>GSP Airport · Terminal</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'var(--orange-soft)',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
                color: 'var(--orange)',
              }}
            >
              J
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>John</div>
              <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>★ 4.97</div>
            </div>
          </div>
          <PurpleAcceptButton
            onClick={() => {
              setOffer(false)
              alert('Ride accepted — stub (no live dispatch)')
            }}
          >
            Accept
          </PurpleAcceptButton>
          <button
            type="button"
            onClick={() => setOffer(false)}
            style={{ width: '100%', marginTop: 10, padding: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}
          >
            Decline
          </button>
        </div>
      )}
    </div>
  )
}

/* ==== src/screens/StubTabs.jsx ==== */

export function FriendsScreen() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: 24 }}>
        <button type="button" onClick={() => navigate('home')} style={{ fontSize: 20, marginBottom: 12 }}>←</button>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Ride with friends</h1>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 8, lineHeight: 1.4 }}>
          Split fares and share ETAs with classmates. Friend graph + invites stubbed for Phase B.
        </p>
      </div>
      <BottomTabs active="friends" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}

export function AccountScreen() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: 24 }}>
        <button type="button" onClick={() => navigate('home')} style={{ fontSize: 20, marginBottom: 12 }}>←</button>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Account</h1>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 8 }}>Welcome, John · Tiger rider</p>
        <div
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 16,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Supabase auth</div>
          <div style={{ fontSize: 13, color: 'var(--ink-tertiary)' }}>
            Real sign-in stubbed. Client wired when VITE_SUPABASE_ANON_KEY is set.
          </div>
          <button
            type="button"
            onClick={() => navigate('driver')}
            style={{ marginTop: 14, fontWeight: 600, color: 'var(--purple)' }}
          >
            Switch to driver mode →
          </button>
          <button
            type="button"
            onClick={() => navigate('landing')}
            style={{ display: 'block', marginTop: 10, fontWeight: 600, color: 'var(--ink-secondary)' }}
          >
            Marketing / download QR
          </button>
        </div>
      </div>
      <BottomTabs active="account" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}

/* ==== App shell ==== */

function Screen() {
  const [{ path, params }, setRoute] = useState(getHashRoute)

  useEffect(() => {
    const onHash = () => setRoute(getHashRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  switch (path) {
    case 'landing':
    case '':
      return <Marketing />
    case 'home':
    case 'rides':
      return <RiderHome />
    case 'confirm':
      return <ConfirmPickup dest={params.dest || 'GSP Airport'} />
    case 'tiers':
      return <RideTiers dest={params.dest || '1900 GSP Dr'} />
    case 'schedule':
      return <ScheduleAirport />
    case 'driver':
      return <DriverHome />
    case 'friends':
      return <FriendsScreen />
    case 'account':
      return <AccountScreen />
    default:
      return <Marketing />
  }
}

export default function App() {
  return (
    <div className="desktop-frame">
      <div className="app-shell">
        <Screen />
      </div>
    </div>
  )
}
