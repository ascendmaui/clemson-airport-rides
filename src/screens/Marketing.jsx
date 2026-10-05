import { navigate } from '../lib/navigation'
import { PrimaryButton } from '../components/PrimaryButton'
import { QrMark } from '../components/QrMark'
import { MARKETING_FEATURES } from '../../shared/marketingFeatures.js'
import {
  APP_DOWNLOADS,
  SUPPORT_EMAIL,
  WEB_BOOK_URL,
  WEB_DRIVER_URL,
} from '../../shared/productLinks.js'

function scrollToDownloads() {
  document.getElementById('get-the-app')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function DownloadCard({ app }) {
  const sharedCode = app.iosHref === app.androidHref
  return (
    <article className="mkt-card mkt-download">
      <div className="mkt-download-top">
        {sharedCode ? <QrMark value={app.href} label={app.scanCta} /> : (
          <div className="mkt-qr-pair">
            <QrMark value={app.iosHref} label={`${app.scanCta} on iPhone`} />
            <QrMark value={app.androidHref} label={`${app.scanCta} on Android`} />
          </div>
        )}
        <div>
          <div className="mkt-kicker">{app.label}</div>
          <h3>{app.product}</h3>
          <p className="mkt-scan-cta">{app.scanCta}</p>
          <p>
            {sharedCode
              ? app.blurb
              : 'Separate codes for the iOS and Android listings.'}
          </p>
          <p className="mkt-fine" style={{ wordBreak: 'break-all' }}>{sharedCode ? app.href : `${app.iosHref} · ${app.androidHref}`}</p>
        </div>
      </div>
      <div className="mkt-platform">
        <a href={app.iosHref} target="_blank" rel="noreferrer">
          <strong>{app.iosCta}</strong>
          <span>{app.iosNote}</span>
        </a>
        <a href={app.androidHref} target="_blank" rel="noreferrer">
          <strong>{app.androidCta}</strong>
          <span>{app.androidNote}</span>
        </a>
      </div>
    </article>
  )
}

export function Marketing() {
  return (
    <div className="mkt fade-in">
      <header className="mkt-nav">
        <button type="button" className="mkt-brand pressable" onClick={() => navigate('landing')}>
          <span className="mkt-brand-mark">CR</span>
          <span>Clemson RIDES</span>
        </button>
        <nav className="mkt-nav-links" aria-label="Marketing">
          <button type="button" className="pressable" onClick={scrollToDownloads}>Get the app</button>
          <button type="button" className="pressable" onClick={() => navigate('home')}>Book</button>
          <button type="button" className="pressable" onClick={() => navigate('driver-signup')}>Drive</button>
          <button type="button" className="pressable" onClick={() => navigate('privacy')}>Privacy</button>
          <button type="button" className="pressable" onClick={() => navigate('terms')}>Terms</button>
        </nav>
      </header>

      <section className="mkt-hero">
        <div className="mkt-inner mkt-hero-inner">
          <p className="mkt-kicker mkt-kicker--light">Ride · Game · Repeat</p>
          <h1>
            <span className="mkt-orange-word">Clemson</span> RIDES
          </h1>
          <p className="mkt-lede">
            Airport, campus, and game day rides for Tigers. Book or drive in the browser tonight — scan the rider or driver QR, or open Book a ride.
          </p>
          <div className="mkt-pill">Tigers get you there</div>
          <div className="mkt-actions">
            <PrimaryButton fullWidth={false} onClick={() => navigate('home')}>Book a ride</PrimaryButton>
            <PrimaryButton fullWidth={false} variant="purple" onClick={() => navigate('schedule')}>Airport schedule</PrimaryButton>
            <button type="button" className="mkt-ghost pressable" onClick={() => navigate('driver-signup')}>
              Sign up as a driver
            </button>
          </div>
          <div className="mkt-hero-qrs" role="group" aria-label="Rider and driver web QR codes">
            {APP_DOWNLOADS.map((app) => (
              <div
                key={app.id}
                className="mkt-card mkt-hero-qr"
                role="group"
                aria-label={app.id === 'rider' ? 'Web booking QR' : 'Web driver QR'}
              >
                <p className="mkt-kicker">Soft launch · web</p>
                <div className="mkt-hero-qr-mark">
                  <QrMark value={app.href} label={app.scanCta} />
                </div>
                <p className="mkt-scan-cta">{app.scanCta}</p>
                <p className="mkt-hero-qr-copy">{app.heroCopy}</p>
                <a className={`mkt-qr-open${app.id === 'driver' ? ' mkt-qr-open--purple' : ''}`} href={app.href}>
                  {app.openCta}
                </a>
                <p className="mkt-fine">{app.href}</p>
                {app.id === 'rider' ? (
                  <button type="button" className="mkt-text pressable" onClick={() => navigate('schedule')}>
                    Prefer airport schedule? Open Schedule
                  </button>
                ) : (
                  <button type="button" className="mkt-text pressable" onClick={() => navigate('driver-signup')}>
                    New driver? Sign up
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <main className="mkt-inner mkt-main">
        <section aria-labelledby="features-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">On the app</p>
            <h2 id="features-heading">What you can book today</h2>
            <p>
              Carpool still splits a campus ride when a Tiger offers the car. The rest of the product is the same on the website and in the native apps.
            </p>
          </div>
          <div className="mkt-grid">
            {MARKETING_FEATURES.map((feature, index) => (
              <article key={feature.id} className={`mkt-card mkt-feature ${index % 2 === 0 ? 'mkt-feature--orange' : 'mkt-feature--purple'}`}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
          <div className="mkt-actions mkt-actions--section">
            <button type="button" className="mkt-ghost mkt-ghost--solid pressable" onClick={() => navigate('carpool', { hub: '1' })}>
              Find a carpool
            </button>
            <button type="button" className="mkt-text pressable" onClick={() => navigate('carpool', { drive: '1' })}>
              Offer a carpool
            </button>
            <button type="button" className="mkt-text pressable" onClick={() => navigate('driver')}>
              Already a driver? Open driver mode
            </button>
          </div>
        </section>

        <section id="get-the-app" className="mkt-get" aria-labelledby="download-heading">
          <div className="mkt-section-head">
            <p className="mkt-kicker">Download</p>
            <h2 id="download-heading">Get the app</h2>
            <p>
              The App Store and Google Play listings are not live yet.
              Scan the rider code to book at {WEB_BOOK_URL}. Scan the driver code to open the driver desk at {WEB_DRIVER_URL}.
              The iPhone and Android buttons open those same pages.
            </p>
          </div>
          <div className="mkt-downloads">
            {APP_DOWNLOADS.map((app) => <DownloadCard key={app.id} app={app} />)}
          </div>
          <p className="mkt-fine">
            One account on the web, the rider app, and the driver app. Questions: {SUPPORT_EMAIL}
          </p>
        </section>
      </main>

      <footer className="mkt-footer">
        <div className="mkt-inner mkt-footer-inner">
          <span>Clemson RIDES</span>
          <nav aria-label="Legal">
            <button type="button" className="pressable" onClick={() => navigate('privacy')}>Privacy</button>
            <button type="button" className="pressable" onClick={() => navigate('terms')}>Terms</button>
            <button type="button" className="pressable" onClick={() => navigate('home')}>Book a ride</button>
          </nav>
        </div>
      </footer>
    </div>
  )
}
