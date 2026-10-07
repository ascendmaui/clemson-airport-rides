import { navigate } from '../lib/navigation'
import { SitePage } from '../components/SitePage'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { FEATURES_HEADING } from '../content/features.js'

export function WhyClemsonRides() {
  return (
    <SitePage current="why-clemson-rides">
      <section aria-labelledby="why-page-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">Why Clemson Rides</p>
          <h2 id="why-page-heading">Peace of mind</h2>
        </div>
        <p className="mkt-lede mkt-note">
          {FEATURES_HEADING} is on the homepage, under the booking choices.
        </p>
        <div className="mkt-safety-live">
          <MarketingPhoto id="gameday-crowd" />
          <MarketingPhoto id="day-from-campus" />
        </div>
        <div className="mkt-section-end">
          <button
            type="button"
            className="mkt-choice pressable"
            onClick={() => navigate('landing', { section: 'features' })}
          >
            See the features
          </button>
          <button type="button" className="mkt-choice pressable" onClick={() => navigate('home')}>
            Book a ride
          </button>
        </div>
      </section>
    </SitePage>
  )
}
