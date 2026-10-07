import { useEffect, useState } from 'react'
import { navigate } from '../lib/navigation'
import { PrimaryButton } from '../components/PrimaryButton'
import { QrMark } from '../components/QrMark'
import { MARKETING_FEATURES } from '../../shared/marketingFeatures.js'
import { STANDING_OFFERS } from '../../shared/standingPromos.js'
import { currentWeeklyCoupon, FRIDAY_DROP_HOUR_ET, FRIDAY_DROP_TIME_ZONE } from '../../shared/weeklyCoupon.js'
import { RIDE_OPTION_CATALOG } from '../../shared/rideOptions.js'
import {
  APP_DOWNLOADS,
  SUPPORT_EMAIL,
  WEB_BOOK_URL,
  WEB_DRIVER_URL,
} from '../../shared/productLinks.js'

const RIDE_TYPE_COPY = {
  standard: 'Everyday seats. The fare is on screen before you request.',
  wait: 'A few more minutes. A lower fare when time is on your side.',
  comfort: 'A quieter car. Same matching, a higher class.',
}

const FRAMES = [
  { src: '/marketing/clemson-memorial-stadium.jpg', alt: 'Clemson Memorial Stadium at night, the stands full under the lights' },
  { src: '/marketing/clemson-rides-avenue.jpg', alt: 'Dusk on a brick campus avenue under a deep sky' },
  { src: '/marketing/clemson-rides-gameday.jpg', alt: 'Stadium lights blooming against a night sky' },
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
      // Leave the bar clear at the top, then use translucent purple once the page has moved.
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

function scrollToCoupon() {
  document.getElementById('this-weeks-coupon')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function DownloadCard({ app }) {
  const sharedCode = app.iosHref === app.androidHref
  return (
    <article className="mkt-card mkt-download">
      <div className="mkt-download-top">
        {sharedCode ? <QrMark value={app.href} label={app.label} /> : (
          <div className="mkt-qr-pair">
            <QrMark value={app.iosHref} label={`${app.label} iOS`} />
            <QrMark value={app.androidHref} label={`${app.label} Android`} />
          </div>
        )}
        <div>
          <div className="mkt-kicker">{app.label}</div>
          <h3>{app.product}</h3>
          <p>{sharedCode ? app.blurb : 'Separate codes for the iOS and Android listings.'}</p>
          <p className="mkt-fine" style={{ wordBreak: 'break-all' }}>{sharedCode ? app.href : `${app.iosHref} · ${app.androidHref}`}</p>
        </div>
      </div>
      <div className="mkt-platform">
        <a href={app.iosHref} target="_blank" rel="noreferrer">
          <strong>iOS</strong>
          <span>{app.iosNote}</span>
        </a>
        <a href={app.androidHref} target="_blank" rel="noreferrer">
          <strong>Android</strong>
          <span>{app.androidNote}</span>
        </a>
      </div>
    </article>
  )
}

export function Marketing() {
  const overPage = useNavOverPage()
  const coupon = currentWeeklyCoupon(new Date())
  const value = coupon.percentOffBps
    ? `${coupon.percentOffBps / 100}% off`
    : `$${(coupon.amountOffCents / 100).toFixed(0)} off`
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
        <img className="mkt-stage-photo" src={FRAMES[0].src} alt={FRAMES[0].alt} />
        <div className="mkt-stage-shade" aria-hidden="true" />
        <div className="mkt-inner mkt-stage-copy">
          <p className="mkt-kicker mkt-kicker--light">Clemson, South Carolina</p>
          <h1>
            Clemson
            <span className="mkt-orange-word"> RIDES</span>
          </h1>
          <p className="mkt-lede">
            Campus, game day, and the airport. Riders and drivers share one account.
            Matching is live. The trip stays on the map until you arrive.
          </p>
          <div className="mkt-actions">
            <PrimaryButton fullWidth={false} onClick={() => navigate('home')}>Book a ride</PrimaryButton>
            <button type="button" className="mkt-ghost pressable" onClick={() => navigate('driver-signup')}>
              Drive with Clemson RIDES
            </button>
            <button type="button" className="mkt-ghost pressable" onClick={() => navigate('schedule')}>
              Airport schedule
            </button>
          </div>
        </div>
        <aside className="mkt-spec" id="this-weeks-coupon" aria-label="This week's coupon">
          <p className="mkt-kicker">This week · Friday {FRIDAY_DROP_HOUR_ET}:00 {FRIDAY_DROP_TIME_ZONE}</p>
          <h2>{coupon.title}</h2>
          <p>{coupon.detail}</p>
          <p className="mkt-code" aria-label="Coupon code">{coupon.code}</p>
          <p className="mkt-fine">{value}. New every Friday at 12:00 PM Eastern. {coupon.dropLabel}.</p>
        </aside>
      </section>

      <main className="mkt-inner mkt-main">
        <section aria-labelledby="offers-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">Standing offers</p>
            <h2 id="offers-heading">Always on</h2>
            <p>The Friday code changes. These four do not.</p>
          </div>
          <div className="mkt-offers">
            {STANDING_OFFERS.map((offer) => (
              <article key={offer.id} className="mkt-card mkt-offer">
                <p className="mkt-kicker">{offer.kicker}</p>
                <h3>{offer.title}</h3>
                <p>{offer.detail}</p>
                {offer.purchasable ? (
                  <button type="button" className="mkt-text pressable" onClick={() => navigate('account', { tab: 'billing' })}>
                    Buy the $75 package
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="types-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">Ride types</p>
            <h2 id="types-heading">Standard, Wait & Save, Extra Comfort</h2>
          </div>
          <div className="mkt-types">
            {RIDE_OPTION_CATALOG.map((tier) => (
              <article key={tier.id} className="mkt-card mkt-type">
                <h3>{tier.name}</h3>
                <p>{RIDE_TYPE_COPY[tier.id]}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="features-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">On the app</p>
            <h2 id="features-heading">What you can book today</h2>
            <p>
              Student pricing, game day, scheduled weekend and party rides, Stripe payments,
              real-time matching, and live trip tracking.
            </p>
          </div>
          <div className="mkt-grid">
            {MARKETING_FEATURES.map((feature) => (
              <article key={feature.id} className="mkt-card mkt-feature">
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
          <p className="mkt-pay-note">
            Stripe places a pre-authorization hold for the estimated fare plus a buffer.
            The full fare is charged when the trip ends.
          </p>
          <div className="mkt-actions mkt-actions--section">
            <button type="button" className="mkt-ghost mkt-ghost--solid pressable" onClick={() => navigate('carpool', { hub: '1' })}>
              Find a carpool
            </button>
            <button type="button" className="mkt-text pressable" onClick={() => navigate('home')}>
              Book a ride
            </button>
          </div>
        </section>

        <section id="get-the-app" className="mkt-get" aria-labelledby="download-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">Download</p>
            <h2 id="download-heading">Get the app</h2>
            <p>
              The App Store and Google Play listings are not live yet.
              The rider code opens booking at {WEB_BOOK_URL}. The driver code opens the driver web app at {WEB_DRIVER_URL}.
              The iPhone and Android buttons use those same pages.
            </p>
          </div>
          <div className="mkt-downloads">
            {APP_DOWNLOADS.map((app) => <DownloadCard key={app.id} app={app} />)}
          </div>
          <div className="mkt-card mkt-soft" aria-label="Web booking QR">
            <p className="mkt-kicker">Soft launch · web</p>
            <div className="mkt-soft-row">
              <QrMark value={WEB_BOOK_URL} label="Book on web" />
              <div>
                <h3>Scan to book in the browser</h3>
                <p>Same booking flow as the rider app.</p>
                <p className="mkt-fine" style={{ wordBreak: 'break-all' }}>{WEB_BOOK_URL}</p>
                <button type="button" className="mkt-text pressable" onClick={() => navigate('schedule')}>
                  Prefer airport schedule? Open Schedule
                </button>
              </div>
            </div>
          </div>
          <p className="mkt-fine">One account on the web, the rider app, and the driver app. Questions: {SUPPORT_EMAIL}</p>
        </section>
      </main>

      <footer className="mkt-footer">
        <div className="mkt-inner mkt-footer-inner">
          <span>Clemson RIDES</span>
          <nav aria-label="Footer">
            <button type="button" className="pressable" onClick={scrollToCoupon}>This week</button>
            <button type="button" className="pressable" onClick={() => navigate('service-area')}>Service area</button>
            <button type="button" className="pressable" onClick={() => navigate('privacy')}>Privacy</button>
            <button type="button" className="pressable" onClick={() => navigate('terms')}>Terms</button>
            <button type="button" className="pressable" onClick={() => navigate('home')}>Book a ride</button>
          </nav>
        </div>
      </footer>
    </div>
  )
}
