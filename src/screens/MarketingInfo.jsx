import { useEffect } from 'react'
import { getHashRoute, navigate } from '../lib/navigation'
import { MarketingChrome } from '../components/MarketingChrome'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { FeatureBlock } from '../components/FeatureBlock'
import { messagingGuide } from '../../shared/copy/messaging.js'
import { HERO_COLLAGE, NIGHT_VENUES } from '../content/images.js'
import { APP_DOWNLOADS } from '../../shared/productLinks.js'
import { RIDE_OPTION_CATALOG, SCHEDULE_AHEAD_DISCOUNT_PCT } from '../../shared/rideOptions.js'
import { CARPOOL_DISCOUNT_BPS, STUDENT_DISCOUNT_BPS } from '../lib/fareRates.js'
import { tigerPassCopy } from '../../shared/tigerPass.js'
import { STANDING_OFFERS } from '../../shared/standingPromos.js'
import { currentWeeklyCoupon } from '../../shared/weeklyCoupon.js'
import {
  APP_STORE_NOTE,
  BUILT_IN,
  BUILT_IN_SECTION,
  CARPOOL_SECTION,
  SAFETY_FEATURES,
  SAFETY_SECTION,
} from '../content/peaceOfMind.js'

const RIDE_TYPE_NOTES = {
  standard: 'The base ride. The fare on the booking screen is the price before you confirm.',
  wait: 'Shown when a driver can serve it. The fare is the quote on that screen. The student discount does not apply.',
  comfort: 'Newer cars. Only a vehicle marked Extra Comfort can take this ride.',
  carpool: `${CARPOOL_DISCOUNT_BPS / 100}% off the Standard fare for each seat. Book 1 or 2 seats. Drivers see it labeled Carpool, and it is offered to the same cars as Standard. Two separate carpool requests are not combined into one car.`,
}

const FAQ = [
  {
    q: 'How do I book?',
    a: 'Book a ride, choose a destination, confirm the pickup, then pick Standard, Wait & Save, Extra Comfort, or Carpool. A type is shown only when a driver can serve it.',
  },
  {
    q: 'How does carpool pricing work?',
    a: `Carpool is ${CARPOOL_DISCOUNT_BPS / 100}% off the Standard fare per seat, for 1 or 2 seats. It is dispatched like Standard. Two separate carpool requests are not combined into one car.`,
  },
  {
    q: 'Who gets the student discount?',
    a: `${STUDENT_DISCOUNT_BPS / 100}% off Standard when the signed-in email is confirmed and ends with @clemson.edu or @g.clemson.edu. Other ride types are not included.`,
  },
  {
    q: 'When am I charged?',
    a: 'Stripe places a pre-authorization hold for the estimated fare. The full fare is charged when the trip ends. Scheduling does not charge the card.',
  },
  {
    q: 'Can I schedule an airport ride?',
    a: 'Yes. Schedule a ride to Greenville-Spartanburg (GSP) or Charlotte Douglas (CLT).',
  },
  {
    q: 'What is Tiger Pass?',
    a: `${tigerPassCopy().summary} The price is ${tigerPassCopy().priceLabel}. Manage it from Account, Billing.`,
  },
  {
    q: 'What if I leave something in the car?',
    a: 'You can message after a driver accepts and during the ride. Chat closes when the ride ends, except for a lost item.',
  },
]

function PageHead({ kicker, title, lede }) {
  return (
    <div className="mkt-section-head">
      <p className="mkt-kicker">{kicker}</p>
      <h1>{title}</h1>
      {lede ? <p>{lede}</p> : null}
    </div>
  )
}

function withMessaging(feature, guide) {
  if (feature.id !== 'messaging' && feature.id !== 'messaging-safety') return feature
  return {
    ...feature,
    what: guide.summary.join(' '),
    how: `${guide.title}. ${guide.summary.join(' ')} ${guide.lostItemTitle}. ${guide.lostItemSteps.join(' ')}`,
  }
}

