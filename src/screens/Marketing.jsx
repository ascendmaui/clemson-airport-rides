import { navigate } from '../lib/navigation'
import { MarketingChrome } from '../components/MarketingChrome'
import { HOMEPAGE_TRUST_LINE } from '../content/differentiators.js'

export function Marketing() {
  return (
    <MarketingChrome home>
      <section className="mkt-stage" aria-label="Clemson RIDES">
        <div className="mkt-stage-copy">
          <h1>Peace of mind, every ride.</h1>
          <div className="mkt-choices" role="group" aria-label="Ways to ride">
            <button type="button" className="mkt-choice pressable" onClick={() => navigate('home')}>Book a ride</button>
            <button type="button" className="mkt-choice pressable" onClick={() => navigate('home', { tier: 'carpool' })}>Book a carpool</button>
            <button type="button" className="mkt-choice pressable" onClick={() => navigate('schedule')}>Schedule for later</button>
          </div>
          <p className="mkt-trust">{HOMEPAGE_TRUST_LINE}</p>
          <button type="button" className="mkt-why-link pressable" onClick={() => navigate('why-clemson-rides')}>
            Why Clemson Rides
          </button>
        </div>
      </section>
    </MarketingChrome>
  )
}
