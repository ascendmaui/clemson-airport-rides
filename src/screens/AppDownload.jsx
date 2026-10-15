import { useEffect } from 'react'
import { MarketingChrome } from '../components/MarketingChrome'
import { QrMark } from '../components/QrMark'
import {
  CLEMSON_ORANGE,
  CLEMSON_PURPLE,
  installOffer,
  redirectTarget,
} from '../../shared/installLinks.js'

function PlatformCode({ href, label, color, action, note }) {
  if (!href) {
    return (
      <article className="mkt-card dl-card">
        <h2>{label}</h2>
        <p className="dl-soon" role="status">Coming soon</p>
        <p>{note}</p>
      </article>
    )
  }
  return (
    <article className="mkt-card dl-card">
      <h2>{label}</h2>
      <QrMark value={href} label={action} color={color} />
      <a className="dl-go pressable" href={href} style={{ background: color }}>
        {action}
      </a>
      <p>{note}</p>
    </article>
  )
}

export function AppDownloadPage({ appId }) {
  const offer = installOffer(appId)
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

  if (!offer) return null
  const other = installOffer(appId === 'driver' ? 'rider' : 'driver')
  const iosNote = offer.iosState === 'app-store'
    ? 'Opens the App Store listing.'
    : 'Coming soon to the App Store. Until then, use clemsonrides.com in Safari.'
  const androidNote = offer.androidKind === 'play'
    ? 'Opens the Play Store listing.'
    : 'Downloads the latest Android APK.'

  return (
    <MarketingChrome current="get-the-app">
      <div className="mkt-section-head mkt-page-hero">
        <p className="mkt-kicker" style={{ background: CLEMSON_PURPLE }}>{offer.audience}</p>
        <h1>{offer.product}</h1>
        <p>
          Scan a code, or open this page on your phone. The iPhone app is coming soon to the App Store.
          Android downloads the latest APK, or opens Play once that listing is set.
        </p>
      </div>
      <article className="mkt-card dl-card dl-card--page">
        <h2>Scan to install</h2>
        <QrMark value={offer.pageUrl} label={`QR code for the ${offer.product} install page`} color={CLEMSON_PURPLE} />
        <p>
          <a href={offer.pageUrl}>{offer.pageUrl}</a>
        </p>
      </article>
      <div className="dl-grid">
        <PlatformCode
          href={offer.iosHref}
          label="iPhone"
          color={CLEMSON_PURPLE}
          action={offer.iosHref ? 'Download on the App Store' : 'Coming soon'}
          note={iosNote}
        />
        <PlatformCode
          href={offer.androidHref}
          label="Android"
          color={CLEMSON_ORANGE}
          action={offer.androidKind === 'play' ? 'Get it on Google Play' : 'Download the Android APK'}
          note={androidNote}
        />
      </div>
      <p className="dl-stay">
        <a href={`${offer.pagePath}?stay=1`}>Stay on this page</a>
        {' · '}
        <a href={other.pagePath}>{other.product}</a>
      </p>
    </MarketingChrome>
  )
}
