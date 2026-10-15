import { useEffect } from 'react'
import { bookRideHref } from '../lib/bookRideLink'
import { getHashRoute, navigate } from '../lib/navigation'
import { MarketingChrome } from '../components/MarketingChrome'
import { FeatureSections } from '../components/FeatureSections'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { PrimaryButton } from '../components/PrimaryButton'
import { SiteIcon } from '../components/SiteIcon'
import { HOMEPAGE_HEADLINE, HOMEPAGE_SUBLINE } from '../content/differentiators.js'
import { HOME_HERO } from '../content/images.js'
import { RIDE_TYPE_GUIDE } from '../../shared/copy/rideTypes.js'
import { STUDENT_DISCOUNT_BPS } from '../lib/fareRates.js'

const RIDE_TYPE_ICONS = {
  standard: 'car',
  wait: 'hourglass',
  comfort: 'armchair',
  carpool: 'users',
}

/** Photo tiles under the ride types. Each one opens the page that explains it. */
const MOMENTS = [
  { id: 'gameday-crowd', title: 'Game day', body: 'The pickup zone and the fare show on the home screen when a game day is live.', icon: 'flag', route: 'how-it-works' },
  { id: 'airport-on-time', title: 'Airport rides', body: 'Schedule GSP or CLT ahead, with a backup driver if you want one.', icon: 'plane', route: 'service-area' },
  { id: 'night-going-out', title: 'Weekend and party', body: 'Book Friday or Saturday night ahead, so you are not hunting for a ride at the curb.', icon: 'moon', route: 'safety' },
  { id: 'library-study-group', title: 'Student price', body: `A confirmed Clemson email takes ${STUDENT_DISCOUNT_BPS / 100}% off Standard.`, icon: 'graduation-cap', route: 'ride-types' },
]

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
      <section className="mkt-stage" aria-label="Clemson Rides">
        <div className="mkt-stage-layout site-container">
          <div className="mkt-stage-copy">
            <div className="mkt-hero-brand">
              <img className="mkt-brand-mark" src="/brand/rider-icon.svg" alt="" width="64" height="64" />
              <p className="mkt-hero-name">Clemson Rides</p>
            </div>
            <h1>{HOMEPAGE_HEADLINE}</h1>
            <p className="mkt-lede">{HOMEPAGE_SUBLINE}</p>
            <div className="mkt-hero-actions">
              <PrimaryButton className="mkt-book" href={bookRideHref()}>
                <span className="site-btn-label">Book a ride</span>
                <SiteIcon name="arrow-right" size={20} />
              </PrimaryButton>
            </div>
            <div className="mkt-choices" role="group" aria-label="Ways to ride">
              <button type="button" className="mkt-choice pressable" onClick={() => navigate('home', { tier: 'carpool' })}>
                <SiteIcon name="users" size={18} />
                <span>Book a carpool</span>
              </button>
              <button type="button" className="mkt-choice pressable" onClick={() => navigate('schedule')}>
                <SiteIcon name="calendar" size={18} />
                <span>Schedule for later</span>
              </button>
            </div>
            <div className="site-hero-links">
              <button type="button" className="mkt-ghost pressable" onClick={() => navigate('get-the-app')}>
                <SiteIcon name="smartphone" size={16} />
                <span>Download the app</span>
              </button>
              <button type="button" className="mkt-why-link pressable" onClick={() => navigate('why-clemson-rides')}>
                <span>Why Clemson Rides</span>
                <SiteIcon name="chevron-right" size={16} />
              </button>
            </div>
          </div>
          <div className="mkt-hero-collage mkt-home-hero" role="group" aria-label="Students on Clemson Rides">
            {HOME_HERO.map((shot) => (
              <figure key={shot.id} className={shot.className}>
                <MarketingPhoto id={shot.id} eager={shot.eager} />
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section site-container site-types" aria-labelledby="ride-types-heading">
        <div className="site-head site-reveal">
          <p className="mkt-kicker">{RIDE_TYPE_GUIDE.kicker}</p>
          <h2 id="ride-types-heading">{RIDE_TYPE_GUIDE.title}</h2>
          <p>{RIDE_TYPE_GUIDE.lede}</p>
        </div>
        <ul className="site-type-list">
          {RIDE_TYPE_GUIDE.types.map((type) => (
            <li key={type.id} className="site-type site-reveal">
              <button type="button" className="site-type-card pressable" onClick={() => navigate('ride-types')}>
                <span className={`site-type-icon site-type-icon--${type.id}`}>
                  <SiteIcon name={RIDE_TYPE_ICONS[type.id]} size={22} />
                </span>
                <span className="site-type-name">{type.name}</span>
                <span className="site-type-detail">{type.detail}</span>
                <span className="site-type-more" aria-hidden="true"><SiteIcon name="arrow-right" size={16} /></span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="site-section site-container site-moments" aria-labelledby="moments-heading">
        <div className="site-head site-reveal">
          <p className="mkt-kicker">Built for Clemson</p>
          <h2 id="moments-heading">Every ride you take here</h2>
        </div>
        <div className="site-moment-list">
          {MOMENTS.map((moment) => (
            <button key={moment.id} type="button" className="site-moment site-reveal pressable" onClick={() => navigate(moment.route)}>
              <MarketingPhoto id={moment.id} className="site-moment-photo" sizes="(min-width: 1200px) 300px, (min-width: 760px) 45vw, 88vw" />
              <span className="site-moment-copy">
                <span className="site-moment-icon"><SiteIcon name={moment.icon} size={18} /></span>
                <span className="site-moment-title">{moment.title}</span>
                <span className="site-moment-body">{moment.body}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="site-container">
        <FeatureSections />
      </div>

      <section className="site-section site-container" aria-label="Book">
        <div className="site-cta-band site-reveal">
          <div className="site-cta-copy">
            <p className="mkt-kicker">Ready when you are</p>
            <h2>Where to next?</h2>
            <nav className="mkt-reach" aria-label="Night rides, carpool, and airport">
              <button type="button" className="mkt-text pressable" onClick={() => navigate('safety')}>
                <SiteIcon name="shield-check" size={16} /><span>Safe nights out</span>
              </button>
              <button type="button" className="mkt-text pressable" onClick={() => navigate('how-it-works', { section: 'carpool' })}>
                <SiteIcon name="users" size={16} /><span>Carpool</span>
              </button>
              <button type="button" className="mkt-text pressable" onClick={() => navigate('service-area')}>
                <SiteIcon name="plane" size={16} /><span>Make your flight</span>
              </button>
            </nav>
          </div>
          <div className="mkt-close">
            <a className="mkt-choice pressable" href={bookRideHref()}>
              <span>Book a ride</span>
              <SiteIcon name="arrow-right" size={18} />
            </a>
          </div>
        </div>
      </section>
    </MarketingChrome>
  )
}
