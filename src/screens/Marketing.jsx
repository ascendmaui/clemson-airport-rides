import { navigate } from '../lib/navigation'
import { PrimaryButton } from '../components/PrimaryButton'

const IOS_BUILD = 'https://expo.dev/accounts/johnmatveyev/projects/clemson-airport-rides/builds/ae9bb5b6-e4b8-49ac-b8e3-471bdced9357'
const ANDROID_BUILD = 'https://expo.dev/accounts/johnmatveyev/projects/clemson-airport-rides/builds/a9cfec15-97bf-4104-9332-06c7b6b659b0'

function QrCard({ label, href, caption }) {
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=8&data=${encodeURIComponent(href)}`
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{ textAlign: 'center', textDecoration: 'none', color: 'inherit' }}>
      <img
        src={qr}
        width={120}
        height={120}
        alt={`${label} download QR`}
        style={{
          width: 120,
          height: 120,
          borderRadius: 16,
          border: '1px solid var(--border)',
          background: '#fff',
          display: 'block',
          margin: '0 auto 8px',
        }}
      />
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--ink-tertiary)', marginTop: 2 }}>{caption}</div>
    </a>
  )
}

export function Marketing() {
  return (
    <div className="fade-in" style={{ minHeight: '100%', background: 'var(--surface)' }}>
      <header
        style={{
          position: 'relative',
          height: 280,
          background: `linear-gradient(180deg, rgba(11,18,32,0.15) 0%, rgba(82,45,128,0.55) 55%, rgba(11,18,32,0.85) 100%), linear-gradient(135deg, #F56600 0%, #522D80 60%, #1a0f2e 100%)`,
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
            Scan for Expo internal preview installs (ad hoc / APK)
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 36 }}>
            <QrCard label="iOS preview" href={IOS_BUILD} caption="Install via Expo" />
            <QrCard label="Android APK" href={ANDROID_BUILD} caption="Direct APK page" />
          </div>
        </div>

        <p style={{ marginTop: 24, textAlign: 'center', fontSize: 12, color: 'var(--ink-tertiary)' }}>
          Supabase Auth + Stripe Checkout live · 25% airport deposit · Expo previews above
        </p>
      </div>
    </div>
  )
}
