import { navigate } from '../lib/navigation'
import { SitePage } from '../components/SitePage'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { FEATURES, ONLY_AT_CLEMSON_RIDES } from '../content/features.js'

const WHY_IDS = ['backup-driver', 'confirm', 'switch-cancel', 'boosts', 'student', 'tiger-pass', 'clemson']

function WhyCard({ feature, photoId }) {
  return (
    <article className="mkt-card mkt-feature">
      {photoId ? <MarketingPhoto id={photoId} /> : null}
      {feature.exclusive ? <p className="mkt-kicker">{ONLY_AT_CLEMSON_RIDES}</p> : null}
      <h3>{feature.title}</h3>
      <p>{feature.what}</p>
      <p><strong>Why it matters. </strong>{feature.why}</p>
    </article>
  )
}

export function WhyClemsonRides() {
  const byId = new Map(FEATURES.map((item) => [item.id, item]))
  const features = WHY_IDS.map((id) => byId.get(id))
  return (
    <SitePage current="why-clemson-rides">
      <section aria-labelledby="why-page-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">Why Clemson Rides</p>
          <h2 id="why-page-heading">Peace of mind</h2>
        </div>
        <p className="mkt-note">
          A generic rideshare sends the open car. Here, a scheduled ride can add a backup driver.
          The driver confirms before they come. You can switch or cancel before they start toward you.
          A boost goes to the driver.
        </p>
        <div className="mkt-safety-live">
          {features.map((feature) => (
            <WhyCard
              key={feature.id}
              feature={feature}
              photoId={feature.id === 'clemson' ? 'gameday-crowd' : feature.id === 'student' ? 'day-from-campus' : null}
            />
          ))}
        </div>
        <div className="mkt-section-end">
          <button type="button" className="mkt-choice pressable" onClick={() => navigate('home')}>
            Book a ride
          </button>
        </div>
      </section>
    </SitePage>
  )
}
