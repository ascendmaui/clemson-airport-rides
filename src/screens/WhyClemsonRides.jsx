import { navigate } from '../lib/navigation'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { SitePage } from '../components/SitePage'
import { NIGHT_VENUES } from '../content/images.js'

export function WhyClemsonRides() {
  return (
    <SitePage>
      <section aria-labelledby="why-page-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">Why Clemson Rides</p>
          <h2 id="why-page-heading">Built around campus</h2>
          <p>
            Clemson RIDES is a student ride product for this campus. It is not an official Clemson University service.
            Pickup spots are campus places. A confirmed @clemson.edu or @g.clemson.edu email gets 10% off Standard.
            Game day shows the pickup zone and the fare multiplier from the server.
          </p>
        </div>
        <div className="mkt-safety-live">
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="library-study-group" />
            <h3>Between classes</h3>
            <p>Study groups and class changes use the same booking flow as a ride home.</p>
          </article>
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="gameday-crowd" />
            <h3>Game day</h3>
            <p>When a game day is live, the rider home shows the pickup zone and the fare multiplier from the server.</p>
          </article>
        </div>
        <div className="mkt-section-head">
          <h2>College Avenue at night</h2>
        </div>
        <div className="mkt-safety-live mkt-venues">
          {NIGHT_VENUES.map((id) => <MarketingPhoto key={id} id={id} />)}
        </div>
        <button type="button" className="mkt-text pressable" onClick={() => navigate('landing')}>
          Back to the homepage
        </button>
      </section>
    </SitePage>
  )
}
