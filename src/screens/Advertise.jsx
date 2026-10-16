import { useState } from 'react'
import { SitePage } from '../components/SitePage'
import { MarketingPhoto } from '../components/MarketingPhoto'
import { buildFieldA11yProps, getFieldErrorProps } from '../lib/formA11y'
import { supportEmail } from '../../shared/productLinks.js'
import { AD_LEAD_HONEYPOT, adLeadErrors, normalizeAdLead } from '../../shared/adLeads.js'
import {
  AD_CATEGORIES,
  ADS_PACKAGES_APPROVED,
  COMING_SOON_COPY,
  FOUNDING_PARTNER_TIER,
  publicAdPackages,
  tierChoices,
} from '../content/adPackages.js'
import '../styles/advertise.css'

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
    title: 'A deal they can scan',
    body: 'Each spot can carry a QR code, so a rider can save your offer before they reach College Avenue.',
  },
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
      <h3 id="adv-form-heading">Get founding-partner rates</h3>
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

export function AdPackagesSection() {
  const tiers = publicAdPackages()
  return (
    <section className="adv-section" aria-labelledby="adv-packages-heading">
      <div className="mkt-section-head">
        <p className="mkt-kicker">Packages</p>
        <h2 id="adv-packages-heading">Packages and pricing</h2>
      </div>
      {ADS_PACKAGES_APPROVED && tiers.length ? (
        <div className="adv-tiers site-card-grid">
          {tiers.map((tier) => (
            <article key={tier.id} className={tier.highlight ? 'mkt-card adv-tier adv-tier--highlight' : 'mkt-card adv-tier'}>
              <h3>{tier.name}</h3>
              <p className="adv-price">{tier.priceLabel}</p>
              <p>{tier.summary}</p>
              <ul>{tier.features.map((f) => <li key={f}>{f}</li>)}</ul>
            </article>
          ))}
        </div>
      ) : (
        <div className="mkt-card adv-soon" data-testid="adv-coming-soon">
          <span className="adv-soon-chip">Founding partners</span>
          <p className="adv-soon-copy">{COMING_SOON_COPY}</p>
          <a className="dp-btn dp-btn-primary pressable" href="#adv-interest">Contact us</a>
        </div>
      )}
    </section>
  )
}

export function Advertise() {
  return (
    <SitePage current="advertise">
      <section className="adv-hero mkt-section-head mkt-page-hero" aria-labelledby="adv-hero-heading">
        <p className="mkt-kicker">Advertise with us</p>
        <h1 id="adv-hero-heading">Put your business in front of every Clemson Rides rider</h1>
        <p className="adv-lede">A tablet on the back of the front seat in every Clemson Rides car, scrolling local businesses, deals, promos and game-day specials.</p>
        <div className="dp-hero-actions">
          <a className="dp-btn dp-btn-primary pressable" href="#adv-interest">Become a founding partner</a>
          <a className="dp-btn dp-btn-ghost pressable" href="#adv-how">How it works</a>
        </div>
      </section>

      <section id="adv-how" className="adv-section" aria-labelledby="adv-how-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">In-car tablets</p>
          <h2 id="adv-how-heading">Ads riders actually see</h2>
        </div>
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

      <AdPackagesSection />

      <section id="adv-interest" className="adv-section" aria-labelledby="adv-form-heading">
        <div className="mkt-section-head">
          <p className="mkt-kicker">Get started</p>
          <h2>Tell us about your business</h2>
          <p>Founding partners lock in launch rates. We reply within two business days.</p>
        </div>
        <AdInterestForm />
      </section>
    </SitePage>
  )
}
