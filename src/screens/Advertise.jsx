import { useEffect, useState } from 'react'
import { SitePage } from '../components/SitePage'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { buildFieldA11yProps, getFieldErrorProps } from '../lib/formA11y'
import { supportEmail } from '../../shared/productLinks.js'
import { AD_LEAD_HONEYPOT, adLeadErrors, normalizeAdLead } from '../../shared/adLeads.js'
import {
  AD_CATEGORIES,
  FOUNDING_PARTNER_TIER,
  GAME_DAY_ADDON,
  PRICING_STATUS_COPY,
  formatDollars,
  formatPerRide,
  publicAdPackages,
  tierChoices,
} from '../content/adPackages.js'
import { APPLY_COPY } from '../../shared/ads/application.js'
import { METRIC_DEFINITIONS } from '../../shared/ads/metrics.js'
import { approvedSamples } from '../content/sampleAds.js'
import { HERO_DEMO_APPROVED, HOW_IT_WORKS_VIDEO } from '../content/advertiseMedia.js'
import { AdCreative } from '../components/AdCreative'
import '../styles/advertise.css'
import '../styles/ads.css'

const HOW_IT_WORKS = [
  {
    title: 'A tablet in every car',
    body: 'Every Clemson Rides car has a tablet mounted on the back of the front seat, right at eye level for riders.',
  },
  {
    title: 'Your business in the loop',
    body: 'The screen scrolls local businesses, deals, promos and game-day specials while the ride is underway.',
  },
  {
    title: 'A scan is a customer',
    body: 'Every ad carries its own tracking QR code. Each scan is logged with the ride and time, then sends the rider straight to your deal: proof of foot traffic, not just views.',
  },
  {
    title: 'Pay per ride, see every ride',
    body: 'You pay only for rides your ad is shown in, spread across drivers with tablets. Your analytics page lists every ride, its time and the QR scans it produced.',
  },
]

const VALUE_PROPS = [
  { title: 'QR scans first', body: METRIC_DEFINITIONS.scans },
  { title: 'Pay per ride delivered', body: 'Buy a bundle of rides. A ride counts once, only when your ad played during that ride.' },
  { title: 'Your own analytics page', body: 'Every ride your ad ran on, with timestamp and QR scans, plus ad runs and impressions. Download it as CSV.' },
]

const AUDIENCE = [
  { stat: 'Campus', label: 'Rides around Clemson, downtown and student housing' },
  { stat: 'Game day', label: 'Fans heading to and from Memorial Stadium' },
  { stat: 'Airport', label: 'Scheduled trips to GSP and CLT, a captive 45+ minutes' },
]

const EMPTY = { businessName: '', contactName: '', email: '', phone: '', category: '', tier: FOUNDING_PARTNER_TIER.id, message: '', [AD_LEAD_HONEYPOT]: '' }

export async function submitAdLead(values, fetcher = globalThis.fetch) {
  const res = await fetcher('/api/ad-leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(values),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || 'Could not send that. Try again.')
    err.errors = body.errors || null
    throw err
  }
  return body
}

function Field({ id, label, error, required, children }) {
  return (
    <div className={error ? 'adv-field adv-field--error' : 'adv-field'}>
      <label htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      {children}
      {error ? <p {...getFieldErrorProps(id)}>{error}</p> : null}
    </div>
  )
}

