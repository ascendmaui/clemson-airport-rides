import { useEffect } from 'react'
import { getHashRoute, navigate } from '../lib/navigation'
import { MarketingChrome } from '../components/MarketingChrome'
import { FeatureSections } from '../components/FeatureSections'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { PrimaryButton } from '../components/PrimaryButton'
import { HOMEPAGE_HEADLINE, HOMEPAGE_SUBLINE } from '../content/differentiators.js'
import { HOME_HERO } from '../content/images.js'

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
          <div className="mkt-hero-brand">
            <span className="mkt-brand-mark" aria-hidden="true">CR</span>
            <p className="mkt-hero-name">Clemson RIDES</p>
          </div>
          <h1>{HOMEPAGE_HEADLINE}</h1>
          <p className="mkt-lede">{HOMEPAGE_SUBLINE}</p>
          <div className="mkt-hero-actions">
            <PrimaryButton className="mkt-book" onClick={() => navigate('home')}>Book a ride</PrimaryButton>
            <button type="button" className="mkt-ghost pressable" onClick={() => navigate('get-the-app')}>
              Download the app
            </button>
          </div>
          <div className="mkt-choices" role="group" aria-label="Ways to ride">
            <button type="button" className="mkt-choice pressable" onClick={() => navigate('home', { tier: 'carpool' })}>Book a carpool</button>
            <button type="button" className="mkt-choice pressable" onClick={() => navigate('schedule')}>Schedule for later</button>
          </div>
          <button type="button" className="mkt-why-link pressable" onClick={() => navigate('why-clemson-rides')}>
            Why Clemson Rides
          </button>
        </div>
      </section>
      <section className="mkt-hero-collage mkt-home-hero" aria-label="Students on Clemson RIDES">
        {HOME_HERO.map((shot) => (
          <figure key={shot.id} className={shot.className}>
            <MarketingPhoto id={shot.id} eager={shot.eager} />
          </figure>
        ))}
      </section>
      <FeatureSections />
      <nav className="mkt-reach" aria-label="Night rides, carpool, and airport">
        <button type="button" className="mkt-text pressable" onClick={() => navigate('safety')}>Safe nights out</button>
        <button type="button" className="mkt-text pressable" onClick={() => navigate('how-it-works', { section: 'carpool' })}>Carpool</button>
        <button type="button" className="mkt-text pressable" onClick={() => navigate('service-area')}>Make your flight</button>
      </nav>
      <section className="mkt-close" aria-label="Book">
        <button type="button" className="mkt-choice pressable" onClick={() => navigate('home')}>Book a ride</button>
      </section>
    </MarketingChrome>
  )
}
