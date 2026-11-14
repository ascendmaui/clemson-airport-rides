import { navigate } from '../lib/navigation'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { SitePage } from '../components/SitePage'
import { ONBOARDING_FLOW } from '../../shared/driverOnboarding.js'
import { DRIVER_IOS_STORE_URL, WEB_DRIVER_SIGNUP_URL } from '../../shared/productLinks.js'
import { APP_STORE_NOTE } from '../content/peaceOfMind.js'
import { DRIVER_EARNINGS, RELEASE_NOTE } from '../content/differentiators.js'
import { DrivePerks, RentalSection } from '../components/DrivePerks'
import { GlassGlyph } from '../components/GlassGlyph'
import { qrMatrix } from '../lib/qrMatrix.js'

function DriverSignupQr() {
  const { size, cells } = qrMatrix(WEB_DRIVER_SIGNUP_URL)
  const quiet = 4
  const span = size + quiet * 2
  return (
    <div
      className="mkt-card"
      style={{
        marginTop: 18,
        padding: 18,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16,
        alignItems: 'center',
        border: '1.5px solid #522D80',
      }}
    >
      <div className="mkt-qr-pair" style={{ margin: 0 }}>
        <svg
          className="mkt-qr-svg"
          role="img"
          aria-label="QR code for the Clemson Rides driver application"
          viewBox={`0 0 ${span} ${span}`}
          shapeRendering="crispEdges"
        >
          <rect width={span} height={span} fill="#ffffff" rx="2" />
          <g fill="#522D80" transform={`translate(${quiet} ${quiet})`}>
            {cells.map(([x, y]) => (
              <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />
            ))}
          </g>
        </svg>
      </div>
      <div style={{ flex: '1 1 240px' }}>
        <p className="mkt-kicker" style={{ marginBottom: 6 }}>Apply from your phone</p>
        <h3 style={{ margin: '0 0 6px' }}>Scan to open the driver application</h3>
        <p style={{ margin: '0 0 8px' }}>
          Scan the QR code or visit <a href={WEB_DRIVER_SIGNUP_URL}>{WEB_DRIVER_SIGNUP_URL}</a> to start or continue your application, or download <a href={DRIVER_IOS_STORE_URL} target="_blank" rel="noopener noreferrer">Clemson RIDES Driver on the App Store</a>.
        </p>
      </div>
    </div>
  )
}

export function DriveWithUs() {
  return (
    <SitePage current="drive">
      <DrivePerks />
      <RentalSection />
      <section aria-labelledby="drive-page-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">Drive</p>
          <h2 id="drive-page-heading">Drive with Clemson Rides</h2>
          <p>
            Eligible drivers can use Clemson Rides alongside Uber and Lyft with completely flexible availability — go online whenever you want for GSP and CLT airport rides, peak-hour campus demand, and Clemson game days.
          </p>
          <p>
            The application asks for your account, then the documents below. New drivers are never auto-approved.
            Clemson Rides reviews the application before you can take trips.
          </p>
          <p>
            Driver net on a trip is 80% of the fare. The platform fee is 20% of fares, wait fees, and cancel fees. Tips are 100% yours.
            A scheduled boost is separate. The driver keeps all of it, and it is not part of that 20% fee.
            Settled Tiger Heat pay replaces the default 80% net. Payouts are queued. A failed payout stays pending and is retried.
          </p>
          <p>{APP_STORE_NOTE}</p>
        </div>
        <DriverSignupQr />
        <div className="mkt-safety-live site-card-grid">
          <article className="mkt-card mkt-feature site-photo-card">
            <MarketingPhoto id="driver-student" sizes="(min-width: 1200px) 580px, 92vw" />
            <h3>Onboarding</h3>
            <ol className="mkt-guide">
              {ONBOARDING_FLOW.map((step) => <li key={step.id}>{step.label}</li>)}
            </ol>
            <p>
              License, insurance, registration, and car photos are required uploads. You also sign a background
              attestation. Authorized means you consented and disclosed nothing that needs a look. It is not a
              result from a screening company.
            </p>
          </article>
          <article className="mkt-card mkt-feature site-photo-card">
            <MarketingPhoto id="safety-verified-driver" sizes="(min-width: 1200px) 580px, 92vw" />
            <h3>After you submit</h3>
            <p>The application waits for review. New drivers are not auto-approved.</p>
          </article>
        </div>
        <div className="mkt-section-head mkt-drive-earnings">
          <p className="mkt-kicker">Earnings</p>
          <h2>Earn more on scheduled rides</h2>
        </div>
        <div className="mkt-safety-live site-card-grid site-card-grid--3">
          {DRIVER_EARNINGS.map((item, index) => (
            <article key={item.id} className="mkt-card mkt-feature">
              <p className="mkt-kicker">{index + 1}</p>
              <GlassGlyph name={item.id} />
              <h3>{item.title}</h3>
              <ol className="mkt-guide">
                {item.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </article>
          ))}
        </div>
        <p className="mkt-release mkt-note">{RELEASE_NOTE}</p>
        <div className="site-cta-row">
          <button type="button" className="mkt-text pressable site-cta-primary" onClick={() => { navigate('driver-signup'); navigate('driver-onboarding') }}>
            Start the driver application
          </button>
          <button type="button" className="mkt-text pressable" onClick={() => navigate('drivers/rentals')}>
            No car? Rent one from a local partner
          </button>
          <button type="button" className="mkt-text pressable" onClick={() => navigate('partners/join')}>
            Own rental cars? Become a Rental Partner
          </button>
        </div>
      </section>
    </SitePage>
  )
}
