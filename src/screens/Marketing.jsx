import { useEffect, useState } from 'react'
import { navigate } from '../lib/navigation'
import { PrimaryButton } from '../components/PrimaryButton'
import { FeatureBlock } from '../components/FeatureBlock'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { messagingGuide } from '../../shared/copy/messaging.js'
import { HERO_COLLAGE, NIGHT_VENUES } from '../content/images.js'
import {
  AIRPORT_SECTION,
  APP_STORE_NOTE,
  BUILT_IN,
  BUILT_IN_SECTION,
  CARPOOL_SECTION,
  SAFETY_FEATURES,
  SAFETY_SECTION,
} from '../content/peaceOfMind.js'

const STADIUM = {
  src: '/marketing/clemson-memorial-stadium.jpg',
  alt: 'Clemson Memorial Stadium at night, the stands full under the lights',
}

function scrollToDownloads() {
  document.getElementById('get-the-app')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function useNavOverPage() {
  const [overPage, setOverPage] = useState(false)
  useEffect(() => {
    const nav = document.querySelector('.mkt-nav')
    const stage = document.querySelector('.mkt-stage')
    const scroller = nav?.closest('.app-shell') || null
    if (!stage) return undefined
    const read = () => {
      const top = scroller ? scroller.scrollTop : window.scrollY
      setOverPage(top > 12)
    }
    read()
    const target = scroller || window
    target.addEventListener('scroll', read, { passive: true })
    window.addEventListener('resize', read)
    return () => {
      target.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
    }
  }, [])
  return overPage
}

function messagingFeature(guide) {
  const feature = BUILT_IN.find((item) => item.id === 'messaging')
  return {
    ...feature,
    what: guide.summary.join(' '),
    how: `${guide.title}. ${guide.summary.join(' ')} ${guide.lostItemTitle}. ${guide.lostItemSteps.join(' ')}`,
  }
}

export function Marketing() {
  const overPage = useNavOverPage()
  const riderGuide = messagingGuide('rider')
  const builtIn = BUILT_IN.map((feature) => (feature.id === 'messaging' ? messagingFeature(riderGuide) : feature))
  return (
    <div className="mkt fade-in">
      <header className={overPage ? 'mkt-nav mkt-nav--scrolled' : 'mkt-nav'}>
        <button type="button" className="mkt-brand pressable" onClick={() => navigate('landing')}>
          <span>Clemson RIDES</span>
        </button>
        <nav className="mkt-nav-links" aria-label="Marketing">
          <button type="button" className="pressable" onClick={() => navigate('home')}>Book</button>
          <button type="button" className="pressable" onClick={() => navigate('driver-signup')}>Drive</button>
          <button type="button" className="pressable mkt-nav-cta" onClick={scrollToDownloads}>Get the App</button>
        </nav>
      </header>

      <section className="mkt-stage" aria-label="Clemson RIDES">
        <img className="mkt-stage-photo" src={STADIUM.src} alt={STADIUM.alt} />
        <div className="mkt-stage-shade" aria-hidden="true" />
        <div className="mkt-stage-layout">
          <div className="mkt-stage-copy">
            <div className="mkt-hero-brand">
              <span className="mkt-brand-mark" aria-hidden="true">CR</span>
              <p className="mkt-hero-name">Clemson RIDES</p>
            </div>
            <h1>Peace of mind, every ride.</h1>
            <p className="mkt-lede">
              Rides and carpools built for Clemson students. Split the fare. Ride with friends.
            </p>
            <div className="mkt-actions">
              <PrimaryButton className="mkt-book" fullWidth={false} onClick={() => navigate('home')}>Book a ride</PrimaryButton>
              <button type="button" className="mkt-ghost pressable" onClick={scrollToDownloads}>
                Download the app
              </button>
            </div>
            <div className="mkt-choices" role="group" aria-label="Ways to ride">
              <button type="button" className="mkt-choice pressable" onClick={() => navigate('home')}>Book a ride</button>
              <button type="button" className="mkt-choice pressable" onClick={() => navigate('home', { tier: 'carpool' })}>Book a carpool</button>
              <button type="button" className="mkt-choice pressable" onClick={() => navigate('schedule')}>Schedule for later</button>
            </div>
          </div>
          <div className="mkt-hero-collage">
            {HERO_COLLAGE.map((shot) => (
              <figure key={shot.id} className={shot.className}>
                <MarketingPhoto id={shot.id} eager={shot.eager} />
              </figure>
            ))}
          </div>
        </div>
      </section>

      <main className="mkt-inner mkt-main">
        <section aria-labelledby="built-in-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">{BUILT_IN_SECTION.kicker}</p>
            <h2 id="built-in-heading">{BUILT_IN_SECTION.title}</h2>
          </div>
          <div className="mkt-safety-live mkt-built">
            {builtIn.map((feature) => <FeatureBlock key={feature.id} feature={feature} />)}
          </div>
        </section>

        <section aria-labelledby="how-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">How it works</p>
            <h2 id="how-heading">From class to the ride home</h2>
          </div>
          <div className="mkt-safety-live">
            <article className="mkt-card mkt-feature">
              <MarketingPhoto id="day-to-class" />
              <h3>To class</h3>
              <p>Request a ride when you are heading to class. The fare is on screen before you confirm.</p>
            </article>
            <article className="mkt-card mkt-feature">
              <MarketingPhoto id="day-from-campus" />
              <h3>From campus</h3>
              <p>Head back the same way. Schedule ahead, or request when you are ready to leave.</p>
            </article>
            <article className="mkt-card mkt-feature">
              <MarketingPhoto id="college-ave-request" />
              <h3>College Avenue</h3>
              <p>Request from a campus spot. The same trip screen follows the ride after a driver accepts.</p>
            </article>
          </div>
        </section>

        <section id="night-safety" className="mkt-safety" aria-labelledby="night-safety-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">{SAFETY_SECTION.kicker}</p>
            <h2 id="night-safety-heading">{SAFETY_SECTION.title}</h2>
            <p><strong>What it is. </strong>{SAFETY_SECTION.what}</p>
            <p><strong>Why it matters. </strong>{SAFETY_SECTION.why}</p>
          </div>
          <MarketingPhoto id="night-going-out" className="mkt-section-banner" />
          <div className="mkt-safety-live mkt-venues">
            {NIGHT_VENUES.map((id) => <MarketingPhoto key={id} id={id} />)}
          </div>
          <div className="mkt-safety-live">
            {SAFETY_FEATURES.map((feature) => <FeatureBlock key={feature.id} feature={feature} />)}
          </div>
        </section>

        <section className="mkt-block" aria-labelledby="carpool-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">{CARPOOL_SECTION.kicker}</p>
            <h2 id="carpool-heading">{CARPOOL_SECTION.title}</h2>
            <p><strong>What it is. </strong>{CARPOOL_SECTION.what}</p>
          </div>
          <article className="mkt-card mkt-feature">
            <ol className="mkt-guide">
              {CARPOOL_SECTION.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <p className="mkt-why"><strong>Why it matters. </strong>{CARPOOL_SECTION.why}</p>
            <button type="button" className="mkt-text pressable" onClick={() => navigate('home', { tier: 'carpool' })}>
              Book a carpool
            </button>
            <button type="button" className="mkt-text pressable" onClick={() => navigate('carpool', { hub: '1' })}>
              Open the carpool hub
            </button>
          </article>
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="carpool-friends-curb" />
            <MarketingPhoto id="carpool-how-it-works" />
            <h3>{CARPOOL_SECTION.hubTitle}</h3>
            <p><strong>What it is. </strong>{CARPOOL_SECTION.hubWhat}</p>
            <p>{CARPOOL_SECTION.diagramCaption}</p>
            <ol className="mkt-guide">
              {CARPOOL_SECTION.hubSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </article>
        </section>

        <section className="mkt-block" aria-labelledby="airport-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">{AIRPORT_SECTION.kicker}</p>
            <h2 id="airport-heading">{AIRPORT_SECTION.title}</h2>
            <p><strong>What it is. </strong>{AIRPORT_SECTION.what}</p>
          </div>
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="airport-on-time" />
            <MarketingPhoto id="students-carpool-backseat" />
            <ol className="mkt-guide">
              {AIRPORT_SECTION.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <p className="mkt-why"><strong>Why it matters. </strong>{AIRPORT_SECTION.why}</p>
            <button type="button" className="mkt-text pressable" onClick={() => navigate('schedule')}>
              Schedule for later
            </button>
          </article>
        </section>

        <section id="why-clemson-rides" className="mkt-block" aria-labelledby="why-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">Why Clemson Rides</p>
            <h2 id="why-heading">Built for students here</h2>
            <p>
              Campus spots, a student email discount, game day, and scheduled rides to GSP and CLT.
            </p>
          </div>
          <button type="button" className="mkt-text pressable" onClick={() => navigate('why-clemson-rides')}>
            Why Clemson Rides
          </button>
          <button type="button" className="mkt-text pressable" onClick={() => navigate('drive')}>
            How driving works
          </button>
        </section>
      </main>

      <footer className="mkt-footer" id="get-the-app">
        <div className="mkt-inner mkt-footer-inner">
          <span>Clemson RIDES</span>
          <p>{APP_STORE_NOTE}</p>
          <nav aria-label="Footer">
            <button type="button" className="pressable" onClick={() => navigate('driver-signup')}>Drive</button>
            <button type="button" className="pressable" onClick={() => navigate('service-area')}>Service area</button>
            <button type="button" className="pressable" onClick={() => navigate('account', { tab: 'billing' })}>Tiger Pass</button>
            <button type="button" className="pressable" onClick={() => navigate('account', { tab: 'safety' })}>Safety</button>
            <button type="button" className="pressable" onClick={() => navigate('privacy')}>Privacy</button>
            <button type="button" className="pressable" onClick={() => navigate('terms')}>Terms</button>
          </nav>
        </div>
      </footer>
    </div>
  )
}
