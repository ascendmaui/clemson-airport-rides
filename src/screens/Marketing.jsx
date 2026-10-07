import { useEffect, useState } from 'react'
import { navigate } from '../lib/navigation'
import { PrimaryButton } from '../components/PrimaryButton'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { messagingGuide } from '../../shared/copy/messaging.js'
import { FEATURE_IMAGES, HERO_COLLAGE } from '../../shared/marketingImages.js'

const STADIUM = {
  src: '/marketing/clemson-memorial-stadium.jpg',
  alt: 'Clemson Memorial Stadium at night, the stands full under the lights',
}

const CAMPUS_SHOTS = [
  {
    id: FEATURE_IMAGES.student,
    title: 'Study group',
    body: 'Rides between the library, class, and home.',
  },
  {
    id: FEATURE_IMAGES.gameday,
    title: 'Game day',
    body: 'When a game day is live, the rider home shows the pickup zone and the fare multiplier from the server.',
  },
  {
    id: FEATURE_IMAGES.matching,
    title: 'On College Avenue',
    body: 'Request a ride from the curb. The fare is on screen before you confirm.',
  },
  {
    id: FEATURE_IMAGES.tracking,
    title: 'On your phone',
    body: 'The trip stays on your phone from the request until you arrive.',
  },
]

const SAFETY_CARDS = [
  {
    id: 'night-live-tracking',
    title: 'Live tracking',
    body: 'After a driver accepts, the trip screen follows the ride from pickup through drop-off.',
  },
  {
    id: 'safety-share-trip',
    title: 'Share your trip',
    body: 'Share a live trip link with someone you trust. Location updates while the ride is underway.',
  },
  {
    id: 'night-sos',
    title: 'SOS',
    body: 'Call 911 or Clemson Police from the app. The first press confirms and does not dial.',
  },
  {
    id: 'safety-recording',
    title: 'Voice and audio recording',
    body: 'Record audio during an active ride, right in the app. You start it on your phone after a driver has accepted. The clip stays on that phone and is not uploaded, and a banner stays up while it is recording.',
  },
  {
    id: 'safety-verified-driver',
    title: 'Driver review',
    body: 'New drivers are not auto-approved. Clemson RIDES reviews the application before they take trips.',
  },
  {
    id: 'night-orange-screen',
    title: 'The ride on your phone',
    body: 'Request, match, and the trip itself stay on your phone until you arrive.',
  },
]

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

function LiveMark() {
  return <span className="mkt-live">Live</span>
}

function SafetyCard({ card }) {
  return (
    <article className="mkt-card mkt-feature mkt-safety-card">
      <MarketingPhoto id={card.id} />
      <LiveMark />
      <h3>{card.title}</h3>
      <p>{card.body}</p>
    </article>
  )
}

export function Marketing() {
  const overPage = useNavOverPage()
  const riderGuide = messagingGuide('rider')
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
              <button type="button" className="mkt-choice pressable" onClick={() => navigate('carpool', { hub: '1' })}>Book a carpool</button>
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
        <section aria-labelledby="campus-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">On campus</p>
            <h2 id="campus-heading">What the ride looks like</h2>
          </div>
          <div className="mkt-safety-live">
            {CAMPUS_SHOTS.map((shot) => (
              <article key={shot.id} className="mkt-card mkt-feature">
                <MarketingPhoto id={shot.id} />
                <h3>{shot.title}</h3>
                <p>{shot.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mkt-block" aria-labelledby="how-heading">
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
              <LiveMark />
              <h3>{riderGuide.title}</h3>
              <ul className="mkt-guide">
                {riderGuide.summary.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </article>
            <article className="mkt-card mkt-feature">
              <LiveMark />
              <h3>{riderGuide.lostItemTitle}</h3>
              <ol className="mkt-guide">
                {riderGuide.lostItemSteps.map((line) => <li key={line}>{line}</li>)}
              </ol>
            </article>
          </div>
        </section>

        <section id="night-safety" className="mkt-safety" aria-labelledby="night-safety-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">Nighttime safety</p>
            <h2 id="night-safety-heading">Peace of mind after dark</h2>
            <p>These tools are live in the rider app, the driver app, and on the web.</p>
          </div>
          <MarketingPhoto id="night-going-out" className="mkt-section-banner" />
          <div className="mkt-safety-live">
            {SAFETY_CARDS.map((card) => <SafetyCard key={card.id} card={card} />)}
          </div>
        </section>

        <section className="mkt-block" aria-labelledby="carpool-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">Carpool</p>
            <h2 id="carpool-heading">Split the fare</h2>
            <p>One car, pickups along the way, then the drop-off.</p>
          </div>
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="carpool-how-it-works" />
            <ol className="mkt-guide">
              <li>Share one car</li>
              <li>Three pickups along the way</li>
              <li>Then the airport</li>
            </ol>
            <button type="button" className="mkt-text pressable" onClick={() => navigate('carpool', { hub: '1' })}>
              Book a carpool
            </button>
          </article>
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="carpool-friends-curb" />
            <h3>Ride with friends</h3>
            <p>Everyone sees their share before the carpool is charged.</p>
          </article>
        </section>

        <section className="mkt-block" aria-labelledby="airport-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">Airport</p>
            <h2 id="airport-heading">On time for the flight</h2>
          </div>
          <article className="mkt-card mkt-feature">
            <MarketingPhoto id="airport-on-time" />
            <h3>Airport rides</h3>
            <p>
              Schedule a ride to Greenville-Spartanburg (GSP) or Charlotte Douglas (CLT).
              Stripe places a pre-authorization hold for the estimated fare plus a buffer.
              The full fare is charged when the trip ends.
            </p>
          </article>
        </section>

        <section id="why-clemson-rides" className="mkt-block" aria-labelledby="why-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">Why Clemson Rides</p>
            <h2 id="why-heading">Built for students here</h2>
          </div>
          <div className="mkt-safety-live">
            <article className="mkt-card mkt-feature">
              <MarketingPhoto id="gameday-crowd" />
              <h3>Game day</h3>
              <p>When a game day is live, the rider home shows the pickup zone and the fare multiplier from the server.</p>
            </article>
            <article className="mkt-card mkt-feature">
              <MarketingPhoto id="students-carpool-backseat" />
              <h3>Carpools with friends</h3>
              <p>Split the fare and ride together.</p>
            </article>
            <article className="mkt-card mkt-feature">
              <MarketingPhoto id="day-from-campus" />
              <h3>Leaving campus</h3>
              <p>Daytime rides back from class use the same booking flow.</p>
            </article>
            <article className="mkt-card mkt-feature">
              <MarketingPhoto id="night-orange-screen" />
              <h3>Night rides</h3>
              <p>The trip stays on your phone, with live tracking, sharing, and audio recording once a driver has accepted.</p>
            </article>
          </div>
        </section>
      </main>

      <footer className="mkt-footer" id="get-the-app">
        <div className="mkt-inner mkt-footer-inner">
          <span>Clemson RIDES</span>
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
