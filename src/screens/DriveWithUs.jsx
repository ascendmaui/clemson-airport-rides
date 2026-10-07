import { navigate } from '../lib/navigation'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { SitePage } from '../components/SitePage'
import { ONBOARDING_FLOW } from '../../shared/driverOnboarding.js'
import { APP_STORE_NOTE } from '../content/peaceOfMind.js'
import { DRIVER_EARNINGS, RELEASE_NOTE } from '../content/differentiators.js'

export function DriveWithUs() {
  return (
    <SitePage current="drive">
      <section aria-labelledby="drive-page-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">Drive</p>
          <h2 id="drive-page-heading">Drive with Clemson RIDES</h2>
          <p>
            The application asks for your account, then the documents below. New drivers are never auto-approved.
            Clemson RIDES reviews the application before you can take trips.
          </p>
          <p>
            Driver net on a trip is 80% of the fare. The platform fee is 20% of fares, tips, wait fees, and cancel fees.
            A scheduled boost is separate. The driver keeps all of it, and it is not part of that 20% fee.
            Settled Tiger Heat pay replaces the default 80% net. Payouts are queued. A failed payout stays pending and is retried.
          </p>
          <p>{APP_STORE_NOTE}</p>
        </div>
        <div className="mkt-safety-live">
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="driver-student" />
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
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="safety-verified-driver" />
            <h3>After you submit</h3>
            <p>The application waits for review. New drivers are not auto-approved.</p>
          </article>
        </div>
        <div className="mkt-section-head">
          <p className="mkt-kicker">Earnings</p>
          <h2>Earn more on scheduled rides</h2>
        </div>
        <div className="mkt-safety-live">
          {DRIVER_EARNINGS.map((item, index) => (
            <article key={item.id} className="mkt-card mkt-feature">
              <p className="mkt-kicker">{index + 1}</p>
              <h3>{item.title}</h3>
              <ol className="mkt-guide">
                {item.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </article>
          ))}
        </div>
        <p className="mkt-release">{RELEASE_NOTE}</p>
        <button type="button" className="mkt-text pressable" onClick={() => navigate('driver-signup')}>
          Start the driver application
        </button>
      </section>
    </SitePage>
  )
}