export function AdInterestForm({ submit = submitAdLead }) {
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [state, setState] = useState('idle')
  const [notice, setNotice] = useState('')
  const set = (key) => (event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))
  const a11y = (id, key, required = true) => buildFieldA11yProps({ id, error: errors[key], required })

  async function onSubmit(event) {
    event.preventDefault()
    const found = adLeadErrors(values)
    setErrors(found)
    if (Object.keys(found).length) {
      setNotice('Fix the highlighted fields.')
      return
    }
    setState('sending')
    setNotice('')
    try {
      await submit({ ...normalizeAdLead(values), [AD_LEAD_HONEYPOT]: values[AD_LEAD_HONEYPOT] })
      setState('sent')
      setValues(EMPTY)
    } catch (err) {
      setState('idle')
      if (err?.errors) setErrors(err.errors)
      setNotice(err?.message || 'Could not send that. Try again.')
    }
  }

  if (state === 'sent') {
    return (
      <div className="adv-sent mkt-card" role="status">
        <h3>Thanks, we got it.</h3>
        <p>We will reach out within two business days with founding-partner rates. Questions? Email <a href={`mailto:${supportEmail()}`}>{supportEmail()}</a>.</p>
      </div>
    )
  }

  return (
    <form className="adv-form mkt-card" onSubmit={onSubmit} noValidate aria-labelledby="adv-form-heading">
      <h3 id="adv-form-heading">Ask us about advertising</h3>
      <div className="adv-form-grid">
        <Field id="adv-business" label="Business name" error={errors.businessName} required>
          <input {...a11y('adv-business', 'businessName')} name="businessName" autoComplete="organization" value={values.businessName} onChange={set('businessName')} />
        </Field>
        <Field id="adv-contact" label="Contact name" error={errors.contactName} required>
          <input {...a11y('adv-contact', 'contactName')} name="contactName" autoComplete="name" value={values.contactName} onChange={set('contactName')} />
        </Field>
        <Field id="adv-email" label="Email" error={errors.email} required>
          <input {...a11y('adv-email', 'email')} name="email" type="email" inputMode="email" autoComplete="email" value={values.email} onChange={set('email')} />
        </Field>
        <Field id="adv-phone" label="Phone" error={errors.phone} required>
          <input {...a11y('adv-phone', 'phone')} name="phone" type="tel" inputMode="tel" autoComplete="tel" value={values.phone} onChange={set('phone')} />
        </Field>
        <Field id="adv-category" label="Category" error={errors.category} required>
          <select {...a11y('adv-category', 'category')} name="category" value={values.category} onChange={set('category')}>
            <option value="">Choose one</option>
            {AD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field id="adv-tier" label="Interested tier" error={errors.tier}>
          <select {...a11y('adv-tier', 'tier', false)} name="tier" value={values.tier} onChange={set('tier')}>
            {tierChoices().map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      </div>
      <Field id="adv-message" label="Message (optional)" error={errors.message}>
        <textarea {...a11y('adv-message', 'message', false)} name="message" rows={4} value={values.message} onChange={set('message')} placeholder="Tell us about your deal, game-day special or launch." />
      </Field>
      <div className="adv-hp" aria-hidden="true">
        <label htmlFor="adv-website">Website</label>
        <input id="adv-website" name={AD_LEAD_HONEYPOT} tabIndex={-1} autoComplete="off" value={values[AD_LEAD_HONEYPOT]} onChange={set(AD_LEAD_HONEYPOT)} />
      </div>
      {notice ? <p className="adv-notice" role="alert">{notice}</p> : null}
      <button type="submit" className="dp-btn dp-btn-primary pressable adv-submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Send my interest'}
      </button>
      <p className="adv-fine">We only use this to contact you about advertising with Clemson Rides.</p>
    </form>
  )
}

/** Rotating sample-ad demo in a tablet frame. Renders nothing until John approves the samples. */
export function HeroTabletDemo({ samples = approvedSamples(), enabled = HERO_DEMO_APPROVED }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!enabled || samples.length < 2) return undefined
    const t = window.setInterval(() => setI((n) => n + 1), 6000)
    return () => window.clearInterval(t)
  }, [enabled, samples.length])
  if (!enabled || !samples.length) return null
  const s = samples[i % samples.length]
  return (
    <div className="adv-hero-demo" aria-label="Sample ads as riders see them on the tablet" data-testid="adv-hero-demo">
      <div className="adv-tablet adv-tablet--live">
        {s.video ? (
          <video className="adc-media" src={s.video} poster={s.image} autoPlay muted playsInline loop />
        ) : (
          <AdCreative key={s.id} creative={{ kind: s.image ? 'image' : 'built', mediaUrl: s.image, headline: s.headline, dealText: s.dealText, theme: s.theme, qrUrl: 'https://clemsonrides.com/advertise' }} preview />
        )}
      </div>
    </div>
  )
}

