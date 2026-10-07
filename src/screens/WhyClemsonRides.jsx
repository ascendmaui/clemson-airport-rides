import { navigate } from '../lib/navigation'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { SitePage } from '../components/SitePage'

export function WhyClemsonRides() {
  return (
    <SitePage current="why-clemson-rides">
      <section aria-labelledby="why-page-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">Why Clemson Rides</p>
          <h2 id="why-page-heading">Built around campus</h2>
          <p>
            Clemson RIDES is a student ride product for this campus. It is not an official Clemson University service.
            Pickup spots are campus places. A confirmed @clemson.edu or @g.clemson.edu email gets 10% off Standard.
            That student discount does not include Carpool. Game day shows the pickup zone and the fare multiplier from the server.
          </p>
        </div>
        <div className="mkt-safety-live">
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="gameday-crowd" />
            <h3>Game day</h3>
            <p>When a game day is live, the rider home shows the pickup zone and the fare multiplier from the server.</p>
          </article>
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="students-carpool-backseat" />
            <h3>Ride with friends</h3>
            <p>Carpool is a discounted seat, 15% off, for 1 or 2 seats. It does not pair you with other riders.</p>
          </article>
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="day-from-campus" />
            <h3>From campus</h3>
            <p>Head back the same way. Schedule ahead, or request when you are ready to leave.</p>
          </article>
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="night-orange-screen" />
            <h3>Close to the curb</h3>
            <p>After a driver has accepted, the rider app pulses orange and shows the distance in feet as they get closer.</p>
          </article>
        </div>
        <button type="button" className="mkt-text pressable" onClick={() => navigate('landing')}>
          Back to the homepage
        </button>
      </section>
    </SitePage>
  )
}
