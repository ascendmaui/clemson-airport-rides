import { navigate } from '../lib/navigation'
import { MarketingChrome } from '../components/MarketingChrome'
import { PrimaryButton } from '../components/PrimaryButton'

export function Marketing() {
  return (
    <MarketingChrome home>
      <section className="mkt-stage" aria-label="Clemson RIDES">
        <div className="mkt-stage-copy">
            <h1>Peace of mind, every ride.</h1>
            <p className="mkt-lede">
              Rides and carpools built for Clemson students. Book a discounted Carpool seat. Ride with friends.
            </p>
            <div className="mkt-actions">
              <PrimaryButton className="mkt-book" fullWidth={false} onClick={() => navigate('home')}>Book a ride</PrimaryButton>
              <button type="button" className="mkt-ghost pressable" onClick={() => navigate('get-the-app')}>Download the app</button>
            </div>
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
