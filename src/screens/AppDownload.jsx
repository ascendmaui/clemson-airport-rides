import { useEffect } from 'react'
import { MarketingChrome } from '../components/MarketingChrome'
import { QrMark } from '../components/QrMark'
import {
  CLEMSON_ORANGE,
  CLEMSON_PURPLE,
  installOffer,
  redirectTarget,
} from '../../shared/installLinks.js'

function AppCard({ offer, title, accent, active }) {
  return (
    <article
      className="mkt-card dl-card dl-card--page"
      style={{ borderTop: `4px solid ${accent}`, outline: active ? `2px solid ${accent}` : 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img
          className="mkt-app-icon"
          src={offer.id === 'driver' ? '/brand/driver-icon.svg' : '/brand/rider-icon.svg'}
          alt=""
          width="56"
          height="56"
        />
        <div>
          <p className="mkt-kicker" style={{ background: accent, marginBottom: 4 }}>{offer.audience}</p>
          <h2 style={{ margin: 0 }}>{title}</h2>
        </div>
      </div>
      <p>
        {title === 'Clemson RIDES Rider'
          ? 'Official iPhone app for campus rides, carpools, and scheduled GSP & CLT airport transfers.'
          : 'Official iPhone app for approved Clemson RIDES drivers — accept offers, navigate, and track earnings.'}
      </p>
      {offer.iosHref ? (
        <a
          className="dl-go pressable"
          href={offer.iosHref}
          target="_blank"
          rel="noopener noreferrer"
          style={{ background: accent }}
        >
          Download on the App Store
        </a>
      ) : (
        <p className="dl-soon" role="status">Coming soon</p>
      )}
      <QrMark value={offer.pageUrl} label={`QR code for ${title}`} color={accent} />
      <p style={{ fontSize: 13, opacity: 0.88 }}>
        <a href={offer.pageUrl}>{offer.pageUrl}</a>
        {offer.androidHref ? (
          <>
            {' · '}
            <a href={offer.androidHref}>
              {offer.androidKind === 'play' ? 'Get it on Google Play' : 'Android APK'}
            </a>
          </>
        ) : null}
      </p>
    </article>
  )
}

export function AppDownloadPage({ appId = 'rider' } = {}) {
  const rider = installOffer('rider')
  const driver = installOffer('driver')
  const offer = appId === 'driver' ? driver : rider

  useEffect(() => {
    const current = installOffer(appId)
    if (!current || typeof window === 'undefined') return undefined
    const previous = document.title
    document.title = `${current.product} download`
    const stay = new URLSearchParams(window.location.search).get('stay') === '1'
    const target = redirectTarget(current, window.navigator.userAgent, { stay })
    if (target) window.location.replace(target)
    return () => {
      document.title = previous
    }
  }, [appId])

  if (!rider || !driver) return null

  return (
    <MarketingChrome current="get-the-app">
      <div className="mkt-section-head mkt-page-hero">
        <p className="mkt-kicker" style={{ background: CLEMSON_PURPLE }}>Clemson RIDES</p>
        <h1>Get the Clemson RIDES apps</h1>
        <p>Choose the app that matches your role. Both official iPhone apps are available on the App Store.</p>
      </div>
      <div className="dl-grid">
        <AppCard offer={rider} title="Clemson RIDES Rider" accent={CLEMSON_ORANGE} active={offer?.id === 'rider'} />
        <AppCard offer={driver} title="Clemson RIDES Driver" accent={CLEMSON_PURPLE} active={offer?.id === 'driver'} />
      </div>
    </MarketingChrome>
  )
}