/** "Run an ad similar to this" gallery. Renders nothing until John approves the samples. */
export function SampleAdsGallery({ samples = approvedSamples() }) {
  if (!samples.length) return null
  return (
    <section className="adv-section" aria-labelledby="adv-samples-heading" data-testid="adv-samples">
      <div className="mkt-section-head">
        <p className="mkt-kicker">Sample ads</p>
        <h2 id="adv-samples-heading">What your ad could look like</h2>
      </div>
      <div className="site-card-grid adv-samples">
        {samples.map((s) => (
          <a key={s.id} className="mkt-card adv-sample pressable" href={`/advertise/signup?template=${encodeURIComponent(s.id)}`}>
            {s.image ? <img src={s.image} alt={`${s.headline}: ${s.dealText}`} loading="lazy" /> : <AdCreative creative={{ kind: 'built', headline: s.headline, dealText: s.dealText, theme: s.theme }} preview />}
            <span className="adv-sample-cta">Run an ad similar to this</span>
          </a>
        ))}
      </div>
    </section>
  )
}

/** How it Works video slot. Renders nothing until John approves the video. */
export function HowItWorksVideo({ video = HOW_IT_WORKS_VIDEO }) {
  if (!video?.src) return null
  return (
    <video className="adv-video" src={video.src} poster={video.poster} controls muted playsInline preload="metadata" data-testid="adv-how-video">
      {video.captions ? <track kind="captions" src={video.captions} srcLang="en" label="English" default /> : null}
    </video>
  )
}

export function AdPackagesSection() {
  const bundles = publicAdPackages()
  return (
    <section id="pricing" className="adv-section" aria-labelledby="adv-packages-heading">
      <div className="mkt-section-head">
        <p className="mkt-kicker">Pricing</p>
        <h2 id="adv-packages-heading">Pay only for rides your ad is shown in</h2>
        <p>Ads are spread across drivers with tablets. Every ride is listed on your analytics page with its time and QR scans.</p>
      </div>
      <div className="adv-values">
        {VALUE_PROPS.map((v) => (
          <article key={v.title} className="mkt-card adv-value">
            <h3>{v.title}</h3>
            <p>{v.body}</p>
          </article>
        ))}
      </div>
      <div className="adv-tiers site-card-grid" data-testid="adv-bundles">
        {bundles.map((b) => (
          <article key={b.id} className={b.highlight ? 'mkt-card adv-tier adv-tier--highlight' : 'mkt-card adv-tier'}>
            <h3>{b.name}</h3>
            <p className="adv-price">{formatDollars(b.priceCents)}</p>
            <p className="adv-per-ride">{formatPerRide(b)}</p>
            <p>{b.summary}</p>
            <a className="dp-btn dp-btn-primary pressable" href={`/advertise/signup?package=${b.id}`}>Choose {b.name}</a>
          </article>
        ))}
        <article className="mkt-card adv-tier adv-tier--addon">
          <h3>{GAME_DAY_ADDON.name}</h3>
          <p className="adv-price">Add-on</p>
          <p>{GAME_DAY_ADDON.summary}</p>
        </article>
      </div>
      <p className="adv-fine" data-testid="adv-pricing-status">{PRICING_STATUS_COPY}</p>
    </section>
  )
}

/**
 * Hero links. The router reads any #hash as a route, so in-page anchors like #adv-how sent people
 * to the homepage. Use real paths: the founding-partner application, and
 * /advertise?section=how-it-works, which scrolls to the How it works section.
 */
export const FOUNDING_APPLY_HREF = '/advertise/apply'
export const HOW_IT_WORKS_ID = 'how-it-works'
export const HOW_IT_WORKS_HREF = `/advertise?section=${HOW_IT_WORKS_ID}`

function scrollToHowItWorks(smooth) {
  const el = typeof document !== 'undefined' ? document.getElementById(HOW_IT_WORKS_ID) : null
  if (el) el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  return Boolean(el)
}