function bookFor(route) {
  switch (route) {
    case 'home':
      return () => navigate('home')
    case 'carpool':
      return () => navigate('home', { tier: 'carpool' })
    case 'schedule':
      return () => navigate('schedule')
    default: {
      const unexpected = route
      throw new Error(`Unexpected book route: ${String(unexpected)}`)
    }
  }
}

export function HowItWorks() {
  const riderGuide = messagingGuide('rider')
  const builtIn = BUILT_IN.map((feature) => withMessaging(feature, riderGuide))
  useEffect(() => {
    if (getHashRoute().params.section !== 'carpool') return undefined
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('carpool')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])
  return (
    <MarketingChrome current="how-it-works">
      <PageHead kicker="How it works" title="Peace of mind, built in" lede="Rides and carpools built for Clemson students." />
      <div className="mkt-hero-collage">
        {HERO_COLLAGE.map((shot) => (
          <figure key={shot.id} className={shot.className}>
            <MarketingPhoto id={shot.id} eager={shot.eager} />
          </figure>
        ))}
      </div>
      <div className="mkt-section-head">
        <p className="mkt-kicker">{BUILT_IN_SECTION.kicker}</p>
        <h2>{BUILT_IN_SECTION.title}</h2>
      </div>
      <div className="mkt-safety-live mkt-built">
        {builtIn.map((feature) => (
          <FeatureBlock key={feature.id} feature={feature} onBook={bookFor(feature.bookRoute)} />
        ))}
      </div>
      <div className="mkt-safety-live">
        <article className="mkt-card mkt-feature">
          <MarketingPhoto id="day-to-class" />
          <h2>To class</h2>
          <p>Request a ride when you are heading to class. The fare is on screen before you confirm.</p>
        </article>
        <article className="mkt-card mkt-feature">
          <MarketingPhoto id="college-ave-request" />
          <h2>College Avenue</h2>
          <p>Request from a campus spot. The same trip screen follows the ride after a driver accepts.</p>
        </article>
      </div>
      <article className="mkt-card mkt-feature" id="carpool">
        <p className="mkt-kicker">{CARPOOL_SECTION.kicker}</p>
        <h2>{CARPOOL_SECTION.title}</h2>
        <p>{CARPOOL_SECTION.what}</p>
        <MarketingPhoto id="carpool-how-it-works" />
        <ol className="mkt-guide">
          {CARPOOL_SECTION.steps.map((step) => (
            <li key={step.title}>
              <strong>{step.title}. </strong>
              {step.body}
            </li>
          ))}
        </ol>
        <p>{CARPOOL_SECTION.diagramCaption}</p>
        <MarketingPhoto id="carpool-friends-curb" />
        <p><strong>Why it matters. </strong>{CARPOOL_SECTION.why}</p>
        <button type="button" className="mkt-text pressable" onClick={() => navigate('home', { tier: 'carpool' })}>
          Book a carpool
        </button>
      </article>
    </MarketingChrome>
  )
}

export function RideTypesPage() {
  const pass = tigerPassCopy()
  return (
    <MarketingChrome current="ride-types">
      <PageHead
        kicker="Ride types"
        title="Four ways to ride"
        lede="The quote on the booking screen is the price before you confirm."
      />
      <div className="mkt-safety-live">
        {RIDE_OPTION_CATALOG.map((tier) => (
          <article key={tier.id} className="mkt-card mkt-feature">
            <h2>{tier.name}</h2>
            <p>{RIDE_TYPE_NOTES[tier.id]}</p>
          </article>
        ))}
        <article className="mkt-card mkt-feature">
          <h2>Student discount</h2>
          <p>
            {STUDENT_DISCOUNT_BPS / 100}% off Standard when the signed-in email is confirmed and ends with @clemson.edu or @g.clemson.edu.
            Other ride types are not included.
          </p>
        </article>
        <article className="mkt-card mkt-feature">
          <h2>Schedule ahead</h2>
          <p>Schedule ahead and save {SCHEDULE_AHEAD_DISCOUNT_PCT}% when the pickup qualifies. Scheduling does not charge the card.</p>
        </article>
        <article className="mkt-card mkt-feature">
          <h2>{pass.name}</h2>
          <p>{pass.summary}</p>
        </article>
        <article className="mkt-card mkt-feature">
          <h2>How this ride is paid</h2>
          <p>Stripe places a pre-authorization hold for the estimated fare. The full fare is charged when the trip ends.</p>
        </article>
      </div>
    </MarketingChrome>
  )
}

