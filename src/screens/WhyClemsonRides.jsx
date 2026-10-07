import { navigate } from '../lib/navigation'
import { SitePage } from '../components/SitePage'
import {
  ONLY_AT_CLEMSON_RIDES,
  RELEASE_NOTE,
  RIDER_DIFFERENTIATORS,
} from '../content/differentiators.js'

export function WhyClemsonRides() {
  return (
    <SitePage current="why-clemson-rides">
      <section aria-labelledby="why-page-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">Why Clemson Rides</p>
          <h2 id="why-page-heading">Peace of mind</h2>
        </div>
        <div className="mkt-safety-live">
          {RIDER_DIFFERENTIATORS.map((item) => (
            <article key={item.id} className="mkt-card mkt-feature">
              {item.exclusive ? <p className="mkt-kicker">{ONLY_AT_CLEMSON_RIDES}</p> : null}
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
        <p className="mkt-release">{RELEASE_NOTE}</p>
        <button type="button" className="mkt-text pressable" onClick={() => navigate('drive')}>
          Drivers: earn more on scheduled rides
        </button>
        <button type="button" className="mkt-text pressable" onClick={() => navigate('landing')}>
          Back to the homepage
        </button>
      </section>
    </SitePage>
  )
}