function jumpToHowItWorks(e) {
  if (!scrollToHowItWorks(true)) return
  e.preventDefault()
  try { window.history.replaceState(window.history.state, '', HOW_IT_WORKS_HREF) } catch { /* ignore */ }
}

export function Advertise() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('section') === HOW_IT_WORKS_ID) scrollToHowItWorks(false)
  }, [])
  return (
    <SitePage current="advertise">
      <section className="adv-hero mkt-section-head mkt-page-hero" aria-labelledby="adv-hero-heading">
        <HeroTabletDemo />
        <p className="mkt-kicker">Advertise with us</p>
        <h1 id="adv-hero-heading">Riders scan your deal. You see every scan.</h1>
        <p className="adv-lede">Your ad plays on the tablet on the back of the front seat in Clemson Rides cars, between local deals, promos and game-day specials. Each ad has its own tracking QR code, so a scan is proof a rider is headed your way. You pay only for the rides your ad is shown in.</p>
        <div className="dp-hero-actions">
          <a className="dp-btn dp-btn-primary pressable" href={FOUNDING_APPLY_HREF}>{APPLY_COPY}</a>
          <a className="dp-btn dp-btn-ghost pressable" href={HOW_IT_WORKS_HREF} onClick={jumpToHowItWorks}>How it works</a>
        </div>
      </section>

      <section id={HOW_IT_WORKS_ID} className="adv-section" aria-labelledby="adv-how-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">In-car tablets</p>
          <h2 id="adv-how-heading">Ads riders actually see</h2>
        </div>
        <HowItWorksVideo />
        <div className="site-card-grid adv-how">
          <article className="mkt-card site-photo-card adv-tablet-card">
            <div className="adv-tablet" aria-label="Example in-car tablet screen">
              <div className="adv-tablet-screen">
                <span className="adv-tablet-tag">Game-day special</span>
                <strong>Your deal here</strong>
                <span>Scan for 15% off before kickoff</span>
                <span className="adv-tablet-qr" aria-hidden="true" />
              </div>
            </div>
            <h3>Mounted on the back of the front seat</h3>
            <p>Riders in the back see the screen for the whole trip. No app to open, no feed to scroll past.</p>
          </article>
          {HOW_IT_WORKS.map((item, i) => (
            <article key={item.title} className="mkt-card adv-step">
              <span className="adv-step-num" aria-hidden="true">{i + 1}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="adv-section" aria-labelledby="adv-audience-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">Who rides</p>
          <h2 id="adv-audience-heading">Students, fans and travelers</h2>
        </div>
        <div className="site-card-grid adv-audience">
          <article className="mkt-card site-photo-card">
            <MarketingPhoto id="gameday-crowd" sizes="(min-width: 1200px) 580px, 92vw" />
            <h3>Game-day specials</h3>
            <p>Reach fans on the way to and from Memorial Stadium on home game weekends.</p>
          </article>
          <div className="adv-stats">
            {AUDIENCE.map((a) => (
              <article key={a.stat} className="mkt-card adv-stat">
                <strong>{a.stat}</strong>
                <span>{a.label}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <SampleAdsGallery />

      <AdPackagesSection />

      <section className="adv-section" aria-labelledby="adv-build-heading">
        <div className="mkt-card adv-soon">
          <span className="adv-soon-chip">Self-serve</span>
          <h2 id="adv-build-heading" className="adv-soon-copy">Ready now? Upload your ad or let us build it.</h2>
          <p>Pick a ride bundle, add your ad and submit it for review. Nothing is charged until your campaign is approved.</p>
          <div className="dp-hero-actions">
            <a className="dp-btn dp-btn-primary pressable" href="/advertise/signup">Build my ad</a>
            <a className="dp-btn dp-btn-ghost pressable" href="/advertise/my">Track my campaign</a>
          </div>
        </div>
      </section>

      <section id="adv-interest" className="adv-section" aria-labelledby="adv-form-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">Get started</p>
          <h2>Tell us about your business</h2>
          <p>Not ready to apply? Send us a question and we reply within two business days.</p>
        </div>
        <AdInterestForm />
      </section>
    </SitePage>
  )
}
