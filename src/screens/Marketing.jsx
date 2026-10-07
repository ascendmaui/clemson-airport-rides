import { useEffect } from 'react'
import { getHashRoute, navigate } from '../lib/navigation'
import { MarketingChrome } from '../components/MarketingChrome'
import { FeatureSections } from '../components/FeatureSections'
import { HOMEPAGE_HEADLINE, HOMEPAGE_SUBLINE } from '../content/differentiators.js'

export function Marketing() {
  useEffect(() => {
    if (getHashRoute().params.section !== 'features') return undefined
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('features')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <MarketingChrome home>
      <section className="mkt-stage" aria-label="Clemson RIDES">
        <div className="mkt-stage-copy">
          <h1>{HOMEPAGE_HEADLINE}</h1>
          <p className="mkt-lede">{HOMEPAGE_SUBLINE}</p>
          <div className="mkt-choices" role="group" aria-label="Ways to ride">
            <button type="button" className="mkt-choice pressable" onClick={() => navigate('home')}>Book a ride</button>
            <button type="button" className="mkt-choice pressable" onClick={() => navigate('home', { tier: 'carpool' })}>Book a carpool</button>
            <button type="button" className="mkt-choice pressable" onClick={() => navigate('schedule')}>Schedule for later</button>
          </div>
        </div>
      </section>
      <FeatureSections />
      <section className="mkt-close" aria-label="Book">
        <button type="button" className="mkt-choice pressable" onClick={() => navigate('home')}>Book a ride</button>
      </section>
    </MarketingChrome>
  )
}