export function TigerPassPage() {
  const feature = BUILT_IN.find((item) => item.id === 'tiger-pass')
  return (
    <MarketingChrome current="tiger-pass">
      <PageHead kicker="Tiger Pass" title={feature.title} lede={feature.what} />
      <FeatureBlock feature={feature} />
      <button type="button" className="mkt-text pressable" onClick={() => navigate('account', { tab: 'billing' })}>
        Open billing
      </button>
    </MarketingChrome>
  )
}

export function SafetyPage() {
  const riderGuide = messagingGuide('rider')
  const safety = SAFETY_FEATURES.map((feature) => withMessaging(feature, riderGuide))
  return (
    <MarketingChrome current="safety">
      <PageHead kicker={SAFETY_SECTION.kicker} title="Safe nights out" lede={SAFETY_SECTION.what} />
      <p className="mkt-note"><strong>Why it matters. </strong>{SAFETY_SECTION.why}</p>
      <MarketingPhoto id="night-going-out" className="mkt-section-banner" />
      <div className="mkt-section-head">
        <h2 className="mkt-night-title">Downtown Clemson, Friday and Saturday nights</h2>
      </div>
      <div className="mkt-night-strip">
        {NIGHT_VENUES.map((id) => <MarketingPhoto key={id} id={id} className="mkt-night-shot" />)}
      </div>
      <div className="mkt-safety-live">
        {safety.map((feature) => <FeatureBlock key={feature.id} feature={feature} />)}
      </div>
    </MarketingChrome>
  )
}

export function PromosPage() {
  const coupon = currentWeeklyCoupon()
  return (
    <MarketingChrome current="promos">
      <PageHead kicker="Promos" title="This week and always-on offers" />
      <article className="mkt-card mkt-feature">
        <p className="mkt-kicker">This week</p>
        <h2>{coupon.title}</h2>
        <p>{coupon.detail}</p>
        <p>Code {coupon.code}</p>
        <p>{coupon.dropLabel}</p>
      </article>
      {STANDING_OFFERS.map((offer) => (
        <article key={offer.id} className="mkt-card mkt-feature">
          <p className="mkt-kicker">{offer.kicker}</p>
          <h2>{offer.title}</h2>
          <p>{offer.detail}</p>
          {offer.purchasable ? (
            <button type="button" className="mkt-text pressable" onClick={() => navigate('account', { tab: 'billing' })}>
              Open billing
            </button>
          ) : null}
        </article>
      ))}
      <p className="mkt-note">Automatic ride discounts do not stack with each other or with the Friday code.</p>
    </MarketingChrome>
  )
}

export function FaqPage() {
  return (
    <MarketingChrome current="faq">
      <PageHead kicker="FAQ" title="Common questions" />
      {FAQ.map((item) => (
        <article key={item.q} className="mkt-card mkt-feature">
          <h2>{item.q}</h2>
          <p>{item.a}</p>
        </article>
      ))}
    </MarketingChrome>
  )
}

export function GetTheAppPage() {
  return (
    <MarketingChrome current="get-the-app">
      <PageHead kicker="Get the App" title="Rider and driver" lede={APP_STORE_NOTE} />
      {APP_DOWNLOADS.map((app) => (
        <article key={app.id} className="mkt-card mkt-feature" id={app.id === 'rider' ? 'get-the-app' : undefined}>
          <h2>{app.product}</h2>
          <p>{app.blurb}</p>
          <p>{app.iosNote}</p>
          <p>{app.androidNote}</p>
          <button
            type="button"
            className="mkt-text pressable"
            onClick={() => navigate(app.id === 'driver' ? 'driver' : 'home')}
          >
            {app.id === 'driver' ? 'Open the driver desk' : 'Book a ride'}
          </button>
        </article>
      ))}
    </MarketingChrome>
  )
}
