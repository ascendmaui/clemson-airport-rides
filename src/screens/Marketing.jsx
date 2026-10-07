import { navigate } from '../lib/navigation'
import { MarketingChrome } from '../components/MarketingChrome'

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
        </div>
      </section>
    </MarketingChrome>
  )
}
