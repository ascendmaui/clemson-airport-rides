import { MarketingChrome } from '../components/MarketingChrome'
import { CLEMSON_PURPLE, installOffer } from '../../shared/installLinks.js'

function AppCard({ offer, title, accent }) {
  return (
    <article className="mkt-card dl-card dl-card--page">
      <h2>{title}</h2>
      <a className="dl-go pressable" href={offer.iosHref} style={{ background: accent }}>
        Download on the App Store
      </a>
      <p>Official iPhone app for {title === 'Clemson RIDES Rider' ? 'riders' : 'approved drivers'}.</p>
    </article>
  )
}

export function AppDownloadPage() {
  const rider = installOffer('rider')
  const driver = installOffer('driver')

  if (!rider?.iosHref || !driver?.iosHref) return null

  return (
    <MarketingChrome current="get-the-app">
      <div className="mkt-section-head mkt-page-hero">
        <p className="mkt-kicker" style={{ background: CLEMSON_PURPLE }}>Clemson RIDES</p>
        <h1>Get the Clemson RIDES apps</h1>
        <p>Choose the app that matches your role. Both official iPhone apps are available on the App Store.</p>
      </div>
      <div className="dl-grid">
        <AppCard offer={rider} title="Clemson RIDES Rider" accent="#522D80" />
        <AppCard offer={driver} title="Clemson RIDES Driver" accent="#F56600" />
      </div>
    </MarketingChrome>
  )
}
